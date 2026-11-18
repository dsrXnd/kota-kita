import { Room, Client } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { Player } from "../players/Player";
import { resolveCollisions } from "./colliders";
import { accounts, type ProfileData } from "../accounts/store";
import {
  JOBS,
  KC_DAILY_BONUS,
  JOB_COOLDOWN_MS,
  WARKOP_POST,
  WARKOP_STAY_MS,
  CLEANUP_POINTS,
  CLEANUP_RADIUS,
  BALAI_PICKUP,
  DELIVER_RADIUS,
  DELIVER_TIME_MS,
  DELIVERY_TARGETS,
  jakartaDayKey,
  type JobDef,
} from "../economy/economy";
import {
  PLOTS,
  PLOT_BY_ID,
  PLOT_PRICE,
  HOUSES,
  HOUSE_PRICE,
  houseAllowedOn,
  houseBox,
  homePoint,
  plots as plotStore,
} from "../housing/housing";

/** Keadaan publik satu kavling Kampung Kita (Tahap 6) — cukup untuk menggambar distrik yang sama di semua klien. */
export class PlotState extends Schema {
  @type("string") owner: string = ""; // nama pengguna akun pemilik ("" = kosong)
  @type("number") house: number = 0; // 0 = tanah kosong, 1..3 = tingkat rumah
}

export class KotaState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: PlotState }) plots = new MapSchema<PlotState>();
  /** Jumlah rumah yang berdiri di kota (statistik awal untuk Tahap 8). */
  @type("number") housesBuilt: number = 0;
}

interface InputData {
  x: number; // arah dunia -1..1 (sudah relatif kamera dari klien)
  z: number;
  sprint: boolean;
  jump: boolean;
}

interface JoinOptions {
  name?: string;
  shirt?: string;
  skin?: string;
  pants?: string;
  hair?: string;
  hairColor?: string;
  shirtStyle?: string;
  /** Token sesi akun (Tahap 3) — bila sah, profil akun dimuat & disimpan. */
  token?: string;
}

/**
 * Keadaan satu sif yang sedang berjalan (Tahap 5) — hanya hidup di server.
 * Kemajuan dihitung dari posisi otoritatif pemain; client tidak tahu
 * apa-apa selain ringkasan yang dikirim lewat pesan "job_update".
 */
interface ShiftState {
  jobId: string;
  /** penjaga_warung: akumulasi ms di dalam radius pos jaga. */
  progressMs: number;
  /** kebersihan: titik yang sudah dikunjungi. */
  visited: boolean[];
  /** kurir: "pickup" lalu "deliver". */
  phase: "pickup" | "deliver";
  /** kurir: toko tujuan yang dipilih server. */
  target: { name: string; x: number; z: number } | null;
  /** kurir: batas waktu antar (ms epoch), diisi saat paket diambil. */
  deadline: number;
}

const HAIR_STYLES = ["pendek", "panjang", "hijab", "peci", "botak"];
const SHIRT_STYLES = ["polos", "batik"];

/** Emote yang sah + durasinya (ms). "sit" batal otomatis saat pemain bergerak. */
const EMOTES: Record<string, number> = {
  wave: 2000,
  dance: 4000,
  laugh: 2500,
  clap: 2000,
  sit: 6000,
};

// Konstanta gerak — HARUS sama dengan prediksi gerak di client (main.ts).
export const WALK_SPEED = 4;
export const RUN_SPEED = 7;
export const GRAVITY = 22;
export const JUMP_VELOCITY = 8.2;
// Batas dunia: plaza lama ±42 m, Kampung Kita memanjang ke timur (Tahap 6).
// HARUS sama dengan batas di client (main.ts).
const BOUND_MIN_X = -42;
const BOUND_MAX_X = 136;
const BOUND_MIN_Z = -42;
const BOUND_MAX_Z = 42;
const FOUNTAIN_RADIUS = 3.6; // lingkaran tabrakan air mancur di (0,0)
const CHAT_MAX = 120;
const CHAT_MIN_INTERVAL_MS = 800;

// Daftar kata kasar dasar untuk sensor chat prototype.
// Tahap 3+ memakai moderasi yang lebih lengkap.
const BAD_WORDS = ["anjing", "bangsat", "tolol", "goblok", "bego", "kontol", "memek", "ngentot", "fuck", "shit", "bitch"];

