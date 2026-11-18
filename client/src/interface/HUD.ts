import type {
  Profile,
  FriendInfo,
  JobsPayload,
  JobUpdate,
  JobDoneInfo,
  JobFailedInfo,
  ShiftInfo,
  NeedsInfo,
  LapakSaleInfo,
  CityPayload,
  QuestInfo,
} from "../multiplayer/Network";
import { listPhotos, deletePhoto, type GalleryPhoto } from "./Gallery";

export interface AuthIntent {
  mode: "login" | "register" | "guest" | "account";
  username?: string;
  password?: string;
}

export interface NearbyPlayer {
  id: string;
  name: string;
  account: string;
  isSelf: boolean;
}

// ---------- Perumahan (Tahap 6) ----------
// Semua angka & status di tampilan kavling berasal dari state server;
// HUD hanya menggambar pilihan yang diberikan main.ts.

export interface PlotTierOption {
  tier: number;
  name: string;
  /** Harga penuh (tanah kosong) atau selisih upgrade. */
  cost: number;
  isUpgrade: boolean;
  current: boolean;
  /** Rumah Tingkat di Kavling 1. */
  locked: boolean;
}

export interface PlotView {
  plotId: string;
  title: string;
  tierLabel: string;
  price: number;
  owner: string; // "" = kosong
  houseName: string; // "" = belum ada rumah
  isMine: boolean;
  canClaim: boolean;
  note: string; // penjelasan status (tamu / sudah punya / milik orang lain)
  tiers: PlotTierOption[];
}

// ---------- Usaha Pemain (Tahap 7) ----------
// Menu & harga berasal dari state server; kas & log penjualan hanya ada di
// tampilan pemilik (data privat dari pesan server). HUD hanya menggambar.

export interface LapakItemView {
  id: string;
  name: string;
  effectText: string;
  price: number;
  minPrice: number;
  maxPrice: number;
  stocked: boolean;
}

export interface LapakView {
  lapakId: string;
  title: string;
  owner: string; // "" = kosong
  lapakName: string; // "" = belum diklaim
  isMine: boolean;
  canClaim: boolean;
  /** Saldo sesi ini (null = tamu/offline) — untuk menonaktifkan tombol Beli. */
  balance: number | null;
  note: string;
  items: LapakItemView[];
  /** Khusus pemilik (data privat server): kas usaha saat ini. */
  kas: number;
  /** Khusus pemilik: penjualan terakhir. */
  sales: LapakSaleInfo[];
  /** Khusus pemilik: total suvenir batik yang ia kumpulkan sebagai pembeli. */
  souvenirs: number;
}

export interface HudCallbacks {
  onStart: (profile: Profile, auth: AuthIntent) => void;
  onLogout: () => void;
  onJump: () => void;
  onRunToggle: (on: boolean) => void;
  onEmote: (emote: string) => void;
  onInteract: () => void;
  onPhoto: () => void;
  /** Tombol jam dunia diklik — waktu diatur server, tombol ini hanya indikator + info. */
  onDayNightInfo: () => void;
  onToggleSound: (muted: boolean) => void;
  onChat: (text: string) => void;
  onAddFriend: (username: string) => void;
  onReportPlayer: (id: string, name: string) => void;
  onToggleBlock: (name: string) => void;
  onFriendsOpened: () => void;
  onJobsOpened: () => void;
  onClaimBonus: () => void;
  onStartJob: (jobId: string) => void;
  onCancelJob: (jobId: string) => void;
  onSkipJob: (jobId: string) => void;
  /** Pilih / ganti 2 pekerjaan milik akun ini (Tahap 10) — server memvalidasi & membiayai. */
  onChooseJobs: (jobIds: string[]) => void;
  onRefill: (action: string) => void;
  onHome: () => void;
  onClaimPlot: (plotId: string) => void;
  onBuildHouse: (tier: number) => void;
  onClaimLapak: (lapakId: string) => void;
  onBuyLapakItem: (lapakId: string, itemId: string) => void;
  onCollectKas: () => void;
  onSetLapakName: (name: string) => void;
  onSetLapakItem: (itemId: string, price: number, stocked: boolean) => void;
  onCityOpened: () => void;
  onVote: (choice: "yes" | "no") => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemen #${id} tidak ditemukan`);
  return node as T;
}

interface Selector {
  get: () => string;
  set: (v: string) => void;
}

function wireSwatches(containerId: string, initial: string): Selector {
  const container = el(containerId);
  let value = initial;
  const apply = (v: string) => {
    value = v;
    container.querySelectorAll<HTMLButtonElement>(".swatch").forEach((b) =>
      b.classList.toggle("selected", b.dataset.color === v)
    );
  };
  container.querySelectorAll<HTMLButtonElement>(".swatch").forEach((btn) => {
    btn.addEventListener("click", () => apply(btn.dataset.color ?? initial));
  });
  apply(initial);
  return { get: () => value, set: apply };
}

function wireChips(containerId: string, initial: string): Selector {
  const container = el(containerId);
  let value = initial;
  const apply = (v: string) => {
    value = v;
    container.querySelectorAll<HTMLButtonElement>(".chip").forEach((b) =>
      b.classList.toggle("selected", b.dataset.value === v)
    );
  };
  container.querySelectorAll<HTMLButtonElement>(".chip").forEach((btn) => {
    btn.addEventListener("click", () => apply(btn.dataset.value ?? initial));
  });
  apply(initial);
  return { get: () => value, set: apply };
}

/** Teks kemajuan satu sif — murni tampilan dari ringkasan server. */
function shiftProgressText(s: ShiftInfo): string {
  if (s.kind === "stay") {
    return `🧍 ${s.name}: ${Math.floor(s.progressMs / 1000)}/${Math.round(s.needMs / 1000)} detik terakumulasi`;
  }
  if (s.kind === "visit") {
    return `🎯 ${s.name}: ${s.visitedCount}/${s.totalPoints} titik`;
  }
  if (s.kind === "deliver") {
    if (s.phase === "pickup") return `📦 Ambil di ${s.pickupName}`;
    const left = Math.max(0, Math.ceil((s.deadline - Date.now()) / 1000));
    return `📦 Antar ke ${s.targetName} — sisa ${left} detik`;
  }
  return "";
}

/** Siklus siang-malam server (cermin economy.ts): 24 menit asli = 16 siang + 8 malam. */
const WORLD_DAY_MS_CLIENT = 24 * 60 * 1000;
const WORLD_DAY_FRACTION_CLIENT = 16 / 24;

/** Langkah tutorial masuk kota (Tahap 10) — satu ide per langkah, bahasa ramah. */
const TUTORIAL_STEPS: ReadonlyArray<{ icon: string; title: string; text: string }> = [
  {
    icon: "🕹️",
    title: "Cara Bergerak",
    text: "Pakai joystick di kiri bawah untuk berjalan. Geser layar untuk memutar kamera, dan cubit layar untuk zoom. Tombol 🏃 untuk lari, ⬆️ untuk lompat!",
  },
  {
    icon: "👆",
    title: "Interaksi",
    text: "Dekati tempat menarik — Warung Kopi, Papan Pengumuman, Balai Kota, kavling, lapak — lalu ketuk tombol ✋ Interaksi yang muncul di kanan bawah.",
  },
  {
    icon: "💼",
    title: "Pekerjaan & Koin Kota",
    text: "Buka panel 💼 dan PILIH 2 pekerjaanmu — hanya dua itu yang bisa kamu ambil (ganti pilihan nanti bayar 500 KC, jadi pikir baik-baik!). Selama sif berjalan, ikuti PANAH di bawah layar menuju tujuanmu.",
  },
  {
    icon: "🍔",
    title: "Kebutuhan Hidup",
    text: "Meter 🍗 lapar, 💧 haus, dan 🚽 kebelet berkurang selama kamu bermain. Selalu ada jalur GRATIS: minum di air mancur plaza, WC umum di Balai Kota, dan masak di rumahmu sendiri.",
  },
  {
    icon: "💬",
    title: "Ngobrol & Quest",
    text: "Ketuk 💬 untuk chat dan 😄 untuk emote. Melambai (👋) ke warga lain yang kamu temui — menyapa 5 warga berbeda menyelesaikan quest Sapa Warga berhadiah KC!",
  },
  {
    icon: "📸",
    title: "Foto & Galeri",
    text: "Ketuk 📸 untuk memotret kotamu. Foto tersimpan di galeri 🖼️ perangkat ini (bukan di server) dan bisa diunduh kapan saja. Selamat menjelajah KOTA KITA! 🏙️",
  },
];

