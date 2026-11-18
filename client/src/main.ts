import * as THREE from "three";
import "./style.css";
import { Plaza, resolveCollisions, type Interactable } from "./world/Plaza";
import {
  Kampung,
  PLOT_BY_ID,
  PLOT_PRICE,
  HOUSE_NAME,
  HOUSE_PRICE,
} from "./world/Kampung";
import { Pasar, LAPAK_BY_ID, LAPAK_PRICE, LAPAK_CATALOG } from "./world/Pasar";
import { Fasilitas } from "./world/Fasilitas";
import { Pantai } from "./world/Pantai";
import {
  BOUND_MAX_X,
  BOUND_MAX_Z,
  BOUND_MIN_X,
  BOUND_MIN_Z,
  STEP_UP,
  WORLD_BOXES,
  floorHeight,
} from "./world/Heights";
import { savePhoto } from "./interface/Gallery";
import { Avatar } from "./avatar/Avatar";
import { ThirdPersonCamera } from "./camera/ThirdPersonCamera";
import { Joystick } from "./controls/Joystick";
import { InputManager } from "./controls/InputManager";
import { Network, type Profile } from "./multiplayer/Network";
import {
  fetchMe,
  fetchSeason,
  loginAccount,
  registerAccount,
  savedToken,
  savedUsername,
  clearSession,
} from "./multiplayer/Account";
import { HUD, type AuthIntent, type NearbyPlayer, type PlotView, type LapakView } from "./interface/HUD";
import { SoundEngine } from "./interface/Sound";

// Konstanta gerak — HARUS sama dengan server (server/src/rooms/KotaRoom.ts),
// agar prediksi gerak lokal dan simulasi server tidak bertengkar.
const WALK_SPEED = 4;
const RUN_SPEED = 7;
const GRAVITY = 22;
const JUMP_VELOCITY = 8.2;
// Batas dunia & zona ketinggian hidup di world/Heights.ts (Tahap 9) —
// cermin persis server (server/src/world/world.ts).
const FOUNTAIN_RADIUS = 3.6;

// ---------- Renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById("app")!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 300);

const plaza = new Plaza(scene);
const kampung = new Kampung();
scene.add(kampung.group);
const pasar = new Pasar();
scene.add(pasar.group);
const fasilitas = new Fasilitas();
scene.add(fasilitas.group);
const pantai = new Pantai();
scene.add(pantai.group);
const allInteractables: Interactable[] = [
  ...plaza.interactables,
  ...kampung.interactables,
  ...pasar.interactables,
  ...pantai.interactables,
];
const tpCam = new ThirdPersonCamera();

// ---------- Kontrol ----------
const joystick = new Joystick(
  document.getElementById("joystick")!,
  document.getElementById("joystick-knob")!
);
const input = new InputManager(joystick);

// Putar kamera: seret di area layar 3D (tombol & joystick adalah elemen HTML
// di atas canvas, jadi tidak ikut tertangkap di sini). Pinch untuk zoom.
const pointers = new Map<number, { x: number; y: number }>();
let lastPinch = 0;
const canvas = renderer.domElement;
canvas.addEventListener("pointerdown", (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
canvas.addEventListener("pointermove", (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    tpCam.rotate(dx, dy);
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (lastPinch > 0) tpCam.zoom((lastPinch - dist) * 0.03);
    lastPinch = dist;
  }
});
const endPointer = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) lastPinch = 0;
};
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("wheel", (e) => tpCam.zoom(e.deltaY * 0.01), { passive: true });

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- State permainan ----------
const network = new Network();
let started = false;
let profile: Profile | null = null;
let selfAvatar: Avatar | null = null;
const selfPos = new THREE.Vector3(0, 0, 14);
let selfVy = 0;
let selfRotY = Math.PI;

// Emote lokal (cermin durasi server di KotaRoom.ts).
const EMOTE_DURATIONS: Record<string, number> = {
  wave: 2000,
  dance: 4000,
  laugh: 2500,
  clap: 2000,
  sit: 6000,
};
let emoteName = "";
let emoteUntilMs = 0;

const sound = new SoundEngine();

interface Remote {
  avatar: Avatar;
  name: string;
  target: THREE.Vector3;
  targetRotY: number;
  anim: string;
}
const remotes = new Map<string, Remote>();

// Blokir pemain (kenyamanan lokal perangkat ini — chat & avatarnya disembunyikan).
const blockedNames = new Set<string>(
  JSON.parse(window.localStorage.getItem("kota-blocked-names") ?? "[]") as string[]
);
function persistBlocked() {
  window.localStorage.setItem("kota-blocked-names", JSON.stringify([...blockedNames]));
}

