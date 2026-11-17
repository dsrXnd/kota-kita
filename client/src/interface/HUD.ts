import type { Profile, FriendInfo } from "../multiplayer/Network";

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

/** Semua elemen layar: overlay mulai + akun, bar atas, chat, teman, tombol sentuh. */
export class HUD {
  private cb: HudCallbacks;
  private toastTimer = 0;
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