function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "Pemain";
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 16);
  return cleaned.length > 0 ? cleaned : "Pemain";
}

function cleanColor(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  return fallback;
}

function filterChat(text: string): string {
  let out = text;
  for (const w of BAD_WORDS) {
    const re = new RegExp(w, "gi");
    out = out.replace(re, "***");
  }
  return out;
}

export class KotaRoom extends Room<KotaState> {
  private inputs = new Map<string, InputData>();
  private verticalVel = new Map<string, number>();
  private emoteUntil = new Map<string, { name: string; until: number }>();
  private lastEmoteAt = new Map<string, number>();
  private lastChatAt = new Map<string, number>();
  /** sessionId -> username akun (huruf kecil), hanya untuk pemain yang masuk dengan akun. */
  private sessionAccount = new Map<string, string>();
  /** 30 chat terakhir — konteks saat ada laporan moderasi. */
  private recentChats: Array<{ name: string; text: string; ts: number }> = [];
  /** sessionId -> sif yang sedang berjalan (Tahap 5). Maksimal 1 sif per pemain. */
  private shifts = new Map<string, ShiftState>();
  /** sessionId -> kapan terakhir ringkasan sif dikirim (pembaruan berkala 1 detik). */
  private lastJobSentAt = new Map<string, number>();
  /** Kotak tabrakan rumah yang sedang berdiri (Tahap 6) — diturunkan dari data kavling, dibangun ulang tiap ada perubahan. */
  private houseBoxes: Array<readonly [number, number, number, number]> = [];