let accountName: string | null = null;

let currentInteract: Interactable | null = null;
// Kavling yang panelnya sedang terbuka (Tahap 6).
let openPlotId: string | null = null;
// Lapak yang panelnya sedang terbuka + data privat lapakku dari server (Tahap 7).
let openLapakId: string | null = null;
let myLapakInfo: { lapakId: string; kas: number; sales: Array<{ buyer: string; item: string; price: number; ts: number }>; souvenirs: number } = {
  lapakId: "",
  kas: 0,
  sales: [],
  souvenirs: 0,
};
// Saldo terakhir dari server (untuk menonaktifkan tombol Beli saat kurang).
let lastBalance: number | null = null;

// ---------- HUD ----------
const hud = new HUD({
  onStart: (p, auth) => {
    void startGame(p, auth);
  },
  onLogout: () => {
    clearSession();
    accountName = null;
    hud.setLoggedIn(null);
    hud.setAuthError(null);
  },
  onJump: () => input.queueJump(),
  onRunToggle: (on) => {
    input.runToggle = on;
    hud.toast(on ? "Mode lari: NYALA 🏃" : "Mode lari: mati 🚶");
  },
  onEmote: (emote) => {
    emoteName = emote;
    emoteUntilMs = performance.now() + (EMOTE_DURATIONS[emote] ?? 2000);
    network.sendEmote(emote);
    sound.click();
  },
  onToggleSound: (muted) => {
    sound.setMuted(muted);
    hud.toast(muted ? "Suara dimatikan 🔇" : "Suara dinyalakan 🔊");
  },
  onInteract: () => {
    if (!currentInteract) return;
    // Kavling Kampung Kita membuka panel kavling (klaim/bangun), bukan kartu info biasa.
    if (currentInteract.id.startsWith("plot:")) {
      openPlotId = currentInteract.id.slice("plot:".length);
      hud.showPlot(buildPlotView(openPlotId));
    } else if (currentInteract.id.startsWith("lapak:")) {
      openLapakId = currentInteract.id.slice("lapak:".length);
      network.requestMyLapak(); // segarkan kas & log (bila lapakku) dari server
      hud.showLapak(buildLapakView(openLapakId));
    } else if (currentInteract.id === "pengumuman" && network.connected) {
      // Papan Pengumuman (Tahap 8) membuka panel kota: Kabar Kota + voting.
      hud.showCityPanel();
    } else {
      hud.showCard(currentInteract.label, currentInteract.description);
    }
  },
  onPhoto: () => takePhoto(),
  onDayNightInfo: () => {
    hud.toast(
      network.connected
        ? network.worldIsNight
          ? "🌙 Sedang malam server — waktu dunia diatur server & sama untuk semua pemain (1 hari game = 24 menit)."
          : "☀️ Sedang siang server — waktu dunia diatur server & sama untuk semua pemain (1 hari game = 24 menit)."
        : "Waktu dunia diatur server saat kamu online (1 hari game = 24 menit)."
    );
  },
  onChat: (text) => {
    sound.pop();
    if (network.connected) {
      network.sendChat(text);
    } else {
      // Mode offline: pesan hanya tampil lokal (jujur: tidak terkirim ke siapa pun).
      hud.addChat(profile?.name ?? "Pemain", text, true);
      selfAvatar?.showBubble(text);
      hud.toast("Mode offline — pesan hanya tampil di layarmu.");
    }
  },
  onAddFriend: (username) => {
    if (!network.connected) {
      hud.toast("Sedang offline — tambah teman butuh koneksi ke server.");
      return;
    }
    network.addFriend(username);
  },
  onReportPlayer: (id, name) => {
    network.reportPlayer(id, "Dilaporkan dari panel Teman & Pemain");
    hud.toast(`Melaporkan ${name}…`);
  },
  onToggleBlock: (name) => {
    if (blockedNames.has(name)) {
      blockedNames.delete(name);
      hud.toast(`Blokir ${name} dibuka.`);
    } else {
      blockedNames.add(name);
      hud.toast(`${name} diblokir — chat & avatarnya disembunyikan di perangkatmu.`);
    }
    persistBlocked();
    for (const r of remotes.values()) r.avatar.group.visible = !blockedNames.has(r.name);
    refreshNearby();
  },
  onFriendsOpened: () => {
    network.requestFriends();
    refreshNearby();
  },
  onJobsOpened: () => {
    network.requestJobs();
  },
  onClaimBonus: () => {
    network.claimBonus();
  },
  onStartJob: (jobId) => {
    network.startJob(jobId);
  },
  onCancelJob: (jobId) => {
    network.cancelJob(jobId);
  },
  onSkipJob: (jobId) => {
    network.skipJob(jobId);
  },
  onRefill: (action) => {
    if (!network.connected) {
      hud.toast("Sedang offline — isi ulang kebutuhan butuh koneksi ke server.");
      return;
    }
    network.refillNeed(action);
  },
  onHome: () => {
    if (!network.connected) {
      hud.toast("Sedang offline — fitur Ke Rumahku butuh koneksi ke server.");
      return;
    }
    network.goHome();
  },
  onClaimPlot: (plotId) => {
    network.claimPlot(plotId);
  },
  onBuildHouse: (tier) => {
    network.buildHouse(tier);
  },
  onClaimLapak: (lapakId) => {
    network.claimLapak(lapakId);
  },
  onBuyLapakItem: (lapakId, itemId) => {
    network.buyLapakItem(lapakId, itemId);
  },
  onCollectKas: () => {
    network.collectKas();
  },
  onSetLapakName: (name) => {
    network.setLapakName(name);
  },
  onSetLapakItem: (itemId, price, stocked) => {
    network.setLapakItem(itemId, price, stocked);
  },
  onCityOpened: () => {
    network.requestCity();
  },
  onVote: (choice) => {
    network.castVote(choice);
  },
});

