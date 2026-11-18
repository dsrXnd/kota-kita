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
import { Avatar } from "./avatar/Avatar";
import { ThirdPersonCamera } from "./camera/ThirdPersonCamera";
import { Joystick } from "./controls/Joystick";
import { InputManager } from "./controls/InputManager";
import { Network, type Profile } from "./multiplayer/Network";
import {
  fetchMe,
  loginAccount,
  registerAccount,
  savedToken,
  savedUsername,
  clearSession,
} from "./multiplayer/Account";
import { HUD, type AuthIntent, type NearbyPlayer, type PlotView } from "./interface/HUD";
import { SoundEngine } from "./interface/Sound";

// Konstanta gerak — HARUS sama dengan server (server/src/rooms/KotaRoom.ts),
// agar prediksi gerak lokal dan simulasi server tidak bertengkar.
const WALK_SPEED = 4;
const RUN_SPEED = 7;
const GRAVITY = 22;
const JUMP_VELOCITY = 8.2;
// Batas dunia persegi panjang — HARUS sama dengan server (KotaRoom.ts).
const BOUND_MIN_X = -42;
const BOUND_MAX_X = 136;
const BOUND_MIN_Z = -42;
const BOUND_MAX_Z = 42;
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
const allInteractables: Interactable[] = [...plaza.interactables, ...kampung.interactables];
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
    } else {
      hud.showCard(currentInteract.label, currentInteract.description);
    }
  },
  onPhoto: () => takePhoto(),
  onDayNight: (night) => {
    plaza.setNight(night);
    hud.toast(night ? "Selamat malam 🌙 Lampu plaza menyala." : "Selamat pagi ☀️");
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
  onCancelJob: () => {
    network.cancelJob();
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
network.onBalance = (balance) => hud.setBalance(balance);
network.onJobs = (payload) => hud.renderJobs(payload);
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
      selfPos.set(Number(self.x) || 0, 0, Number(self.z) || 0);
      selfVy = 0;
      tpCam.snapBehind(selfPos);
    }
    sound.click();
  }
};

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
    refreshNearby();
  } else {
    hud.setStatus("Offline — server belum menyala, mode sendiri", false);
    hud.toast("Server belum terhubung. Kamu tetap bisa jalan-jalan sendiri dulu.");
  }
}

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
  const speed = input.sprint ? RUN_SPEED : WALK_SPEED;
  if (moving) {
    selfPos.addScaledVector(move, speed * dt);
    selfRotY = Math.atan2(move.x, move.z);
  }

  if (input.consumeJump() && selfPos.y <= 0) selfVy = JUMP_VELOCITY;
  if (selfPos.y > 0 || selfVy !== 0) {
    selfPos.y += selfVy * dt;
    selfVy -= GRAVITY * dt;
    if (selfPos.y <= 0) {
      selfPos.y = 0;
      selfVy = 0;
    }
  }

  selfPos.x = THREE.MathUtils.clamp(selfPos.x, BOUND_MIN_X, BOUND_MAX_X);
  selfPos.z = THREE.MathUtils.clamp(selfPos.z, BOUND_MIN_Z, BOUND_MAX_Z);
  const dF = Math.hypot(selfPos.x, selfPos.z);
  if (dF < FOUNTAIN_RADIUS && dF > 0.0001) {
    const push = FOUNTAIN_RADIUS / dF;
    selfPos.x *= push;
    selfPos.z *= push;
  }

  // Tabrakan bangunan (sama seperti server) + rumah pemain yang berdiri (Tahap 6).
  resolveCollisions(selfPos, kampung.houseColliders());

  // Suara langkah kaki mengikuti jarak tempuh di tanah.
  if (moving && selfPos.y <= 0) {
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
    if (performance.now() < emoteUntilMs && selfPos.y <= 0.05) anim = emoteName;
    else if (selfPos.y > 0.05) anim = "jump";
    else if (moving) anim = input.sprint ? "run" : "walk";
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
      // Kampung Kita: terapkan state kavling terbaru dari server (pemilik & rumah).
      if (network.connected) {
        kampung.sync(network.plots as any);
        if (openPlotId && hud.plotPanelOpen) hud.showPlot(buildPlotView(openPlotId));
      }
    }
  }

  renderer.render(scene, camera);
});