function formatCooldown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m} mnt ${s} dtk` : `${s} dtk`;
}

/** Semua elemen layar: overlay mulai + akun, bar atas, chat, teman, tombol sentuh. */
export class HUD {
  private cb: HudCallbacks;
  private toastTimer = 0;
  private jobsTimer = 0;
  private cityTimer = 0;
  /** Kapan payload jobs terakhir diterima — dasar hitung mundur cooldown LANGSUNG di panel (Tahap 10). */
  private jobsAt = 0;
  /** Mode memilih pekerjaan di panel (Tahap 10) + draf pilihan yang sedang disusun. */
  private selectingJobs = false;
  private draftChoice = new Set<string>();
  private resultTimer = 0;
  /** Sinkronisasi jam dunia terakhir dari server + jam terima — chip siang/malam berdetak lokal di antaranya (Tahap 10). */
  private worldSync: { fraction: number; at: number } | null = null;
  private tutIndex = 0;
  private lastCity: CityPayload | null = null;
  private lastJobs: JobsPayload | null = null;
  private lastQuests: QuestInfo[] = [];
  private galleryPhotos: GalleryPhoto[] = [];
  private galleryCurrentId: number | null = null;
  private seasonStyleShown = "";
  private activeShifts: ShiftInfo[] = [];
  private lastNeeds: NeedsInfo | null = null;
  private authMode: "login" | "register" | "guest" = "login";
  private loggedInUser: string | null = null;
  private nameInput: HTMLInputElement;
  private selShirt: Selector;
  private selSkin: Selector;
  private selPants: Selector;
  private selHairColor: Selector;
  private selShirtStyle: Selector;
  private selHair: Selector;

  constructor(cb: HudCallbacks) {
    this.cb = cb;

    this.nameInput = el<HTMLInputElement>("name-input");
    this.nameInput.value = window.localStorage.getItem("kota-name") ?? "";

    this.selShirt = wireSwatches("shirt-swatches", "#d64545");
    this.selSkin = wireSwatches("skin-swatches", "#f1c27d");
    this.selPants = wireSwatches("pants-swatches", "#3b4a6b");
    this.selHairColor = wireSwatches("haircolor-swatches", "#3a2a1c");
    this.selShirtStyle = wireChips("shirtstyle-chips", "polos");
    this.selHair = wireChips("hair-chips", "pendek");

    // --- Pilihan mode akun: Masuk / Daftar / Tamu ---
    el("auth-tabs").querySelectorAll<HTMLButtonElement>(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        el("auth-tabs").querySelectorAll(".chip").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        this.authMode = (btn.dataset.mode as typeof this.authMode) ?? "login";
        el("auth-fields").classList.toggle("hidden", this.authMode === "guest");
        this.setAuthError(null);
      });
    });
    el<HTMLButtonElement>("btn-logout").addEventListener("click", () => this.cb.onLogout());

    el<HTMLButtonElement>("btn-start").addEventListener("click", () => {
      const name = this.nameInput.value.trim().slice(0, 16) || "Pemain";
      window.localStorage.setItem("kota-name", name);
      const profile: Profile = {
        name,
        shirt: this.selShirt.get(),
        skin: this.selSkin.get(),
        pants: this.selPants.get(),
        hair: this.selHair.get(),
        hairColor: this.selHairColor.get(),
        shirtStyle: this.selShirtStyle.get(),
      };
      if (this.loggedInUser) {
        this.cb.onStart(profile, { mode: "account" });
        return;
      }
      if (this.authMode === "guest") {
        this.cb.onStart(profile, { mode: "guest" });
        return;
      }
      const username = el<HTMLInputElement>("auth-username").value.trim();
      const password = el<HTMLInputElement>("auth-password").value;
      if (!username || !password) {
        this.setAuthError("Isi nama pengguna dan kata sandi dulu ya.");
        return;
      }
      el("start-note").textContent = this.authMode === "login" ? "Sedang masuk…" : "Sedang membuat akun…";
      this.cb.onStart(profile, { mode: this.authMode, username, password });
    });

    // Tombol-tombol aksi — semuanya berfungsi, tidak ada tombol pajangan.
    el<HTMLButtonElement>("btn-jump").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.cb.onJump();
    });
    const runBtn = el<HTMLButtonElement>("btn-run");
    runBtn.addEventListener("click", () => {
      const on = runBtn.classList.toggle("active");
      this.cb.onRunToggle(on);
    });

    // Bar emote.
    const emoteBar = el("emote-bar");
    el<HTMLButtonElement>("btn-emote").addEventListener("click", () => {
      emoteBar.classList.toggle("hidden");
    });
    emoteBar.querySelectorAll<HTMLButtonElement>("button[data-emote]").forEach((btn) => {
      btn.addEventListener("click", () => {
        emoteBar.classList.add("hidden");
        this.cb.onEmote(btn.dataset.emote ?? "wave");
      });
    });

    el<HTMLButtonElement>("btn-interact").addEventListener("click", () => this.cb.onInteract());
    el<HTMLButtonElement>("btn-photo").addEventListener("click", () => this.cb.onPhoto());
    const soundBtn = el<HTMLButtonElement>("btn-sound");
    soundBtn.addEventListener("click", () => {
      const muted = soundBtn.dataset.muted !== "1";
      soundBtn.dataset.muted = muted ? "1" : "0";
      soundBtn.textContent = muted ? "🔇" : "🔊";
      this.cb.onToggleSound(muted);
    });
    // Tombol jam dunia (Tahap 6B): INDIKATOR waktu server, bukan toggle —
    // siang/malam sama untuk semua pemain dan tidak bisa diatur sendiri.
    el<HTMLButtonElement>("btn-daynight").addEventListener("click", () => this.cb.onDayNightInfo());

    // Panel teman & pemain.
    const friendsPanel = el("friends-panel");
    el<HTMLButtonElement>("btn-friends").addEventListener("click", () => {
      const opening = friendsPanel.classList.contains("hidden");
      friendsPanel.classList.toggle("hidden");
      if (opening) this.cb.onFriendsOpened();
    });
    el<HTMLButtonElement>("btn-friends-close").addEventListener("click", () => {
      friendsPanel.classList.add("hidden");
    });
    el<HTMLFormElement>("friend-add-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = el<HTMLInputElement>("friend-add-input");
      const username = input.value.trim();
      if (!username) return;
      input.value = "";
      this.cb.onAddFriend(username);
    });

    // Panel pekerjaan & Koin Kota (Tahap 5).
    const jobsPanel = el("jobs-panel");
    el<HTMLButtonElement>("btn-jobs").addEventListener("click", () => {
      const opening = jobsPanel.classList.contains("hidden");
      jobsPanel.classList.toggle("hidden");
      window.clearInterval(this.jobsTimer);
      if (opening) {
        this.cb.onJobsOpened();
        // Segarkan tampilan tiap detik selama panel terbuka (hitung mundur
        // cooldown & kurir) — datanya tetap dari payload server terakhir.
        this.jobsTimer = window.setInterval(() => this.renderJobsPanel(), 1000);
      }
    });
    el<HTMLButtonElement>("btn-jobs-close").addEventListener("click", () => {
      jobsPanel.classList.add("hidden");
      window.clearInterval(this.jobsTimer);
    });
    el<HTMLButtonElement>("btn-claim-bonus").addEventListener("click", () => this.cb.onClaimBonus());

    // Pilihan pekerjaan (Tahap 10): tombol ganti pilihan membuka mode
    // memilih dengan pilihan sekarang tercentang dari awal.
    el<HTMLButtonElement>("btn-change-jobs").addEventListener("click", () => {
      this.selectingJobs = true;
      this.draftChoice = new Set(this.lastJobs?.chosenJobs ?? []);
      this.renderJobsPanel();
    });

    // Kartu hasil sif (Tahap 10): ketuk untuk menutup lebih cepat.
    el("job-result-card").addEventListener("click", () => {
      el("job-result-card").classList.add("hidden");
      window.clearTimeout(this.resultTimer);
    });

    // Chip siang/malam (Tahap 10): berdetak tiap detik dari sinkronisasi
    // jam server terakhir (main.ts menyegarkannya berkala).
    window.setInterval(() => this.renderWorldChip(), 1000);

    // Tutorial (Tahap 10): tombol ❓ membuka lagi kapan saja; tombol di
    // dalam kartu menavigasi langkah & menandai selesai di perangkat ini.
    el<HTMLButtonElement>("btn-help").addEventListener("click", () => this.showTutorial());
    el<HTMLButtonElement>("btn-tut-skip").addEventListener("click", () => this.closeTutorial());
    el<HTMLButtonElement>("btn-tut-prev").addEventListener("click", () => {
      if (this.tutIndex > 0) {
        this.tutIndex--;
        this.renderTutStep();
      }
    });
    el<HTMLButtonElement>("btn-tut-next").addEventListener("click", () => {
      if (this.tutIndex >= TUTORIAL_STEPS.length - 1) {
        this.closeTutorial();
      } else {
        this.tutIndex++;
        this.renderTutStep();
      }
    });

    // Kebutuhan hidup (Tahap 6B): tombol isi ulang di panel — server yang
    // memvalidasi posisi & saldo; di sini hanya meneruskan aksinya.
    document.querySelectorAll<HTMLButtonElement>("[data-refill]").forEach((btn) => {
      btn.addEventListener("click", () => this.cb.onRefill(btn.dataset.refill ?? ""));
    });

    // Perumahan (Tahap 6): tombol pulang + panel kavling.
    el<HTMLButtonElement>("btn-home").addEventListener("click", () => this.cb.onHome());
    el<HTMLButtonElement>("btn-plot-close").addEventListener("click", () => {
      el("plot-panel").classList.add("hidden");
    });

    // Usaha Pemain (Tahap 7): panel lapak.
    el<HTMLButtonElement>("btn-lapak-close").addEventListener("click", () => {
      el("lapak-panel").classList.add("hidden");
    });

    // Kota Hidup (Tahap 8): panel kota (statistik + kabar + voting) dibuka
    // dari tiga tombol bar atas maupun Papan Pengumuman di plaza.
    for (const btnId of ["btn-stats", "btn-news", "btn-vote"]) {
      el<HTMLButtonElement>(btnId).addEventListener("click", () => this.showCityPanel());
    }
    el<HTMLButtonElement>("btn-city-close").addEventListener("click", () => {
      el("city-panel").classList.add("hidden");
      window.clearInterval(this.cityTimer);
    });

    // Galeri Foto perangkat (Tahap 9): foto mode foto yang tersimpan di
    // IndexedDB perangkat ini — bukan unggahan server.
    el<HTMLButtonElement>("btn-gallery").addEventListener("click", () => void this.openGallery());
    el<HTMLButtonElement>("btn-gallery-close").addEventListener("click", () => {
      el("gallery-panel").classList.add("hidden");
      el("gallery-viewer").classList.add("hidden");
    });
    el<HTMLButtonElement>("btn-gallery-back").addEventListener("click", () => {
      el("gallery-viewer").classList.add("hidden");
    });
    el<HTMLButtonElement>("btn-gallery-download").addEventListener("click", () => {
      const photo = this.galleryPhotos.find((p) => p.id === this.galleryCurrentId);
      if (!photo) return;
      const a = document.createElement("a");
      a.href = photo.dataUrl;
      a.download = `kota-kita-${photo.id}.png`;
      a.click();
    });
    el<HTMLButtonElement>("btn-gallery-delete").addEventListener("click", () => {
      void (async () => {
        if (this.galleryCurrentId === null) return;
        const ok = await deletePhoto(this.galleryCurrentId);
        this.toast(ok ? "Foto dihapus dari galeri perangkat ini 🗑️" : "Foto tidak bisa dihapus (penyimpanan tidak tersedia).");
        el("gallery-viewer").classList.add("hidden");
        await this.refreshGalleryGrid();
      })();
    });

    // Chat.
    const panel = el("chat-panel");
    el<HTMLButtonElement>("btn-chat").addEventListener("click", () => {
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) el<HTMLInputElement>("chat-input").focus();
    });
    el<HTMLFormElement>("chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = el<HTMLInputElement>("chat-input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      this.cb.onChat(text);
    });

    el<HTMLButtonElement>("btn-interact-close").addEventListener("click", () => {
      el("interact-card").classList.add("hidden");
    });

    window.addEventListener("keydown", (e) => {
      if (e.code !== "Enter" || panel.classList.contains("open")) return;
      if (document.getElementById("game-ui")?.classList.contains("hidden")) return;
      panel.classList.add("open");
      el<HTMLInputElement>("chat-input").focus();
    });
  }

  // ---------- Akun ----------
  setLoggedIn(username: string | null) {
    this.loggedInUser = username;
    el("auth-tabs").classList.toggle("hidden", !!username);
    el("auth-fields").classList.toggle("hidden", !!username);
    el("auth-loggedin").classList.toggle("hidden", !username);
    el("auth-status").classList.toggle("hidden", !!username);
    if (username) el("auth-user-label").textContent = `👤 Masuk sebagai @${username}`;
  }

  setAuthError(text: string | null) {
    const s = el("auth-status");
    s.textContent =
      text ??
      "Punya akun = nama & tampilan avatarmu tersimpan permanen, bisa tambah teman. Tamu = langsung main, tidak tersimpan.";
    s.classList.toggle("error", !!text);
  }

  applyProfile(p: Profile) {
    this.nameInput.value = p.name;
    this.selShirt.set(p.shirt);
    this.selSkin.set(p.skin);
    this.selPants.set(p.pants);
    this.selHairColor.set(p.hairColor);
    this.selShirtStyle.set(p.shirtStyle);
    this.selHair.set(p.hair);
  }

  // ---------- Panel teman ----------
  renderFriends(list: FriendInfo[]) {
    const box = el("friends-list");
    box.innerHTML = "";
    if (list.length === 0) {
      box.innerHTML = `<p class="friends-empty">Belum ada teman. Tambahkan lewat nama pengguna akunnya.</p>`;
      return;
    }
    for (const f of list) {
      const row = document.createElement("div");
      row.className = "friend-row";
      const dot = document.createElement("span");
      dot.className = "dot" + (f.online ? " on" : "");
      const label = document.createElement("span");
      label.className = "grow";
      label.textContent = `${f.name} (@${f.username})`;
      const status = document.createElement("span");
      status.textContent = f.online ? "online" : "offline";
      row.append(dot, label, status);
      box.appendChild(row);
    }
  }

  renderNearby(players: NearbyPlayer[], blockedNames: Set<string>) {
    const box = el("nearby-list");
    box.innerHTML = "";
    for (const p of players) {
      const row = document.createElement("div");
      row.className = "nearby-row";
      const label = document.createElement("span");
      label.className = "grow";
      label.textContent = p.isSelf ? `${p.name} (kamu)` : p.account ? `${p.name} (@${p.account})` : `${p.name} (tamu)`;
      row.appendChild(label);
      if (!p.isSelf) {
        if (p.account) {
          const add = document.createElement("button");
          add.className = "mini-btn";
          add.textContent = "➕ Teman";
          add.addEventListener("click", () => this.cb.onAddFriend(p.account));
          row.appendChild(add);
        }
        const report = document.createElement("button");
        report.className = "mini-btn";
        report.textContent = "⚠️ Lapor";
        report.addEventListener("click", () => this.cb.onReportPlayer(p.id, p.name));
        row.appendChild(report);
        const block = document.createElement("button");
        block.className = "mini-btn";
        block.textContent = blockedNames.has(p.name) ? "🔓 Buka blokir" : "🚫 Blokir";
        block.addEventListener("click", () => this.cb.onToggleBlock(p.name));
        row.appendChild(block);
      }
      box.appendChild(row);
    }
  }

  // ---------- Ekonomi (Tahap 5) ----------
  /** Chip saldo di bar atas. null = tamu/offline (tampil "—"). */
  setBalance(balance: number | null) {
    el("balance-chip").textContent = balance === null ? "🪙 — KC" : `🪙 ${balance} KC`;
  }

  renderJobs(payload: JobsPayload) {
    this.lastJobs = payload;
    this.jobsAt = Date.now();
    this.activeShifts = payload.actives ?? [];
    this.lastQuests = payload.quests ?? [];
    if (payload.balance !== null) this.setBalance(payload.balance);
    // Belum memilih 2 pekerjaan → panel langsung masuk mode memilih (Tahap 10).
    if (payload.needsChoice && !payload.guest && !this.selectingJobs) {
      this.selectingJobs = true;
      this.draftChoice = new Set(payload.chosenJobs ?? []);
    }
    this.renderJobsPanel();
  }

  /** Dipanggil main.ts saat server mengonfirmasi pilihan pekerjaan tersimpan. */
  jobChoiceSaved() {
    this.selectingJobs = false;
    this.draftChoice.clear();
  }

  /** Sisa cooldown LANGSUNG satu pekerjaan: angka server dikurangi waktu sejak payload diterima. */
  private cooldownLeft(job: JobsPayload["jobs"][number]): number {
    if (job.cooldownRemainingMs <= 0) return 0;
    return Math.max(0, job.cooldownRemainingMs - (Date.now() - this.jobsAt));
  }

  renderJobUpdate(update: JobUpdate) {
    this.activeShifts = update.actives ?? [];
    if (this.lastJobs) this.lastJobs.actives = this.activeShifts;
    this.renderJobsPanel();
  }

  /** Pembaruan quest dari server (Tahap 9): kemajuan berubah / hadiah dibayar. */
  renderQuests(quests: QuestInfo[]) {
    this.lastQuests = quests ?? [];
    if (this.lastJobs) this.lastJobs.quests = this.lastQuests;
    this.renderJobsPanel();
  }

  /** Gambar daftar quest harian ke panel pekerjaan (angka & hadiah dari server). */
  private renderQuestList() {
    const box = document.getElementById("jobs-quests");
    if (!box) return;
    box.innerHTML = "";
    if (!this.lastJobs || this.lastJobs.guest) {
      const p = document.createElement("p");
      p.className = "quest-note";
      p.textContent = "Quest harian khusus warga yang masuk dengan akun — tamu tidak punya kemajuan quest.";
      box.appendChild(p);
      return;
    }
    if (this.lastQuests.length === 0) {
      const p = document.createElement("p");
      p.className = "quest-note";
      p.textContent = "Memuat quest harian…";
      box.appendChild(p);
      return;
    }
    for (const q of this.lastQuests) {
      const row = document.createElement("div");
      row.className = "quest-row" + (q.done ? " done" : "");
      const info = document.createElement("div");
      info.className = "grow";
      const title = document.createElement("div");
      title.className = "job-title";
      title.textContent = `${q.icon} ${q.name} — 🪙 ${q.reward} KC`;
      const desc = document.createElement("div");
      desc.className = "job-desc";
      desc.textContent = q.desc;
      info.append(title, desc);
      const prog = document.createElement("span");
      prog.className = "quest-progress";
      prog.textContent = q.done ? `✅ Selesai (${q.progress}/${q.target})` : `${q.progress}/${q.target}`;
      row.append(info, prog);
      box.appendChild(row);
    }
  }

  private renderJobsPanel() {
    const data = this.lastJobs;
    const balanceBox = el("jobs-balance");
    const bonusBtn = el<HTMLButtonElement>("btn-claim-bonus");
    const activeBox = el("jobs-active");
    const activeList = el("jobs-active-list");
    const listBox = el("jobs-list");
    if (!data) {
      balanceBox.textContent = "Memuat data pekerjaan…";
      return;
    }

    balanceBox.textContent = data.guest
      ? "Kamu masuk sebagai tamu. Daftar akun dulu untuk mengumpulkan Koin Kota (KC) & bekerja. 🪙"
      : `Saldo kamu: 🪙 ${data.balance ?? 0} KC · 🔥 Streak check-in: ${data.streakCount} hari · ⚡ Sisa skip hari ini: ${data.skipAttemptsLeft}x · ${data.isNight ? "🌙 Sedang malam server" : "☀️ Sedang siang server"}`;

    const bonusVisible = !data.guest && data.bonusAvailable;
    bonusBtn.classList.toggle("hidden", !bonusVisible);
    if (bonusVisible) {
      bonusBtn.textContent = `🎁 Check-in Hari ke-${data.bonusStreakDay}: klaim +${data.bonusReward} KC`;
    }

    // Sif aktif (maks. 2) — masing-masing dengan tombol batalnya sendiri.
    const actives = this.activeShifts;
    activeBox.classList.toggle("hidden", actives.length === 0);
    activeList.innerHTML = "";
    for (const s of actives) {
      const row = document.createElement("div");
      row.className = "active-row";
      const info = document.createElement("div");
      info.className = "grow";
      const title = document.createElement("div");
      title.className = "job-title";
      title.textContent = `Sedang sif: ${s.name} (+${s.pay} KC)`;
      const prog = document.createElement("div");
      prog.className = "job-desc";
      prog.textContent = shiftProgressText(s);
      info.append(title, prog);
      const cancel = document.createElement("button");
      cancel.className = "mini-btn";
      cancel.textContent = "Batalkan";
      cancel.addEventListener("click", () => this.cb.onCancelJob(s.jobId));
      row.append(info, cancel);
      activeList.appendChild(row);
    }

    // Tombol ganti pilihan (Tahap 10): hanya untuk warga berakun yang
    // sudah punya pilihan & tidak sedang dalam mode memilih.
    const changeBtn = el<HTMLButtonElement>("btn-change-jobs");
    changeBtn.classList.toggle("hidden", data.guest || data.needsChoice || this.selectingJobs);
    if (!data.guest && !data.needsChoice) {
      changeBtn.textContent = `🔁 Ganti Pilihan Pekerjaan (${data.changeFee} KC)`;
    }

    if (this.selectingJobs && !data.guest) {
      this.renderJobSelection(listBox, data);
    } else {
      listBox.innerHTML = "";
      for (const job of data.jobs) {
        const row = document.createElement("div");
        row.className = "job-row";
        const info = document.createElement("div");
        info.className = "grow";
        const title = document.createElement("div");
        title.className = "job-title";
        title.textContent = `${job.name} — 🪙 ${job.pay} KC`;
        if (!data.guest) {
          const tag = document.createElement("span");
          const isChosen = (data.chosenJobs ?? []).includes(job.id);
          tag.className = "job-tag " + (isChosen ? "mine" : "notmine");
          tag.textContent = isChosen ? "📌 Pekerjaanmu" : "Bukan pilihanmu";
          title.appendChild(tag);
        }
        const desc = document.createElement("div");
        desc.className = "job-desc";
        desc.textContent = job.desc;
        // Status LANGSUNG per baris (Tahap 10): sedang sif / cooldown
        // berdetak / siap / bukan pilihanmu.
        const status = document.createElement("div");
        status.className = "job-status";
        const isActive = actives.some((s) => s.jobId === job.id);
        const cdLeft = this.cooldownLeft(job);
        const isChosen = (data.chosenJobs ?? []).includes(job.id);
        if (data.guest) status.textContent = "🔒 Perlu akun untuk bekerja";
        else if (isActive) status.textContent = "🟢 Sedang sif";
        else if (!isChosen) status.textContent = "📌 Bukan pilihanmu — tidak bisa diambil";
        else if (cdLeft > 0) status.textContent = `💤 Cooldown: ${formatCooldown(cdLeft)} lagi`;
        else if (job.nightOnly && !data.isNight) status.textContent = "🌙 Siap — khusus malam server";
        else status.textContent = "✅ Siap diambil";
        info.append(title, desc, status);
        row.appendChild(info);

        const btn = document.createElement("button");
        btn.className = "mini-btn";
        if (data.guest) {
          btn.textContent = "Perlu akun";
          btn.disabled = true;
          row.appendChild(btn);
        } else if (isActive) {
          btn.textContent = "Sedang sif";
          btn.disabled = true;
          row.appendChild(btn);
        } else if (!isChosen) {
          btn.textContent = "Bukan pilihanmu";
          btn.disabled = true;
          row.appendChild(btn);
        } else if (cdLeft > 0) {
          btn.textContent = `💤 ${formatCooldown(cdLeft)}`;
          btn.disabled = true;
          row.appendChild(btn);
          // Skip berbayar: biaya TERBAKAR & hangus bila sif dibatalkan/gagal —
          // peringatan WAJIB tampil sebelum pembayaran (aturan Tahap 6B).
          if (data.skipAttemptsLeft > 0) {
            const skipBtn = document.createElement("button");
            skipBtn.className = "mini-btn skip-btn";
            skipBtn.textContent = `⚡ Skip ${job.skipFee} KC (${data.skipAttemptsLeft}x)`;
            skipBtn.addEventListener("click", () => {
              const yakin = window.confirm(
                `Skip cooldown "${job.name}" seharga ${job.skipFee} KC?\n\n` +
                  `⚠️ Biaya ini TERBAKAR (hilang dari peredaran) dan HANGUS — tidak kembali walau sif sesudahnya kamu batalkan atau gagal (mis. antar kelewat waktu).\n` +
                  `Jatah skip hari ini tersisa ${data.skipAttemptsLeft}x. Lanjut bayar?`
              );
              if (yakin) this.cb.onSkipJob(job.id);
            });
            row.appendChild(skipBtn);
          }
        } else if (job.nightOnly && !data.isNight) {
          btn.textContent = "🌙 Khusus malam";
          btn.disabled = true;
          row.appendChild(btn);
        } else if (actives.length >= 2) {
          btn.textContent = "Sif penuh (2)";
          btn.disabled = true;
          row.appendChild(btn);
        } else {
          btn.textContent = "Mulai sif";
          btn.addEventListener("click", () => this.cb.onStartJob(job.id));
          row.appendChild(btn);
        }
        listBox.appendChild(row);
      }
    }

    // Statistik pekerjaan per akun (Tahap 10).
    this.renderJobStats(data);

    // Quest sosial harian (Tahap 9) — di bawah daftar pekerjaan.
    this.renderQuestList();
  }

  /**
   * Mode memilih pekerjaan (Tahap 10): 6 baris bisa diketuk (maks. 2),
   * tombol simpan aktif hanya saat tepat 2 terpilih. Pilihan pertama
   * gratis; mengganti pilihan yang sudah ada menampilkan peringatan biaya.
   */
  private renderJobSelection(box: HTMLElement, data: JobsPayload) {
    box.innerHTML = "";
    const changing = (data.chosenJobs ?? []).length > 0;
    const note = document.createElement("p");
    note.className = "choice-note";
    note.textContent = changing
      ? `🔁 Ganti pilihan pekerjaanmu. Memilih himpunan yang BERBEDA dikenakan biaya ${data.changeFee} KC (terbakar). Pilihan yang sama persis ditolak tanpa biaya. Cooldown pekerjaanmu TIDAK ikut reset.`
      : `👋 Selamat datang di KOTA KITA! Pilih 2 pekerjaan — hanya ini yang bisa kamu ambil. Ganti pilihan nanti bayar ${data.changeFee} KC, jadi pilih yang paling kamu suka. Pilihan pertama ini GRATIS.`;
    box.appendChild(note);

    for (const job of data.jobs) {
      const picked = this.draftChoice.has(job.id);
      const row = document.createElement("div");
      row.className = "job-row choice-row" + (picked ? " picked" : "");
      const check = document.createElement("span");
      check.className = "choice-check";
      check.textContent = picked ? "✅" : "⬜";
      const info = document.createElement("div");
      info.className = "grow";
      const title = document.createElement("div");
      title.className = "job-title";
      title.textContent = `${job.name} — 🪙 ${job.pay} KC`;
      const desc = document.createElement("div");
      desc.className = "job-desc";
      desc.textContent = job.desc;
      info.append(title, desc);
      row.append(check, info);
      row.addEventListener("click", () => {
        if (this.draftChoice.has(job.id)) {
          this.draftChoice.delete(job.id);
        } else {
          if (this.draftChoice.size >= 2) {
            this.toast("Maksimal 2 pekerjaan ya — lepas salah satu dulu untuk mengganti.");
            return;
          }
          this.draftChoice.add(job.id);
        }
        this.renderJobsPanel();
      });
      box.appendChild(row);
    }

    const actions = document.createElement("div");
    actions.id = "jobs-choice-actions";
    const save = document.createElement("button");
    save.className = "plot-action-btn";
    save.textContent =
      this.draftChoice.size === 2
        ? changing
          ? `💾 Simpan Pilihan (${data.changeFee} KC)`
          : "💾 Simpan Pilihan (Gratis)"
        : `Pilih ${2 - this.draftChoice.size} pekerjaan lagi`;
    save.disabled = this.draftChoice.size !== 2;
    save.addEventListener("click", () => {
      if (this.draftChoice.size !== 2) return;
      if (changing) {
        const yakin = window.confirm(
          `Ganti pilihan pekerjaan? Biaya ${data.changeFee} KC TERBAKAR (hilang dari peredaran).\n\nSaldo kamu sekarang ${data.balance ?? 0} KC. Lanjut?`
        );
        if (!yakin) return;
      }
      this.cb.onChooseJobs([...this.draftChoice]);
    });
    actions.appendChild(save);
    if (changing) {
      const cancel = document.createElement("button");
      cancel.className = "plot-action-btn";
      cancel.textContent = "↩️ Batal";
      cancel.addEventListener("click", () => {
        this.selectingJobs = false;
        this.draftChoice = new Set(data.chosenJobs ?? []);
        this.renderJobsPanel();
      });
      actions.appendChild(cancel);
    }
    box.appendChild(actions);
  }

  /** Statistik pekerjaan per akun (Tahap 10) — angka dari payload server; dihitung sejak Tahap 10. */
  private renderJobStats(data: JobsPayload) {
    const box = document.getElementById("jobs-stats");
    if (!box) return;
    box.innerHTML = "";
    if (data.guest) {
      const p = document.createElement("p");
      p.className = "quest-note";
      p.textContent = "Statistik pekerjaan khusus warga yang masuk dengan akun.";
      box.appendChild(p);
      return;
    }
    let totalDone = 0;
    let totalFailed = 0;
    let totalEarned = 0;
    for (const job of data.jobs) {
      const st = data.jobStats?.[job.id] ?? { done: 0, failed: 0, earned: 0 };
      totalDone += st.done;
      totalFailed += st.failed;
      totalEarned += st.earned;
      const row = document.createElement("div");
      row.className = "stat-row";
      const name = document.createElement("span");
      name.className = "grow";
      name.textContent = job.name;
      const vals = document.createElement("span");
      vals.textContent = `✅ ×${st.done} · ❌ ×${st.failed} · 🪙 ${st.earned} KC`;
      row.append(name, vals);
      box.appendChild(row);
    }
    const total = document.createElement("div");
    total.className = "stat-row total";
    const tName = document.createElement("span");
    tName.className = "grow";
    tName.textContent = "Total semua pekerjaan";
    const tVals = document.createElement("span");
    tVals.textContent = `✅ ×${totalDone} · ❌ ×${totalFailed} · 🪙 ${totalEarned} KC`;
    total.append(tName, tVals);
    box.appendChild(total);
  }

  // ---------- Kebutuhan hidup & waktu dunia (Tahap 6B) ----------
  /** Gambar meter kebutuhan (panel + strip ringkas) dari pesan server. */
  renderNeeds(needs: NeedsInfo) {
    this.lastNeeds = needs;
    const paint = (fillId: string, valId: string, stripId: string, value: number) => {
      const fill = document.getElementById(fillId);
      if (fill) {
        fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
        fill.classList.toggle("low", value <= needs.warnAt && value > 0);
        fill.classList.toggle("crit", value <= 0);
      }
      const val = document.getElementById(valId);
      if (val) val.textContent = String(Math.round(value));
      const strip = document.getElementById(stripId);
      if (strip) {
        strip.style.width = `${Math.max(0, Math.min(100, value))}%`;
        strip.classList.toggle("low", value <= needs.warnAt && value > 0);
        strip.classList.toggle("crit", value <= 0);
      }
    };
    paint("need-hunger-fill", "need-hunger-val", "ns-hunger-fill", needs.hunger);
    paint("need-thirst-fill", "need-thirst-val", "ns-thirst-fill", needs.thirst);
    paint("need-toilet-fill", "need-toilet-val", "ns-toilet-fill", needs.toilet);
  }

  /** Indikator jam dunia di bar atas: ikon mengikuti waktu server. */
  setWorldIndicator(isNight: boolean) {
    const btn = el<HTMLButtonElement>("btn-daynight");
    btn.textContent = isNight ? "🌙" : "☀️";
    btn.title = isNight
      ? "Malam server — Satpam Malam bisa diambil (waktu diatur server)"
      : "Siang server (waktu diatur server, sama untuk semua pemain)";
  }

  // ---------- Tahap 10: kartu hasil, chip siang/malam, panah, tutorial ----------

  /** Kartu hasil sif: berhasil (+gaji & cooldown dimulai) atau gagal (alasan). Hilang sendiri ±6 detik / diketuk. */
  showJobResult(ok: boolean, info: JobDoneInfo | JobFailedInfo) {
    const card = el("job-result-card");
    const title = el("job-result-title");
    const body = el("job-result-body");
    card.classList.remove("success", "fail");
    card.classList.add(ok ? "success" : "fail");
    if (ok) {
      const done = info as JobDoneInfo;
      title.textContent = `🎉 Sif Selesai: ${done.name}`;
      const cdMin = Math.round(done.cooldownMs / 60000);
      body.textContent = `+${done.pay} KC 💪\nCooldown dimulai: ${cdMin} mnt`;
    } else {
      const failed = info as JobFailedInfo;
      title.textContent = `😞 Sif Gagal: ${failed.name}`;
      body.textContent = `${failed.reason}\nTidak ada gaji — coba lagi kapan-kapan!`;
    }
    card.classList.remove("hidden");
    window.clearTimeout(this.resultTimer);
    this.resultTimer = window.setTimeout(() => card.classList.add("hidden"), 6000);
  }

  /** Terima sinkronisasi jam dunia dari server (dipanggil main.ts berkala). */
  setWorldTime(fraction: number) {
    this.worldSync = { fraction, at: Date.now() };
    this.renderWorldChip();
  }

  /** Chip siang/malam + hitung mundur ke pergantian fase — diekstrapolasi lokal dari sinkronisasi terakhir. */
  private renderWorldChip() {
    const chip = document.getElementById("world-chip");
    if (!chip || !this.worldSync) return;
    const elapsed = (Date.now() - this.worldSync.at) / WORLD_DAY_MS_CLIENT;
    const f = (((this.worldSync.fraction + elapsed) % 1) + 1) % 1;
    const isDay = f < WORLD_DAY_FRACTION_CLIENT;
    const remainMs = (isDay ? WORLD_DAY_FRACTION_CLIENT - f : 1 - f) * WORLD_DAY_MS_CLIENT;
    const totalSec = Math.max(0, Math.ceil(remainMs / 1000));
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    chip.textContent = isDay ? `☀️ Siang · ${mm}:${ss}` : `🌙 Malam · ${mm}:${ss}`;
    chip.title = isDay
      ? `Siang server — malam tiba dalam ${mm}:${ss} (diatur server)`
      : `Malam server — siang tiba dalam ${mm}:${ss} (diatur server)`;
  }

  /**
   * Panah penunjuk tujuan sif (di bawah layar): mengarah ke tujuan sif
   * aktif TERDEKAT, relatif terhadap arah pandang kamera. Dipanggil
   * main.ts setiap frame dengan posisi pemain & yaw kamera.
   */
  updateNavArrow(px: number, pz: number, camYaw: number) {
    const box = document.getElementById("nav-arrow");
    if (!box) return;
    let best: { s: ShiftInfo; d: number } | null = null;
    for (const s of this.activeShifts) {
      if (!s.objective) continue;
      const d = Math.hypot(s.objective.x - px, s.objective.z - pz);
      if (!best || d < best.d) best = { s, d };
    }
    if (!best) {
      box.classList.add("hidden");
      return;
    }
    const o = best.s.objective;
    const dx = o.x - px;
    const dz = o.z - pz;
    const dist = Math.max(best.d, 0.001);
    // Sumbu kamera di tanah: maju & kanan (cermin main.ts).
    const fwdX = -Math.sin(camYaw);
    const fwdZ = -Math.cos(camYaw);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    const fwdComp = (dx * fwdX + dz * fwdZ) / dist;
    const rightComp = (dx * rightX + dz * rightZ) / dist;
    const deg = (Math.atan2(rightComp, fwdComp) * 180) / Math.PI;
    const glyph = document.getElementById("nav-arrow-glyph");
    if (glyph) glyph.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    const label = document.getElementById("nav-arrow-label");
    if (label) label.textContent = o.label;
    const distEl = document.getElementById("nav-arrow-dist");
    if (distEl) distEl.textContent = `${Math.round(best.d)} m`;
    box.classList.remove("hidden");
  }

  /** Tampilkan tutorial dari langkah pertama (tombol ❓ / pertama masuk). */
  showTutorial() {
    this.tutIndex = 0;
    this.renderTutStep();
    el("tutorial-overlay").classList.remove("hidden");
  }

  /** Tutorial hanya muncul sendiri SEKALI per perangkat (bendera localStorage). */
  maybeShowTutorial() {
    let done = false;
    try {
      done = window.localStorage.getItem("kota-tutorial-done") === "1";
    } catch {
      done = false;
    }
    if (!done) this.showTutorial();
  }

  private closeTutorial() {
    el("tutorial-overlay").classList.add("hidden");
    try {
      window.localStorage.setItem("kota-tutorial-done", "1");
    } catch {
      /* penyimpanan tidak tersedia — tutorial akan tampil lagi sesi berikutnya */
    }
  }

  private renderTutStep() {
    const step = TUTORIAL_STEPS[this.tutIndex];
    el("tut-icon").textContent = step.icon;
    el("tut-title").textContent = step.title;
    el("tut-text").textContent = step.text;
    el("tut-dots").textContent = TUTORIAL_STEPS.map((_, i) => (i === this.tutIndex ? "●" : "○")).join("");
    el<HTMLButtonElement>("btn-tut-prev").disabled = this.tutIndex === 0;
    el<HTMLButtonElement>("btn-tut-next").textContent =
      this.tutIndex >= TUTORIAL_STEPS.length - 1 ? "Mulai Main! 🎉" : "Lanjut ➡️";
  }

  // ---------- Perumahan (Tahap 6) ----------
  get plotPanelOpen(): boolean {
    return !el("plot-panel").classList.contains("hidden");
  }

  /** Gambar panel kavling dari tampilan yang dihitung main.ts (data state server). */
  showPlot(view: PlotView) {
    el("plot-title").textContent = `🏠 ${view.title}`;
    const lines = [
      `${view.tierLabel} — harga klaim 🪙 ${view.price} KC`,
      view.owner ? `Pemilik: @${view.owner}${view.isMine ? " (kamu)" : ""}` : "Status: masih kosong",
      view.owner ? `Bangunan: ${view.houseName || "tanah kosong"}` : "",
    ].filter(Boolean);
    el("plot-info").textContent = lines.join("\n");

    const box = el("plot-actions");
    box.innerHTML = "";
    if (view.note) {
      const note = document.createElement("p");
      note.className = "plot-note";
      note.textContent = view.note;
      box.appendChild(note);
    }
    if (view.canClaim) {
      const btn = document.createElement("button");
      btn.className = "plot-action-btn";
      btn.textContent = `🪙 Klaim kavling ini — ${view.price} KC`;
      btn.addEventListener("click", () => this.cb.onClaimPlot(view.plotId));
      box.appendChild(btn);
    }
    if (view.isMine) {
      for (const opt of view.tiers) {
        const btn = document.createElement("button");
        btn.className = "plot-action-btn";
        if (opt.current) {
          btn.textContent = `✅ ${opt.name} (sudah berdiri)`;
          btn.disabled = true;
        } else if (opt.locked) {
          btn.textContent = `🔒 ${opt.name} — khusus Kavling 2`;
          btn.disabled = true;
        } else {
          btn.textContent = opt.isUpgrade
            ? `⬆️ Upgrade ke ${opt.name} — 🪙 ${opt.cost} KC (selisih)`
            : `🔨 Bangun ${opt.name} — 🪙 ${opt.cost} KC`;
          btn.addEventListener("click", () => this.cb.onBuildHouse(opt.tier));
        }
        box.appendChild(btn);
      }
    }
    el("plot-panel").classList.remove("hidden");
  }

  hidePlot() {
    el("plot-panel").classList.add("hidden");
  }

  // ---------- Usaha Pemain (Tahap 7) ----------
  get lapakPanelOpen(): boolean {
    return !el("lapak-panel").classList.contains("hidden");
  }

  /** Gambar panel lapak: tampilan klaim / pembeli / pemilik sesuai LapakView dari main.ts. */
  showLapak(view: LapakView) {
    el("lapak-title").textContent = `🏪 ${view.title}`;
    const lines = view.owner
      ? [
          `Nama lapak: ${view.lapakName}`,
          `Pemilik: @${view.owner}${view.isMine ? " (kamu)" : ""}`,
        ]
      : ["Status: masih kosong — belum ada pemiliknya."];
    el("lapak-info").textContent = lines.join("\n");

    const box = el("lapak-actions");
    box.innerHTML = "";
    if (view.note) {
      const note = document.createElement("p");
      note.className = "lapak-note";
      note.textContent = view.note;
      box.appendChild(note);
    }

    if (view.canClaim) {
      const btn = document.createElement("button");
      btn.className = "lapak-action-btn";
      btn.textContent = "🪙 Klaim lapak ini — 10.000 KC";
      btn.addEventListener("click", () => this.cb.onClaimLapak(view.lapakId));
      box.appendChild(btn);
    }

    // --- Tampilan pembeli: menu lapak orang lain ---
    if (view.owner && !view.isMine) {
      for (const item of view.items) {
        const row = document.createElement("div");
        row.className = "lapak-item-row";
        const info = document.createElement("div");
        info.className = "lapak-item-info";
        const name = document.createElement("div");
        name.className = "lapak-item-name";
        name.textContent = `${item.name} — 🪙 ${item.price} KC`;
        const sub = document.createElement("div");
        sub.className = "lapak-item-sub";
        sub.textContent = item.stocked ? item.effectText : "Stok sedang ditutup pemilik";
        info.append(name, sub);
        row.appendChild(info);
        const btn = document.createElement("button");
        btn.className = "mini-btn";
        if (!item.stocked) {
          btn.textContent = "Habis";
          btn.disabled = true;
        } else if (view.balance === null) {
          btn.textContent = "Perlu akun";
          btn.disabled = true;
        } else if (view.balance < item.price) {
          btn.textContent = "Saldo kurang";
          btn.disabled = true;
        } else {
          btn.textContent = "Beli";
          btn.addEventListener("click", () => this.cb.onBuyLapakItem(view.lapakId, item.id));
        }
        row.appendChild(btn);
        box.appendChild(row);
      }
    }

    // --- Tampilan pemilik: kas, nama, harga & stok, log penjualan ---
    if (view.isMine) {
      const kasBtn = document.createElement("button");
      kasBtn.className = "lapak-action-btn";
      kasBtn.textContent =
        view.kas > 0 ? `💰 Ambil Kas Usaha — 🪙 ${view.kas} KC` : "💰 Kas usaha masih kosong";
      kasBtn.disabled = view.kas <= 0;
      kasBtn.addEventListener("click", () => this.cb.onCollectKas());
      box.appendChild(kasBtn);

      const nameInput = document.createElement("input");
      nameInput.className = "lapak-name-input";
      nameInput.maxLength = 20;
      nameInput.placeholder = "Nama lapak (maks. 20 huruf)";
      nameInput.value = view.lapakName;
      box.appendChild(nameInput);
      const nameBtn = document.createElement("button");
      nameBtn.className = "lapak-action-btn";
      nameBtn.textContent = "✏️ Simpan Nama Lapak";
      nameBtn.addEventListener("click", () => {
        const v = nameInput.value.trim();
        if (v) this.cb.onSetLapakName(v);
      });
      box.appendChild(nameBtn);

      for (const item of view.items) {
        const row = document.createElement("div");
        row.className = "lapak-item-row";
        const info = document.createElement("div");
        info.className = "lapak-item-info";
        const name = document.createElement("div");
        name.className = "lapak-item-name";
        name.textContent = item.name;
        const sub = document.createElement("div");
        sub.className = "lapak-item-sub";
        sub.textContent = `${item.effectText} · harga sah ${item.minPrice}–${item.maxPrice} KC`;
        info.append(name, sub);
        row.appendChild(info);

        const priceInput = document.createElement("input");
        priceInput.className = "lapak-price-input";
        priceInput.type = "number";
        priceInput.min = String(item.minPrice);
        priceInput.max = String(item.maxPrice);
        priceInput.value = String(item.price);
        row.appendChild(priceInput);

        const stockBtn = document.createElement("button");
        stockBtn.className = "mini-btn";
        stockBtn.textContent = item.stocked ? "✅ Dijual" : "🚫 Tutup";
        let stocked = item.stocked;
        stockBtn.addEventListener("click", () => {
          stocked = !stocked;
          stockBtn.textContent = stocked ? "✅ Dijual" : "🚫 Tutup";
        });
        row.appendChild(stockBtn);

        const saveBtn = document.createElement("button");
        saveBtn.className = "mini-btn";
        saveBtn.textContent = "Simpan";
        saveBtn.addEventListener("click", () => {
          const price = Number(priceInput.value);
          if (!Number.isFinite(price)) return;
          this.cb.onSetLapakItem(item.id, price, stocked);
        });
        row.appendChild(saveBtn);
        box.appendChild(row);
      }

      const salesTitle = document.createElement("div");
      salesTitle.className = "lapak-sales-title";
      salesTitle.textContent = `🧾 Penjualan terakhir · 🎁 Suvenir batikmu: ${view.souvenirs}`;
      box.appendChild(salesTitle);
      const salesBox = document.createElement("div");
      salesBox.className = "lapak-sales";
      if (view.sales.length === 0) {
        salesBox.textContent = "Belum ada penjualan. Ajak warga mampir ke lapakmu!";
      } else {
        const itemName = (id: string) => view.items.find((i) => i.id === id)?.name ?? id;
        salesBox.textContent = [...view.sales]
          .reverse()
          .map((s) => `• @${s.buyer} membeli ${itemName(s.item)} — 🪙 ${s.price} KC`)
          .join("\n");
        salesBox.style.whiteSpace = "pre-line";
      }
      box.appendChild(salesBox);
    }

    el("lapak-panel").classList.remove("hidden");
  }

  hideLapak() {
    el("lapak-panel").classList.add("hidden");
  }

  // ---------- Kota Hidup (Tahap 8) ----------
  get cityPanelOpen(): boolean {
    return !el("city-panel").classList.contains("hidden");
  }

  /** Buka panel kota & minta data terbaru dari server; hitung mundur voting disegarkan tiap detik. */
  showCityPanel() {
    el("city-panel").classList.remove("hidden");
    this.cb.onCityOpened();
    window.clearInterval(this.cityTimer);
    this.cityTimer = window.setInterval(() => this.renderCityCountdown(), 1000);
  }

  hideCity() {
    el("city-panel").classList.add("hidden");
    window.clearInterval(this.cityTimer);
  }

  private formatRemaining(closesAt: number): string {
    const left = Math.max(0, closesAt - Date.now());
    const totalSec = Math.ceil(left / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `⏳ Ditutup dalam ±${h} jam ${m} menit`;
    if (m > 0) return `⏳ Ditutup dalam ±${m} menit ${s} detik`;
    return `⏳ Ditutup dalam ±${s} detik`;
  }

  private renderCityCountdown() {
    const node = document.getElementById("city-vote-time");
    if (node && this.lastCity?.vote) node.textContent = this.formatRemaining(this.lastCity.vote.closesAt);
  }

  /** Gambar panel kota dari payload server: statistik, voting (tally langsung), dan Kabar Kota. */
  renderCity(payload: CityPayload) {
    this.lastCity = payload;
    el("city-stats").textContent = [
      `👥 Penduduk terdaftar: ${payload.residents} warga`,
      `🟢 Warga online sekarang: ${payload.online}`,
      `🏠 Rumah berdiri: ${payload.houses}`,
      `🏪 Lapak aktif: ${payload.lapaks}`,
      `🏦 Kas Kota: 🪙 ${payload.kasKota} KC`,
    ].join("\n");

    // --- Voting ---
    const voteBox = el("city-vote");
    voteBox.innerHTML = "";
    if (payload.lastResult) {
      const r = payload.lastResult;
      const line = document.createElement("p");
      line.className = "city-last-result";
      line.textContent = r.passed
        ? `Hasil terakhir: ${r.icon} ${r.name} LOLOS ✅ (setuju ${r.yes} · tolak ${r.no})`
        : `Hasil terakhir: ${r.icon} ${r.name} belum lolos ❌ (setuju ${r.yes} · tolak ${r.no})`;
      voteBox.appendChild(line);
    }
    const v = payload.vote;
    if (!v) {
      const p = document.createElement("p");
      p.className = "city-vote-desc";
      p.textContent =
        payload.facilities.length >= 3
          ? "Semua fasilitas usulan sudah terbangun. Terima kasih sudah ikut membangun kota! 🎉"
          : "Saat ini tidak ada usulan yang sedang divoting.";
      voteBox.appendChild(p);
    } else {
      const title = document.createElement("div");
      title.className = "city-vote-title";
      title.textContent = `${v.icon} ${v.name}`;
      const desc = document.createElement("p");
      desc.className = "city-vote-desc";
      desc.textContent = v.desc;
      const tally = document.createElement("p");
      tally.className = "city-vote-tally";
      tally.textContent = `Setuju ${v.yes} · Tolak ${v.no} — lolos bila setuju ≥ ${v.minYes} dan lebih banyak dari menolak.`;
      const time = document.createElement("p");
      time.className = "city-vote-time";
      time.id = "city-vote-time";
      time.textContent = this.formatRemaining(v.closesAt);
      voteBox.append(title, desc, tally, time);

      if (payload.guest) {
        const note = document.createElement("p");
        note.className = "city-vote-note";
        note.textContent = "Kamu masuk sebagai tamu — voting hanya untuk warga yang masuk dengan akun. Daftar dulu ya!";
        voteBox.appendChild(note);
      } else if (v.myVote) {
        const note = document.createElement("p");
        note.className = "city-vote-note";
        note.textContent = `Kamu sudah memilih: ${v.myVote === "yes" ? "SETUJU ✅" : "TOLAK ❌"} — suara bersifat final.`;
        voteBox.appendChild(note);
      } else {
        const row = document.createElement("div");
        row.className = "city-vote-btns";
        const yesBtn = document.createElement("button");
        yesBtn.className = "city-vote-btn yes";
        yesBtn.textContent = "✅ Setuju";
        yesBtn.addEventListener("click", () => this.cb.onVote("yes"));
        const noBtn = document.createElement("button");
        noBtn.className = "city-vote-btn no";
        noBtn.textContent = "❌ Tolak";
        noBtn.addEventListener("click", () => this.cb.onVote("no"));
        row.append(yesBtn, noBtn);
        voteBox.appendChild(row);
      }
    }

    // --- Kabar Kota (terbaru di depan) ---
    const newsBox = el("city-news");
    newsBox.innerHTML = "";
    if (payload.news.length === 0) {
      newsBox.innerHTML = `<p class="city-news-empty">Belum ada kabar. Peristiwa kota akan tercatat di sini.</p>`;
    } else {
      for (const entry of payload.news) {
        const row = document.createElement("div");
        row.className = "city-news-row";
        const when = new Date(entry.ts).toLocaleString("id-ID", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        const text = document.createElement("span");
        text.className = "grow";
        text.textContent = `${entry.icon} ${entry.text}`;
        const time = document.createElement("span");
        time.className = "city-news-time";
        time.textContent = when;
        row.append(text, time);
        newsBox.appendChild(row);
      }
    }
  }

  // ---------- Tahap 9: banner event, musim & galeri ----------

  /** Banner event komunitas aktif (dari state server); null menyembunyikannya. */
  setEventBanner(event: { type: string; name: string; endsAt: number } | null) {
    const banner = document.getElementById("event-banner");
    if (!banner) return;
    if (!event) {
      banner.classList.add("hidden");
      return;
    }
    const left = Math.max(0, event.endsAt - Date.now());
    const totalSec = Math.ceil(left / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    banner.textContent = `${event.name} sedang berlangsung di Plaza Utama — berakhir dalam ${m}:${String(s).padStart(2, "0")}`;
    banner.classList.remove("hidden");
  }

  /**
   * Editor avatar: chip gaya musiman hanya ditawarkan saat server bilang
   * musimnya aktif. Chip yang sedang terpilih TIDAK disembunyikan walau
   * musim berganti — gaya yang sudah terpasang tetap terpasang.
   */
  setSeason(style: string, label: string) {
    if (style === this.seasonStyleShown) return;
    this.seasonStyleShown = style;
    document.querySelectorAll<HTMLButtonElement>("#shirtstyle-chips .seasonal-chip").forEach((chip) => {
      chip.classList.toggle("hidden", chip.dataset.season !== style);
    });
    const note = document.getElementById("season-note");
    if (note) {
      note.textContent = style
        ? `Musim spesial sedang aktif: ${label} — gaya baju musimannya bisa dipilih di Model Baju (gratis, terbatas waktu).`
        : "";
      note.classList.toggle("hidden", !style);
    }
  }

  /** Buka panel galeri & muat foto perangkat (terbaru di depan). */
  async openGallery() {
    el("gallery-panel").classList.remove("hidden");
    el("gallery-viewer").classList.add("hidden");
    await this.refreshGalleryGrid();
  }

  private async refreshGalleryGrid() {
    const grid = el("gallery-grid");
    grid.innerHTML = "";
    this.galleryPhotos = await listPhotos();
    el("gallery-empty").classList.toggle("hidden", this.galleryPhotos.length > 0);
    for (const photo of this.galleryPhotos) {
      const btn = document.createElement("button");
      btn.className = "gallery-thumb";
      const img = document.createElement("img");
      img.src = photo.dataUrl;
      img.alt = `Foto ${new Date(photo.ts).toLocaleString("id-ID")}`;
      const caption = document.createElement("span");
      caption.textContent = new Date(photo.ts).toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      btn.append(img, caption);
      btn.addEventListener("click", () => this.showGalleryPhoto(photo));
      grid.appendChild(btn);
    }
  }

  private showGalleryPhoto(photo: GalleryPhoto) {
    this.galleryCurrentId = photo.id;
    el<HTMLImageElement>("gallery-img").src = photo.dataUrl;
    el("gallery-viewer").classList.remove("hidden");
  }

  // ---------- Umum ----------
  hideOverlay() {
    el("start-overlay").classList.add("hidden");
    el("game-ui").classList.remove("hidden");
  }

  setStatus(text: string, online: boolean) {
    const s = el("conn-status");
    s.textContent = (online ? "🟢 " : "🟡 ") + text;
  }

  setPlayerCount(n: number) {
    el("player-count").textContent = `👥 ${n} pemain`;
  }

  toast(text: string, ms = 2600) {
    const t = el("toast");
    t.textContent = text;
    t.classList.remove("hidden");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.add("hidden"), ms);
  }

  addChat(name: string, text: string, self: boolean) {
    const box = el("chat-messages");
    const row = document.createElement("div");
    row.className = "chat-row" + (self ? " self" : "");
    const who = document.createElement("b");
    who.textContent = name + ": ";
    row.appendChild(who);
    row.appendChild(document.createTextNode(text));
    box.appendChild(row);
    while (box.children.length > 40) box.removeChild(box.firstChild!);
    box.scrollTop = box.scrollHeight;
  }

  setInteract(label: string | null) {
    const btn = el<HTMLButtonElement>("btn-interact");
    if (label) {
      btn.classList.remove("hidden");
      el("interact-label").textContent = label;
    } else {
      btn.classList.add("hidden");
    }
  }

  showCard(title: string, desc: string) {
    el("interact-title").textContent = title;
    el("interact-desc").textContent = desc;
    el("interact-card").classList.remove("hidden");
  }
}