network.onChat = (msg) => {
  const isSelf = msg.id === network.sessionId;
  if (!isSelf && blockedNames.has(msg.name)) return; // pesan pemain terblokir disembunyikan
  sound.pop();
  hud.addChat(msg.name, msg.text, isSelf);
  if (isSelf) selfAvatar?.showBubble(msg.text);
  else remotes.get(msg.id)?.avatar.showBubble(msg.text);
};

network.onFriends = (list) => hud.renderFriends(list);
network.onFriendsResult = (_ok, message) => hud.toast(message);
network.onReportResult = () => hud.toast("Laporan terkirim ke server. Terima kasih sudah menjaga kota 🙏");

// Ekonomi (Tahap 5): semua angka datang dari server; di sini hanya ditampilkan.
network.onBalance = (balance) => {
  lastBalance = balance;
  hud.setBalance(balance);
};
network.onJobs = (payload) => {
  if (payload.balance !== null) lastBalance = payload.balance;
  hud.renderJobs(payload);
};
network.onBonusResult = (ok, message) => {
  hud.toast(message, 3400);
  if (ok) sound.click();
  network.requestJobs(); // segarkan status bonus & saldo di panel
};
network.onJobResult = (ok, message) => {
  hud.toast(message, 3400);
  network.requestJobs(); // segarkan daftar (status sif/cooldown) dari server
};
network.onJobUpdate = (update) => {
  hud.renderJobUpdate(update);
  if (update.earned) {
    hud.toast(update.message ?? `Sif selesai! +${update.earned} KC 🎉`, 4200);
    sound.click();
    network.requestJobs();
  } else if (update.message) {
    hud.toast(update.message, 3200);
  }
};
network.onSkipResult = (ok, message) => {
  hud.toast(message, 4200);
  if (ok) sound.click();
  network.requestJobs(); // segarkan cooldown & jatah skip dari server
};

// Kebutuhan hidup (Tahap 6B): meter dari server; peringatan saat meter
// menembus ambang 25% dan saat kosong (efek kritis) — sekali per penembusan.
let lastNeeds: { hunger: number; thirst: number; toilet: number } | null = null;
const warnedMeters = new Set<string>();
network.onNeeds = (needs) => {
  hud.renderNeeds(needs);
  const meters: Array<[string, number, string]> = [
    ["hunger", needs.hunger, "🍗 Laparmu"],
    ["thirst", needs.thirst, "💧 Hausmu"],
    ["toilet", needs.toilet, "🚽 Kebeletmu"],
  ];
  for (const [key, value, label] of meters) {
    if (value <= 0 && lastNeeds && (lastNeeds as any)[key] > 0) {
      hud.toast(`${label} KRITIS — kamu tidak bisa lari & mulai sif sampai teratasi. Ada jalur gratis di panel 💼!`, 4600);
      warnedMeters.add(key);
    } else if (value <= needs.warnAt && !warnedMeters.has(key) && lastNeeds && (lastNeeds as any)[key] > needs.warnAt) {
      hud.toast(`${label} tinggal ${Math.round(value)}% — isi ulang lewat panel 💼 (ada yang gratis!).`, 3800);
      warnedMeters.add(key);
    } else if (value > needs.warnAt + 5) {
      warnedMeters.delete(key);
    }
  }
  lastNeeds = { hunger: needs.hunger, thirst: needs.thirst, toilet: needs.toilet };
};
network.onNeedsResult = (result) => {
  hud.toast(result.message, 3400);
  if (result.ok) sound.click();
};