  onCreate() {
    this.setState(new KotaState());
    this.maxClients = 50;
    // Kampung Kita (Tahap 6): muat kepemilikan kavling persisten ke state publik.
    this.syncPlotsState();

    this.onMessage("input", (client, data: Partial<InputData>) => {
      // Server tidak memercayai klien: hanya arah yang diterima,
      // besarnya dinormalisasi ke maksimum 1.
      let x = Number(data?.x) || 0;
      let z = Number(data?.z) || 0;
      const len = Math.hypot(x, z);
      if (len > 1) {
        x /= len;
        z /= len;
      }
      this.inputs.set(client.sessionId, {
        x,
        z,
        sprint: data?.sprint === true,
        jump: data?.jump === true,
      });
    });

    this.onMessage("chat", (client, data: { text?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const now = Date.now();
      if (now - (this.lastChatAt.get(client.sessionId) ?? 0) < CHAT_MIN_INTERVAL_MS) return;
      if (typeof data?.text !== "string") return;
      const text = filterChat(data.text.trim().slice(0, CHAT_MAX));
      if (!text) return;
      this.lastChatAt.set(client.sessionId, now);
      this.broadcast("chat", { id: client.sessionId, name: player.name, text });
      // Log chat di server (moderasi Tahap 3) + simpan konteks terakhir.
      this.recentChats.push({ name: player.name, text, ts: now });
      if (this.recentChats.length > 30) this.recentChats.shift();
      accounts.appendChatLog({
        ts: now,
        account: this.sessionAccount.get(client.sessionId) ?? null,
        name: player.name,
        text,
      });
    });

    // --- Teman (Tahap 3): data privat per akun, dikirim hanya ke pemiliknya. ---
    this.onMessage("friends_get", (client) => {
      client.send("friends", { list: this.friendListFor(client.sessionId) });
    });

    this.onMessage("friend_add", (client, data: { username?: unknown }) => {
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) {
        client.send("friends_result", { ok: false, message: "Masuk dengan akun dulu untuk menambah teman." });
        return;
      }
      if (typeof data?.username !== "string" || !data.username.trim()) {
        client.send("friends_result", { ok: false, message: "Isi nama pengguna temanmu." });
        return;
      }
      const result = accounts.addFriend(me, data.username);
      client.send("friends_result", {
        ok: result.ok,
        message: result.ok ? `${data.username} ditambahkan ke temanmu 🎉` : result.error,
      });
      if (result.ok) client.send("friends", { list: this.friendListFor(client.sessionId) });
    });

    // --- Moderasi: laporan pemain (disimpan di server, bukan di client). ---
    this.onMessage("report", (client, data: { targetId?: unknown; reason?: unknown }) => {
      const target = typeof data?.targetId === "string" ? this.state.players.get(data.targetId) : undefined;
      if (!target) return;
      const reporter = this.state.players.get(client.sessionId);
      accounts.appendReport({
        ts: Date.now(),
        reporter: reporter?.name ?? "?",
        reporterAccount: this.sessionAccount.get(client.sessionId) ?? null,
        target: target.name,
        targetAccount: typeof data?.targetId === "string" ? this.sessionAccount.get(data.targetId) ?? null : null,
        reason: typeof data?.reason === "string" ? data.reason.slice(0, 200) : "",
        recentChats: this.recentChats.slice(-10),
      });
      client.send("report_result", { ok: true });
    });

    this.onMessage("emote", (client, data: { emote?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      // Jeda minimal antar emote (anti-spam).
      const now = Date.now();
      if (now - (this.lastEmoteAt.get(client.sessionId) ?? 0) < 600) return;
      if (typeof data?.emote === "string" && data.emote in EMOTES) {
        this.lastEmoteAt.set(client.sessionId, now);
        this.emoteUntil.set(client.sessionId, {
          name: data.emote,
          until: now + EMOTES[data.emote],
        });
      }
    });

    // --- Ekonomi (Tahap 5): saldo, bonus harian, pekerjaan ---
    // Semua balasan bersifat privat (client.send) — saldo bukan data publik.
    this.onMessage("balance_get", (client) => {
      const me = this.sessionAccount.get(client.sessionId);
      const eco = me ? accounts.getEconomy(me) : null;
      if (eco) client.send("balance", { balance: eco.balance });
    });

    this.onMessage("jobs_get", (client) => {
      client.send("jobs", this.jobsPayload(client.sessionId));
    });

    this.onMessage("bonus_claim", (client) => {
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) {
        client.send("bonus_result", { ok: false, message: "Bonus harian hanya untuk pemain yang masuk dengan akun. Tamu tidak punya saldo." });
        return;
      }
      const result = accounts.claimDailyBonus(me);
      client.send("bonus_result", {
        ok: result.ok,
        balance: result.balance,
        message: result.ok ? `Bonus harian +${KC_DAILY_BONUS} KC 🎁 Saldo sekarang ${result.balance} KC.` : result.error,
      });
      if (result.ok) client.send("balance", { balance: result.balance });
    });

    this.onMessage("job_start", (client, data: { jobId?: unknown }) => {
      const reject = (message: string) => client.send("job_result", { ok: false, message });
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) return reject("Masuk dengan akun dulu untuk bekerja — tamu tidak bisa menerima gaji.");
      const def = typeof data?.jobId === "string" ? JOBS[data.jobId] : undefined;
      if (!def) return reject("Pekerjaan tidak dikenal.");
      if (this.shifts.has(client.sessionId)) {
        return reject("Kamu sedang dalam sif lain. Selesaikan atau batalkan dulu ya.");
      }
      const cooldown = accounts.jobCooldownRemaining(me, def.id);
      if (cooldown > 0) {
        return reject(`"${def.name}" baru bisa diambil lagi ${Math.ceil(cooldown / 60000)} menit lagi (istirahat antar-sif).`);
      }
      const shift: ShiftState = {
        jobId: def.id,
        progressMs: 0,
        visited: CLEANUP_POINTS.map(() => false),
        phase: "pickup",
        target:
          def.kind === "deliver"
            ? DELIVERY_TARGETS[Math.floor(Math.random() * DELIVERY_TARGETS.length)]
            : null,
        deadline: 0,
      };
      this.shifts.set(client.sessionId, shift);
      client.send("job_result", { ok: true, message: `Sif dimulai: ${def.name}. Semangat! 💪` });
      this.sendShiftUpdate(client.sessionId, this.shiftStartHint(def));
    });

    this.onMessage("job_cancel", (client) => {
      if (this.shifts.delete(client.sessionId)) {
        client.send("job_update", { active: null, message: "Sif dibatalkan — tidak ada gaji dan tidak ada cooldown." });
      }
    });

