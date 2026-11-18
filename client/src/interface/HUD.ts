import type { Profile, FriendInfo, JobsPayload, JobUpdate, ShiftInfo } from "../multiplayer/Network";

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

export interface HudCallbacks {
  onStart: (profile: Profile, auth: AuthIntent) => void;
  onLogout: () => void;
  onJump: () => void;
  onRunToggle: (on: boolean) => void;
  onEmote: (emote: string) => void;
  onInteract: () => void;
  onPhoto: () => void;
  onDayNight: (night: boolean) => void;
  onToggleSound: (muted: boolean) => void;
  onChat: (text: string) => void;
  onAddFriend: (username: string) => void;
  onReportPlayer: (id: string, name: string) => void;
  onToggleBlock: (name: string) => void;
  onFriendsOpened: () => void;
  onJobsOpened: () => void;
  onClaimBonus: () => void;
  onStartJob: (jobId: string) => void;
  onCancelJob: () => void;
  onHome: () => void;
  onClaimPlot: (plotId: string) => void;
  onBuildHouse: (tier: number) => void;
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
    return `🧍 Berjaga di Warung Kopi: ${Math.floor(s.progressMs / 1000)}/${Math.round(s.needMs / 1000)} detik`;
  }
  if (s.kind === "visit") {
    return `🧹 Titik bersih-bersih: ${s.visitedCount}/${s.totalPoints}`;
  }
  if (s.kind === "deliver") {
    if (s.phase === "pickup") return "📦 Ambil paket di teras Balai Kota";
    const left = Math.max(0, Math.ceil((s.deadline - Date.now()) / 1000));
    return `📦 Antar ke ${s.targetName} — sisa ${left} detik`;
  }
  return "";
}

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
  private lastJobs: JobsPayload | null = null;
  private activeShift: ShiftInfo | null = null;
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
    const dnBtn = el<HTMLButtonElement>("btn-daynight");
    dnBtn.addEventListener("click", () => {
      const night = dnBtn.dataset.night !== "1";
      dnBtn.dataset.night = night ? "1" : "0";
      dnBtn.textContent = night ? "☀️" : "🌙";
      this.cb.onDayNight(night);
    });

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
    el<HTMLButtonElement>("btn-job-cancel").addEventListener("click", () => this.cb.onCancelJob());

    // Perumahan (Tahap 6): tombol pulang + panel kavling.
    el<HTMLButtonElement>("btn-home").addEventListener("click", () => this.cb.onHome());
    el<HTMLButtonElement>("btn-plot-close").addEventListener("click", () => {
      el("plot-panel").classList.add("hidden");
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
    this.activeShift = payload.active;
    if (payload.balance !== null) this.setBalance(payload.balance);
    this.renderJobsPanel();
  }

  renderJobUpdate(update: JobUpdate) {
    this.activeShift = update.active;
    if (this.lastJobs) this.lastJobs.active = update.active;
    this.renderJobsPanel();
  }

  private renderJobsPanel() {
    const data = this.lastJobs;
    const balanceBox = el("jobs-balance");
    const bonusBtn = el<HTMLButtonElement>("btn-claim-bonus");
    const activeBox = el("jobs-active");
    const listBox = el("jobs-list");
    if (!data) {
      balanceBox.textContent = "Memuat data pekerjaan…";
      return;
    }

    balanceBox.textContent = data.guest
      ? "Kamu masuk sebagai tamu. Daftar akun dulu untuk mengumpulkan Koin Kota (KC) & bekerja. 🪙"
      : `Saldo kamu: 🪙 ${data.balance ?? 0} KC`;

    const bonusVisible = !data.guest && data.bonusAvailable;
    bonusBtn.classList.toggle("hidden", !bonusVisible);
    if (bonusVisible) bonusBtn.textContent = `🎁 Klaim bonus harian +${data.bonusAmount} KC`;

    const active = this.activeShift;
    activeBox.classList.toggle("hidden", !active);
    if (active) {
      el("jobs-active-title").textContent = `Sedang sif: ${active.name} (+${active.pay} KC)`;
      el("jobs-active-progress").textContent = shiftProgressText(active);
    }

    listBox.innerHTML = "";
    for (const job of data.jobs) {
      const row = document.createElement("div");
      row.className = "job-row";
      const info = document.createElement("div");
      info.className = "grow";
      const title = document.createElement("div");
      title.className = "job-title";
      title.textContent = `${job.name} — 🪙 ${job.pay} KC`;
      const desc = document.createElement("div");
      desc.className = "job-desc";
      desc.textContent = job.desc;
      info.append(title, desc);
      row.appendChild(info);

      const btn = document.createElement("button");
      btn.className = "mini-btn";
      if (data.guest) {
        btn.textContent = "Perlu akun";
        btn.disabled = true;
      } else if (active) {
        btn.textContent = active.jobId === job.id ? "Sedang sif" : "Sif lain aktif";
        btn.disabled = true;
      } else if (job.cooldownRemainingMs > 0) {
        btn.textContent = `💤 ${formatCooldown(job.cooldownRemainingMs)}`;
        btn.disabled = true;
      } else {
        btn.textContent = "Mulai sif";
        btn.addEventListener("click", () => this.cb.onStartJob(job.id));
      }
      row.appendChild(btn);
      listBox.appendChild(row);
    }
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