// Perumahan (Tahap 6): hasil perintah kavling dari server + teleport pulang.
network.onPlotResult = (result) => {
  hud.toast(result.message, 3800);
  if (result.ok) sound.click();
  // Segarkan tampilan distrik & panel dari state terbaru.
  kampung.sync(network.plots as any);
  if (openPlotId && hud.plotPanelOpen) hud.showPlot(buildPlotView(openPlotId));
};
network.onHomeResult = (result) => {
  hud.toast(result.message, 3400);
  if (result.ok) {
    // Jepret posisi lokal ke posisi resmi server (teleport, bukan lerp pelan).
    const self = network.players?.get(network.sessionId);
    if (self) {
      selfPos.set(Number(self.x) || 0, Number(self.y) || 0, Number(self.z) || 0);
      selfVy = 0;
      tpCam.snapBehind(selfPos);
    }
    sound.click();
  }
};

// Usaha Pemain (Tahap 7): hasil perintah lapak + data privat + kabar penjualan.
network.onLapakResult = (result) => {
  hud.toast(result.message, 3800);
  if (result.ok) sound.click();
  pasar.sync(network.lapaks as any);
  network.requestMyLapak(); // kas/log bisa berubah (klaim, beli, ambil kas)
  if (openLapakId && hud.lapakPanelOpen) hud.showLapak(buildLapakView(openLapakId));
};
network.onLapakMine = (mine) => {
  myLapakInfo = mine;
  if (openLapakId && hud.lapakPanelOpen) hud.showLapak(buildLapakView(openLapakId));
};
network.onLapakEvent = (message) => {
  hud.toast(message, 4200);
  sound.click();
};

// Kota Hidup (Tahap 8): panel kota, hasil voting, dan peristiwa besar kota.
network.onCity = (payload) => hud.renderCity(payload);
network.onVoteResult = (result) => {
  hud.toast(result.message, 3800);
  if (result.ok) sound.click();
};
network.onCityEvent = (message) => {
  hud.toast(message, 5200);
  sound.click();
  if (hud.cityPanelOpen) network.requestCity(); // segarkan panel yang sedang terbuka
};
network.onNewsUpdate = () => {
  if (hud.cityPanelOpen) network.requestCity();
};

// Quest Sosial Harian (Tahap 9): kemajuan & hadiah dari server.
network.onQuestUpdate = (update) => {
  hud.renderQuests(update.quests ?? []);
  if (update.message) {
    hud.toast(update.message, update.reward ? 4200 : 3000);
    if (update.reward) sound.click();
  }
  if (update.balance !== undefined) {
    lastBalance = update.balance;
    hud.setBalance(update.balance);
  }
};

/** Susun tampilan panel lapak dari state server + data privat (khusus pemilik). */
function buildLapakView(lapakId: string): LapakView {
  const def = LAPAK_BY_ID.get(lapakId);
  const state = network.lapaks?.get(lapakId);
  const owner = state?.owner ?? "";
  const lapakName = state?.name ?? "";
  const guest = !accountName;
  const meLower = (accountName ?? "").toLowerCase();
  const isMine = !!owner && owner.toLowerCase() === meLower;
  let myLapakId: string | null = null;
  network.lapaks?.forEach((l: any, id: string) => {
    if (l?.owner && String(l.owner).toLowerCase() === meLower) myLapakId = id;
  });
  const canClaim = !owner && !guest && !myLapakId && network.connected;
  let note = "";
  if (!network.connected) note = "Sedang offline — klaim & belanja lapak butuh koneksi ke server.";
  else if (!owner && guest) note = "Kamu masuk sebagai tamu. Daftar akun untuk mengumpulkan KC & klaim lapak (10.000 KC).";
  else if (!owner && myLapakId) note = "Kamu sudah punya lapak — satu akun hanya boleh satu lapak.";
  else if (!owner) note = `Lapak ini kosong. Klaim seharga 🪙 ${LAPAK_PRICE} KC dan mulai berjualan!`;
  else if (isMine) note = "Ini lapakmu. Atur nama, harga & stok, lalu ambil kas usaha di sini saat ada penjualan.";
  else if (guest) note = "Kamu masuk sebagai tamu — belanja butuh akun & saldo KC.";
  const menu = state?.menu;
  return {
    lapakId,
    title: `Lapak No. ${def?.number ?? "?"}`,
    owner,
    lapakName,
    isMine,
    canClaim,
    balance: guest ? null : lastBalance,
    note,
    items: LAPAK_CATALOG.map((c) => {
      const entry = menu?.get(c.id);
      return {
        id: c.id,
        name: c.name,
        effectText: c.effectText,
        price: entry ? Number(entry.price) : c.defaultPrice,
        minPrice: c.minPrice,
        maxPrice: c.maxPrice,
        stocked: entry ? Boolean(entry.stocked) : false,
      };
    }),
    kas: isMine ? myLapakInfo.kas : 0,
    sales: isMine ? myLapakInfo.sales : [],
    souvenirs: myLapakInfo.souvenirs,
  };
}