    // --- Perumahan (Tahap 6): klaim kavling, bangun rumah, teleport pulang ---
    // Semua validasi & pemotongan saldo terjadi di server; client hanya meminta.
    this.onMessage("plot_claim", (client, data: { plotId?: unknown }) => {
      const reject = (message: string) => client.send("plot_result", { ok: false, message });
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) return reject("Klaim kavling hanya untuk pemain yang masuk dengan akun. Tamu tidak punya saldo.");
      const def = typeof data?.plotId === "string" ? PLOT_BY_ID.get(data.plotId) : undefined;
      if (!def) return reject("Kavling tidak dikenal.");
      if (plotStore.get(def.id)) return reject(`Kavling ${def.tier} No. ${def.number} sudah ada pemiliknya. Cari yang masih kosong ya.`);
      const mine = plotStore.plotOfAccount(me);
      if (mine) {
        const owned = PLOT_BY_ID.get(mine);
        return reject(`Kamu sudah punya Kavling ${owned?.tier} No. ${owned?.number}. Satu akun hanya boleh satu kavling.`);
      }
      const price = PLOT_PRICE[def.tier];
      const paid = accounts.spendKC(me, price, `Klaim Kavling ${def.tier} No. ${def.number}`);
      if (!paid.ok) return reject(paid.error ?? "Saldo tidak cukup.");
      const ownerName = accounts.getUser(me)?.username ?? me;
      plotStore.claim(def.id, me, ownerName);
      this.syncPlotsState();
      client.send("plot_result", {
        ok: true,
        message: `Selamat! Kavling ${def.tier} No. ${def.number} sekarang milikmu 🎉 (−${price} KC)`,
      });
      client.send("balance", { balance: paid.balance });
    });

    this.onMessage("plot_build", (client, data: { tier?: unknown }) => {
      const reject = (message: string) => client.send("plot_result", { ok: false, message });
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) return reject("Bangun rumah hanya untuk pemain yang masuk dengan akun.");
      const myPlotId = plotStore.plotOfAccount(me);
      if (!myPlotId) return reject("Kamu belum punya kavling. Klaim kavling dulu di Kampung Kita ya.");
      const def = PLOT_BY_ID.get(myPlotId);
      const rec = plotStore.get(myPlotId);
      if (!def || !rec) return reject("Data kavlingmu tidak ditemukan.");
      const tier = typeof data?.tier === "number" ? data.tier : NaN;
      const house = HOUSES[tier];
      if (!house) return reject("Jenis rumah tidak dikenal.");
      if (tier <= rec.house) {
        return reject(
          rec.house === tier
            ? `${house.name} sudah berdiri di kavlingmu.`
            : "Rumah hanya bisa ditingkatkan ke yang lebih tinggi — tidak bisa turun tingkat."
        );
      }
      if (!houseAllowedOn(def, tier)) {
        return reject(`${house.name} hanya boleh dibangun di Kavling 2 (petak premium). Kavlingmu Kavling ${def.tier}.`);
      }
      const cost = house.price - HOUSE_PRICE[rec.house];
      const paid = accounts.spendKC(me, cost, rec.house > 0 ? `Upgrade ke ${house.name}` : `Bangun ${house.name}`);
      if (!paid.ok) return reject(paid.error ?? "Saldo tidak cukup.");
      plotStore.setHouse(myPlotId, tier);
      this.syncPlotsState();
      client.send("plot_result", {
        ok: true,
        message: `${house.name} berdiri di Kavling ${def.tier} No. ${def.number}! 🏠 (−${cost} KC)`,
      });
      client.send("balance", { balance: paid.balance });
    });

    this.onMessage("home", (client) => {
      const reject = (message: string) => client.send("home_result", { ok: false, message });
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) return reject("Fitur Ke Rumahku hanya untuk pemain yang masuk dengan akun.");
      const myPlotId = plotStore.plotOfAccount(me);
      if (!myPlotId) return reject("Kamu belum punya kavling — belum ada rumah untuk pulang. Klaim dulu di Kampung Kita ya!");
      const def = PLOT_BY_ID.get(myPlotId);
      const rec = plotStore.get(myPlotId);
      const player = this.state.players.get(client.sessionId);
      if (!def || !rec || !player) return reject("Data rumahmu tidak ditemukan.");
      // Teleport otoritatif: posisi resmi pemain dipindah server, sif tidak terpengaruh.
      const point = homePoint(def, rec.house);
      player.x = point.x;
      player.z = point.z;
      player.y = 0;
      this.verticalVel.set(client.sessionId, 0);
      client.send("home_result", {
        ok: true,
        message: `Selamat datang di rumahmu, Kavling ${def.tier} No. ${def.number} 🏠`,
      });
    });

    // Simulasi gerak otoritatif, 20x per detik.
    this.setSimulationInterval((deltaMs) => this.simulate(deltaMs / 1000), 50);
  }

  onJoin(client: Client, options: JoinOptions) {
    const player = new Player();

    // Tahap 3: bila token akun sah, profil tersimpan menjadi dasar,
    // pilihan tampilan terbaru dari layar mulai menimpanya lalu disimpan lagi.
    const accountKey = accounts.verifyToken(options?.token);
    const base: ProfileData | null = accountKey ? accounts.getUser(accountKey)?.profile ?? null : null;

    player.name = cleanName(options?.name ?? base?.name);
    player.shirt = cleanColor(options?.shirt, base?.shirt ?? player.shirt);
    player.skin = cleanColor(options?.skin, base?.skin ?? player.skin);
    player.pants = cleanColor(options?.pants, base?.pants ?? player.pants);
    player.hairColor = cleanColor(options?.hairColor, base?.hairColor ?? player.hairColor);
    const hairPick = options?.hair ?? base?.hair;
    if (typeof hairPick === "string" && HAIR_STYLES.includes(hairPick)) player.hair = hairPick;
    const stylePick = options?.shirtStyle ?? base?.shirtStyle;
    if (typeof stylePick === "string" && SHIRT_STYLES.includes(stylePick)) player.shirtStyle = stylePick;

    if (accountKey) {
      this.sessionAccount.set(client.sessionId, accountKey);
      player.account = accounts.getUser(accountKey)?.username ?? "";
      accounts.saveProfile(accountKey, {
        name: player.name,
        shirt: player.shirt,
        skin: player.skin,
        pants: player.pants,
        hair: player.hair,
        hairColor: player.hairColor,
        shirtStyle: player.shirtStyle,
      });
    }
    // Spawn: sekitar papan info di selatan plaza (0, 14), acak ringan.
    player.x = (Math.random() - 0.5) * 4;
    player.z = 14 + (Math.random() - 0.5) * 2;
    player.rotY = Math.PI; // menghadap plaza (utara)
    this.state.players.set(client.sessionId, player);
    console.log(`[kota] ${player.name} masuk (${client.sessionId}) — total pemain: ${this.state.players.size}`);
    this.inputs.set(client.sessionId, { x: 0, z: 0, sprint: false, jump: false });
    this.verticalVel.set(client.sessionId, 0);
  }

  onLeave(client: Client) {
    const accountKey = this.sessionAccount.get(client.sessionId);
    if (accountKey) accounts.touchOnline(accountKey);
    this.sessionAccount.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.verticalVel.delete(client.sessionId);
    this.emoteUntil.delete(client.sessionId);
    this.lastEmoteAt.delete(client.sessionId);
    this.lastChatAt.delete(client.sessionId);
    // Sif yang ditinggal di tengah jalan hangus (tanpa gaji, tanpa cooldown).
    this.shifts.delete(client.sessionId);
    this.lastJobSentAt.delete(client.sessionId);
  }

  /** Daftar teman untuk satu sesi (kosong untuk tamu), lengkap dengan status online. */
  private friendListFor(sessionId: string) {
    const me = this.sessionAccount.get(sessionId);
    if (!me) return [];
    const user = accounts.getUser(me);
    if (!user) return [];
    const onlineAccounts = new Set(this.sessionAccount.values());
    return user.friends.map((friendKey) => {
      const friend = accounts.getUser(friendKey);
      return {
        username: friend?.username ?? friendKey,
        name: friend?.profile.name ?? friendKey,
        online: onlineAccounts.has(friendKey),
        lastOnline: friend?.lastOnline ?? 0,
      };
    });
  }

  // ---------- Perumahan (Tahap 6) ----------

  /** Salin kepemilikan persisten ke state publik + bangun ulang daftar kotak tabrakan rumah. */
  private syncPlotsState() {
    const boxes: Array<readonly [number, number, number, number]> = [];
    for (const def of PLOTS) {
      const rec = plotStore.get(def.id);
      let entry = this.state.plots.get(def.id);
      if (!entry) {
        entry = new PlotState();
        this.state.plots.set(def.id, entry);
      }
      entry.owner = rec?.ownerName ?? "";
      entry.house = rec?.house ?? 0;
      const box = houseBox(def, entry.house);
      if (box) boxes.push(box);
    }
    this.houseBoxes = boxes;
    this.state.housesBuilt = plotStore.houseCount();
  }

  // ---------- Ekonomi (Tahap 5) ----------

  private shiftStartHint(def: JobDef): string {
    if (def.kind === "stay") return "Ke depan Warung Kopi dan berjagalah di sana.";
    if (def.kind === "visit") return "Kunjungi kelima titik bersih-bersih di sekitar plaza.";
    return "Ambil paketnya di teras Balai Kota dulu.";
  }

  /** Ringkasan sif untuk ditampilkan client (bukan data otoritatif — server tetap yang menilai). */
  private shiftSnapshot(sessionId: string) {
    const shift = this.shifts.get(sessionId);
    if (!shift) return null;
    const def = JOBS[shift.jobId];
    return {
      jobId: def.id,
      name: def.name,
      pay: def.pay,
      kind: def.kind,
      progressMs: Math.floor(shift.progressMs),
      needMs: WARKOP_STAY_MS,
      visitedCount: shift.visited.filter(Boolean).length,
      totalPoints: CLEANUP_POINTS.length,
      phase: shift.phase,
      targetName: shift.target?.name ?? "",
      deadline: shift.deadline,
    };
  }

  /** Data panel pekerjaan untuk satu sesi: saldo, bonus, daftar pekerjaan + cooldown, sif aktif. */
  private jobsPayload(sessionId: string) {
    const me = this.sessionAccount.get(sessionId);
    const eco = me ? accounts.getEconomy(me) : null;
    const now = Date.now();
    return {
      guest: !me,
      balance: eco ? eco.balance : null,
      bonusAvailable: !!eco && eco.lastBonusDay !== jakartaDayKey(now),
      bonusAmount: KC_DAILY_BONUS,
      cooldownMs: JOB_COOLDOWN_MS,
      jobs: Object.values(JOBS).map((def) => ({
        id: def.id,
        name: def.name,
        pay: def.pay,
        desc: def.desc,
        cooldownRemainingMs: me ? accounts.jobCooldownRemaining(me, def.id) : 0,
      })),
      active: this.shiftSnapshot(sessionId),
    };
  }

  private sendShiftUpdate(sessionId: string, message?: string) {
    this.lastJobSentAt.set(sessionId, Date.now());
    const client = this.clients.find((c) => c.sessionId === sessionId);
    client?.send("job_update", { active: this.shiftSnapshot(sessionId), message });
  }

  /** Sif selesai: bayar tepat sekali lewat store, lalu kabari pemainnya. */
  private finishShift(sessionId: string, def: JobDef) {
    this.shifts.delete(sessionId);
    const me = this.sessionAccount.get(sessionId);
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!me || !client) return;
    const balance = accounts.completeJob(me, def.id, def.pay, def.name);
    client.send("job_update", {
      active: null,
      earned: def.pay,
      message: `Sif "${def.name}" selesai! +${def.pay} KC 🎉`,
    });
    client.send("balance", { balance });
  }

  /** Penilaian kemajuan sif per tick simulasi, dari posisi otoritatif pemain. */
  private updateShift(sessionId: string, player: Player, dt: number, now: number) {
    const shift = this.shifts.get(sessionId);
    if (!shift) return;
    const def = JOBS[shift.jobId];
    const distTo = (x: number, z: number) => Math.hypot(player.x - x, player.z - z);

    if (def.kind === "stay") {
      // Di dalam radius: waktu terakumulasi. Di luar: berhenti (tidak mengulang dari nol).
      if (distTo(WARKOP_POST.x, WARKOP_POST.z) <= WARKOP_POST.radius) {
        shift.progressMs += dt * 1000;
      }
      if (shift.progressMs >= WARKOP_STAY_MS) return this.finishShift(sessionId, def);
    } else if (def.kind === "visit") {
      let changed = false;
      CLEANUP_POINTS.forEach((p, i) => {
        if (!shift.visited[i] && distTo(p.x, p.z) <= CLEANUP_RADIUS) {
          shift.visited[i] = true;
          changed = true;
        }
      });
      if (shift.visited.every(Boolean)) return this.finishShift(sessionId, def);
      if (changed) {
        this.sendShiftUpdate(sessionId, `Titik bersih-bersih ${shift.visited.filter(Boolean).length}/${CLEANUP_POINTS.length} ✓`);
        return;
      }
    } else if (def.kind === "deliver" && shift.target) {
      if (shift.phase === "pickup") {
        if (distTo(BALAI_PICKUP.x, BALAI_PICKUP.z) <= BALAI_PICKUP.radius) {
          shift.phase = "deliver";
          shift.deadline = now + DELIVER_TIME_MS;
          this.sendShiftUpdate(sessionId, `Paket diambil! Antar ke ${shift.target.name} dalam ${DELIVER_TIME_MS / 1000} detik.`);
          return;
        }
      } else {
        if (now > shift.deadline) {
          this.shifts.delete(sessionId);
          const client = this.clients.find((c) => c.sessionId === sessionId);
          client?.send("job_update", { active: null, message: "Waktu antar habis — sif gagal, tidak ada gaji. Coba lagi kapan-kapan!" });
          return;
        }
        if (distTo(shift.target.x, shift.target.z) <= DELIVER_RADIUS) {
          return this.finishShift(sessionId, def);
        }
      }
    }

    // Ringkasan berkala (±1 detik) agar bilah kemajuan & hitung mundur client tetap segar.
    if (now - (this.lastJobSentAt.get(sessionId) ?? 0) >= 1000) {
      this.sendShiftUpdate(sessionId);
    }
  }

  private simulate(dt: number) {
    const now = Date.now();
    this.state.players.forEach((player, sessionId) => {
      const input = this.inputs.get(sessionId) ?? { x: 0, z: 0, sprint: false, jump: false };
      const moving = Math.abs(input.x) > 0.01 || Math.abs(input.z) > 0.01;
      const speed = input.sprint ? RUN_SPEED : WALK_SPEED;

      if (moving) {
        player.x += input.x * speed * dt;
        player.z += input.z * speed * dt;
        player.rotY = Math.atan2(input.x, input.z);
      }

      // Lompat & gravitasi sederhana.
      let vy = this.verticalVel.get(sessionId) ?? 0;
      if (input.jump && player.y <= 0) {
        vy = JUMP_VELOCITY;
        input.jump = false; // konsumsi agar tidak lompat terus
      }
      if (player.y > 0 || vy !== 0) {
        player.y += vy * dt;
        vy -= GRAVITY * dt;
        if (player.y <= 0) {
          player.y = 0;
          vy = 0;
        }
      }
      this.verticalVel.set(sessionId, vy);

      // Batas dunia.
      player.x = Math.max(BOUND_MIN_X, Math.min(BOUND_MAX_X, player.x));
      player.z = Math.max(BOUND_MIN_Z, Math.min(BOUND_MAX_Z, player.z));

      // Tabrakan air mancur: dorong keluar lingkaran.
      const distFountain = Math.hypot(player.x, player.z);
      if (distFountain < FOUNTAIN_RADIUS && distFountain > 0.0001) {
        const push = FOUNTAIN_RADIUS / distFountain;
        player.x *= push;
        player.z *= push;
      }

      // Tabrakan bangunan (AABB sederhana) + rumah pemain yang berdiri (Tahap 6).
      resolveCollisions(player, this.houseBoxes);

      // Animasi. Emote yang masih aktif menang, kecuali pemain sedang di udara.
      const emote = this.emoteUntil.get(sessionId);
      const emoteActive = emote && emote.until > now && player.y <= 0.05;
      if (emoteActive && emote.name === "sit" && moving) {
        this.emoteUntil.delete(sessionId); // duduk batal saat bergerak
      }
      if (emoteActive && !(emote.name === "sit" && moving)) player.anim = emote.name;
      else if (player.y > 0.05) player.anim = "jump";
      else if (moving) player.anim = input.sprint ? "run" : "walk";
      else player.anim = "idle";

      // Kemajuan pekerjaan (Tahap 5) dinilai dari posisi resmi pemain ini.
      this.updateShift(sessionId, player, dt, now);
    });
  }
}