/** Susun tampilan panel kavling dari state server + denah lokal (harga memang konstanta bersama). */
function buildPlotView(plotId: string): PlotView {
  const def = PLOT_BY_ID.get(plotId);
  const state = network.plots?.get(plotId);
  const owner = state?.owner ?? "";
  const house = state?.house ?? 0;
  const guest = !accountName;
  const meLower = (accountName ?? "").toLowerCase();
  const isMine = !!owner && owner.toLowerCase() === meLower;
  // Kavling milikku (untuk aturan satu akun satu kavling).
  let myPlotId: string | null = null;
  network.plots?.forEach((p: any, id: string) => {
    if (p?.owner && String(p.owner).toLowerCase() === meLower) myPlotId = id;
  });
  const canClaim = !owner && !guest && !myPlotId && network.connected;
  let note = "";
  if (!network.connected) note = "Sedang offline — klaim & bangun rumah butuh koneksi ke server.";
  else if (guest && !owner) note = "Kamu masuk sebagai tamu. Daftar akun untuk mengumpulkan KC & klaim kavling.";
  else if (!owner && myPlotId) note = "Kamu sudah punya kavling — satu akun hanya boleh satu kavling.";
  else if (isMine) note = "Ini kavlingmu. Bangun atau tingkatkan rumahmu di sini!";
  return {
    plotId,
    title: `Kavling ${def?.tier ?? "?"} · No. ${def?.number ?? "?"}`,
    tierLabel: def?.tier === 2 ? "Kavling 2 (premium, tepi jalan utama)" : "Kavling 1 (standar)",
    price: def ? PLOT_PRICE[def.tier] : 0,
    owner,
    houseName: house > 0 ? HOUSE_NAME[house] : "",
    isMine,
    canClaim,
    note,
    tiers: [1, 2, 3]
      .filter((t) => t >= Math.max(house, 1))
      .map((t) => ({
        tier: t,
        name: HOUSE_NAME[t],
        cost: HOUSE_PRICE[t] - HOUSE_PRICE[house],
        isUpgrade: house > 0,
        current: house === t,
        locked: t === 3 && def?.tier === 1,
      })),
  };
}

function refreshNearby() {
  const players = network.players;
  const list: NearbyPlayer[] = [];
  if (profile) list.push({ id: network.sessionId || "self", name: profile.name, account: accountName ?? "", isSelf: true });
  if (players) {
    players.forEach((p: any, id: string) => {
      if (id === network.sessionId) return;
      list.push({ id, name: String(p.name ?? "Pemain"), account: String(p.account ?? ""), isSelf: false });
    });
  }
  hud.renderNearby(list, blockedNames);
}

async function startGame(p: Profile, auth: AuthIntent) {
  sound.init(); // gestur klik tombol Masuk — momen yang diizinkan browser untuk memulai audio

  // --- Alur akun (Tahap 3) ---
  let token: string | null = null;
  let finalProfile = p;
  try {
    if (auth.mode === "login" || auth.mode === "register") {
      const info =
        auth.mode === "login"
          ? await loginAccount(auth.username ?? "", auth.password ?? "")
          : await registerAccount(auth.username ?? "", auth.password ?? "");
      accountName = info.username;
      token = savedToken();
      if (auth.mode === "login") {
        finalProfile = info.profile; // profil tersimpan menang saat masuk kembali
      }
    } else if (auth.mode === "account") {
      accountName = savedUsername();
      token = savedToken();
    }
    // mode "guest": token tetap null — main sebagai tamu.
  } catch (err) {
    hud.setAuthError(err instanceof Error ? err.message : "Gagal masuk. Coba lagi ya.");
    return; // tetap di layar mulai
  }

  profile = finalProfile;
  selfAvatar = new Avatar(finalProfile.name, {
    skin: finalProfile.skin,
    shirt: finalProfile.shirt,
    pants: finalProfile.pants,
    hair: finalProfile.hair,
    hairColor: finalProfile.hairColor,
    shirtStyle: finalProfile.shirtStyle,
  });
  selfAvatar.group.position.copy(selfPos);
  scene.add(selfAvatar.group);

  const online = await network.connect(finalProfile, token);
  started = true;
  hud.hideOverlay();
  tpCam.snapBehind(selfPos);
  if (online) {
    hud.setStatus("Online — terhubung ke kota", true);
    hud.toast(
      accountName
        ? `Selamat datang kembali, ${finalProfile.name} (@${accountName})! 🏙️`
        : `Selamat datang di KOTA KITA, ${finalProfile.name}! 🏙️`
    );
    network.requestFriends();
    // Ekonomi: ambil saldo & status pekerjaan dari server (tamu: chip "—").
    if (accountName) network.requestJobs();
    else hud.setBalance(null);
    // Usaha Pemain (Tahap 7): ambil data lapakku (kas & log, privat) bila punya.
    if (accountName) network.requestMyLapak();
    // Kebutuhan hidup & jam dunia dari server (Tahap 6B).
    network.requestNeeds();
    plaza.setNight(network.worldIsNight);
    hud.setWorldIndicator(network.worldIsNight);
    refreshNearby();
  } else {
    hud.setStatus("Offline — server belum menyala, mode sendiri", false);
    hud.toast("Server belum terhubung. Kamu tetap bisa jalan-jalan sendiri dulu.");
  }
}

// Musim kosmetik (Tahap 9): tanya server musim apa yang aktif agar editor
// avatar di layar mulai bisa menawarkan gaya musimannya (server otoritas).
void fetchSeason().then((season) => {
  hud.setSeason(season?.style ?? "", season?.label ?? "");
});

// Sesi tersimpan? Muat profil akun ke layar mulai secara otomatis.
if (savedToken()) {
  void fetchMe().then((info) => {
    if (info) {
      accountName = info.username;
      hud.setLoggedIn(info.username);
      hud.applyProfile(info.profile);
    }
  });
}

function takePhoto() {
  renderer.render(scene, camera);
  // Galeri perangkat (Tahap 9): simpan juga ke IndexedDB perangkat ini
  // (data URL) — fail-soft; unduhan di bawah tetap jalan apa pun hasilnya.
  try {
    const dataUrl = canvas.toDataURL("image/png");
    void savePhoto(dataUrl).then((ok) => {
      if (ok) hud.toast("Foto tersimpan 📸 — unduhan terkirim & salinannya ada di galeri 🖼️ perangkat ini.");
    });
  } catch {
    /* IndexedDB tidak tersedia: unduhan tetap jalan. */
  }
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kota-kita-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    hud.toast("Foto tersimpan 📸 Cek folder unduhanmu.");
  }, "image/png");
}

// ---------- Fisika lokal (cermin server) ----------
function stepLocalPhysics(dt: number) {
  // Arah gerak relatif kamera.
  const fwd = new THREE.Vector3(-Math.sin(tpCam.yaw), 0, -Math.cos(tpCam.yaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const move = new THREE.Vector3()
    .addScaledVector(fwd, -input.moveY)
    .addScaledVector(right, input.moveX);
  if (move.length() > 1) move.normalize();

  const moving = move.length() > 0.05;
  // Cermin efek kritis server (Tahap 6B): meter kosong → lari dimatikan.
  const needsCritical =
    !!lastNeeds && (lastNeeds.hunger <= 0 || lastNeeds.thirst <= 0 || lastNeeds.toilet <= 0);
  const sprinting = input.sprint && !needsCritical;
  const speed = sprinting ? RUN_SPEED : WALK_SPEED;
  if (moving) {
    selfPos.addScaledVector(move, speed * dt);
    selfRotY = Math.atan2(move.x, move.z);
  }

  // Lantai bertingkat (Tahap 9) — cermin persis logika server: menapak
  // mengikuti lantai efektif (naik/turun ramp), melangkah keluar tepi
  // dek = jatuh oleh gravitasi, lompat relatif ke lantai setempat.
  const ground = floorHeight(selfPos.x, selfPos.z, selfPos.y);
  if (input.consumeJump() && selfPos.y <= ground + 0.01) selfVy = JUMP_VELOCITY;
  if (selfVy !== 0 || selfPos.y - ground > STEP_UP) {
    selfPos.y += selfVy * dt;
    selfVy -= GRAVITY * dt;
    const landing = floorHeight(selfPos.x, selfPos.z, selfPos.y);
    if (selfPos.y <= landing) {
      selfPos.y = landing;
      selfVy = 0;
    }
  } else {
    selfPos.y = ground;
  }

  selfPos.x = THREE.MathUtils.clamp(selfPos.x, BOUND_MIN_X, BOUND_MAX_X);
  selfPos.z = THREE.MathUtils.clamp(selfPos.z, BOUND_MIN_Z, BOUND_MAX_Z);
  const dF = Math.hypot(selfPos.x, selfPos.z);
  if (dF < FOUNTAIN_RADIUS && dF > 0.0001) {
    const push = FOUNTAIN_RADIUS / dF;
    selfPos.x *= push;
    selfPos.z *= push;
  }

  // Tabrakan bangunan (sama seperti server) + kotak dunia Tahap 9 (garis
  // pantai, tiang & pagar dek) + rumah pemain, meja lapak & fasilitas kota.
  resolveCollisions(selfPos, [
    ...WORLD_BOXES,
    ...kampung.houseColliders(),
    ...pasar.stallColliders(),
    ...fasilitas.colliders(),
  ]);

  // Suara langkah kaki mengikuti jarak tempuh di tanah (lantai setempat).
  const groundNow = floorHeight(selfPos.x, selfPos.z, selfPos.y);
  if (moving && selfPos.y <= groundNow + 0.05) {
    stepDistance += speed * dt;
    const stride = input.sprint ? 2.7 : 2.1;
    if (stepDistance >= stride) {
      stepDistance = 0;
      sound.step(input.sprint);
    }
  }

  // Kirim input ke server ±15x/detik (server yang menghitung posisi resmi).
  sendTimer += dt;
  if (sendTimer >= 1 / 15) {
    sendTimer = 0;
    network.sendInput(move.x, move.z, input.sprint, jumpHeldFlag);
    jumpHeldFlag = false;
  }

  // Rekonsiliasi lembut: kalau posisi server menyimpang jauh, dekati.
  const serverSelf = network.players?.get(network.sessionId);
  if (serverSelf) {
    const dx = serverSelf.x - selfPos.x;
    const dz = serverSelf.z - selfPos.z;
    if (Math.hypot(dx, dz) > 2) {
      selfPos.x += dx * Math.min(1, dt * 2.5);
      selfPos.z += dz * Math.min(1, dt * 2.5);
    }
    // Ketinggian: jepret halus ke ketinggian server bila selisihnya besar
    // (mis. selesai menaiki tangga / jatuh dari dek) agar tidak melayang.
    const dy = (Number(serverSelf.y) || 0) - selfPos.y;
    if (Math.abs(dy) > 1) selfPos.y += dy * Math.min(1, dt * 5);
  }

  // Terapkan ke avatar + animasi.
  if (selfAvatar) {
    selfAvatar.group.position.copy(selfPos);
    // Putar badan halus ke arah hadap.
    const cur = selfAvatar.group.rotation.y;
    let diff = selfRotY - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    selfAvatar.group.rotation.y = cur + diff * Math.min(1, dt * 14);

    let anim = "idle";
    if (emoteName === "sit" && moving) emoteUntilMs = 0; // duduk batal saat bergerak
    if (performance.now() < emoteUntilMs && selfPos.y <= groundNow + 0.05) anim = emoteName;
    else if (selfPos.y > groundNow + 0.05) anim = "jump";
    else if (moving) anim = sprinting ? "run" : "walk";
    selfAvatar.update(dt, anim);
  }
}

let sendTimer = 0;
let jumpHeldFlag = false;
let stepDistance = 0;
// Lompat dari keyboard/tombol diteruskan ke server lewat input berikutnya.
const origConsume = input.consumeJump.bind(input);
input.consumeJump = () => {
  const j = origConsume();
  if (j) jumpHeldFlag = true;
  return j;
};

// ---------- Pemain lain ----------
function syncRemotes(dt: number) {
  const players = network.players;
  if (!players) return;
  const seen = new Set<string>();
  players.forEach((p: any, id: string) => {
    if (id === network.sessionId) return;
    seen.add(id);
    let r = remotes.get(id);
    if (!r) {
      const avatar = new Avatar(String(p.name ?? "Pemain"), {
        skin: String(p.skin ?? "#f1c27d"),
        shirt: String(p.shirt ?? "#d64545"),
        pants: String(p.pants ?? "#3b4a6b"),
        hair: String(p.hair ?? "pendek"),
        hairColor: String(p.hairColor ?? "#3a2a1c"),
        shirtStyle: String(p.shirtStyle ?? "polos"),
      });
      avatar.group.position.set(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0);
      avatar.group.visible = !blockedNames.has(String(p.name ?? "Pemain"));
      scene.add(avatar.group);
      r = {
        avatar,
        name: String(p.name ?? "Pemain"),
        target: new THREE.Vector3(),
        targetRotY: 0,
        anim: "idle",
      };
      remotes.set(id, r);
      hud.toast(`${String(p.name)} masuk kota 👋`);
    }
    r.target.set(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0);
    r.targetRotY = Number(p.rotY) || 0;
    r.anim = String(p.anim ?? "idle");
  });
  // Buang yang keluar.
  for (const [id, r] of [...remotes]) {
    if (!seen.has(id)) {
      scene.remove(r.avatar.group);
      remotes.delete(id);
    }
  }
  // Gerakkan halus ke target.
  for (const r of remotes.values()) {
    const pos = r.avatar.group.position;
    pos.lerp(r.target, Math.min(1, dt * 10));
    let diff = r.targetRotY - r.avatar.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    r.avatar.group.rotation.y += diff * Math.min(1, dt * 12);
    r.avatar.update(dt, r.anim);
  }
}

// ---------- Interaksi ----------
let interactTimer = 0;
function checkInteract(dt: number) {
  interactTimer += dt;
  if (interactTimer < 0.2) return;
  interactTimer = 0;
  let nearest: Interactable | null = null;
  let best = Infinity;
  for (const it of allInteractables) {
    const d = Math.hypot(selfPos.x - it.position.x, selfPos.z - it.position.z);
    if (d < it.radius && d < best) {
      best = d;
      nearest = it;
    }
  }
  if (nearest !== currentInteract) {
    currentInteract = nearest;
    hud.setInteract(nearest ? nearest.label : null);
  }
}

// ---------- Kualitas gambar adaptif ----------
// Kalau frame rate turun di HP, resolusi render diturunkan bertahap agar tetap
// lancar; kalau lega lagi, dinaikkan kembali (maksimum = batas awal).
const PR_STEPS = [...new Set([Math.min(window.devicePixelRatio, 2), 1.6, 1.3, 1.0])]
  .filter((v) => v <= Math.min(window.devicePixelRatio, 2))
  .sort((a, b) => b - a);
let prIndex = 0;
let fpsFrames = 0;
let fpsTime = 0;
let qualityToastShown = false;

function adaptQuality(dt: number) {
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime < 2.5) return;
  const fps = fpsFrames / fpsTime;
  fpsFrames = 0;
  fpsTime = 0;
  if (fps < 45 && prIndex < PR_STEPS.length - 1) {
    prIndex++;
    renderer.setPixelRatio(PR_STEPS[prIndex]);
    if (started && !qualityToastShown) {
      qualityToastShown = true;
      hud.toast("Gambar disesuaikan otomatis biar tetap lancar di HP-mu ⚙️");
    }
  } else if (fps > 57 && prIndex > 0) {
    prIndex--;
    renderer.setPixelRatio(PR_STEPS[prIndex]);
  }
}

// ---------- Lingkaran utama ----------
const clock = new THREE.Clock();
let countTimer = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  plaza.update(dt, t);
  pantai.update(t);
  adaptQuality(dt);

  if (!started) {
    tpCam.updateOrbit(camera, t);
  } else {
    stepLocalPhysics(dt);
    syncRemotes(dt);
    checkInteract(dt);
    tpCam.update(camera, selfPos, dt);
    countTimer += dt;
    if (countTimer > 1) {
      countTimer = 0;
      hud.setPlayerCount(network.connected ? network.playerCount : 1);
      refreshNearby();
      // Waktu dunia (Tahap 6B): langit mengikuti jam server, sama untuk semua.
      if (network.connected) {
        plaza.setNight(network.worldIsNight);
        hud.setWorldIndicator(network.worldIsNight);
        // Tahap 9: banner event komunitas + tawaran gaya musiman di editor.
        hud.setEventBanner(network.activeEvent);
        const season = network.activeSeason;
        hud.setSeason(season?.style ?? "", season?.label ?? "");
        kampung.sync(network.plots as any);
        if (openPlotId && hud.plotPanelOpen) hud.showPlot(buildPlotView(openPlotId));
        // Pasar (Tahap 7): terapkan state lapak terbaru; segarkan panel —
        // KECUALI pemilik sedang mengetik di panel (jangan ganggu inputnya).
        pasar.sync(network.lapaks as any);
        // Fasilitas kota (Tahap 8): bangun/bongkar model sesuai state server —
        // fasilitas yang baru lolos voting langsung tampil di tengah sesi.
        fasilitas.sync(network.facilities);
        if (openLapakId && hud.lapakPanelOpen) {
          const active = document.activeElement;
          const typing =
            active instanceof HTMLInputElement &&
            document.getElementById("lapak-panel")?.contains(active);
          if (!typing) hud.showLapak(buildLapakView(openLapakId));
        }
      }
    }
  }

  renderer.render(scene, camera);
});
