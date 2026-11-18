import { Room, Client } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { Player } from "../players/Player";
import { resolveCollisions } from "./colliders";
import { accounts, type ProfileData } from "../accounts/store";
import {
  JOBS,
  MAX_ACTIVE_SHIFTS,
  NEEDS_DECAY_PER_SEC,
  NEEDS_WARN_AT,
  REFILL_PRICE,
  SNACK_HUNGER_RESTORE,
  FOUNTAIN_POINT,
  WARKOP_FRONT,
  BAKSO_FRONT,
  SHOP_REFILL_RADIUS,
  WC_PUBLIC_POINT,
  WC_PAID_POINT,
  DELIVER_RADIUS,
  fullNeeds,
  isWorldNight,
  worldTimeFraction,
  type JobDef,
  type NeedsState,
  type RefillAction,
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
import {
  LAPAKS,
  LAPAK_BY_ID,
  LAPAK_PRICE,
  LAPAK_NEAR_RADIUS,
  CATALOG,
  CATALOG_IDS,
  lapakFront,
  stallBox,
  market as marketStore,
} from "../market/market";

/** Keadaan publik satu kavling Kampung Kita (Tahap 6) — cukup untuk menggambar distrik yang sama di semua klien. */
export class PlotState extends Schema {
  @type("string") owner: string = ""; // nama pengguna akun pemilik ("" = kosong)
  @type("number") house: number = 0; // 0 = tanah kosong, 1..3 = tingkat rumah
}

/** Satu barang di menu lapak (Tahap 7) — PUBLIK: harga & stok untuk panel pembeli. */
export class LapakItemState extends Schema {
  @type("number") price: number = 0;
  @type("boolean") stocked: boolean = false;
}

/**
 * Keadaan publik satu lapak Pasar (Tahap 7): pemilik, nama lapak, menu.
 * KAS USAHA & LOG PENJUALAN TIDAK ADA di sini — keduanya privat, hanya
 * dikirim ke pemilik lewat pesan "lapak_mine".
 */
export class LapakState extends Schema {
  @type("string") owner: string = ""; // nama pengguna akun pemilik ("" = kosong)
  @type("string") name: string = ""; // nama lapak ("" = belum diklaim)
  @type({ map: LapakItemState }) menu = new MapSchema<LapakItemState>();
}

export class KotaState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: PlotState }) plots = new MapSchema<PlotState>();
  /** Jumlah rumah yang berdiri di kota (statistik awal untuk Tahap 8). */
  @type("number") housesBuilt: number = 0;
  @type({ map: LapakState }) lapaks = new MapSchema<LapakState>();
  /** Jumlah lapak yang sudah dimiliki warga (statistik awal untuk Tahap 8). */
  @type("number") lapaksActive: number = 0;
  /** Fraksi hari dunia 0..1 dari jam server (Tahap 6B) — semua klien menggambar langit yang sama. */
  @type("number") worldTime: number = 0;
  /** True saat dunia sedang malam menurut jam server. */
  @type("boolean") isNight: boolean = false;
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
 * Keadaan satu sif yang sedang berjalan (Tahap 5 + 6B) — hanya hidup di server.
 * Kemajuan dihitung dari posisi otoritatif pemain; client tidak tahu
 * apa-apa selain ringkasan yang dikirim lewat pesan "job_update".
 * Satu pemain boleh memegang MAKS. 2 sif sekaligus (MAX_ACTIVE_SHIFTS).
 */
interface ShiftState {
  jobId: string;
  /** stay: akumulasi ms di dalam radius pos jaga. */
  progressMs: number;
  /** visit: titik yang sudah dikunjungi (sepanjang def.points). */
  visited: boolean[];
  /** deliver: "pickup" lalu "deliver". */
  phase: "pickup" | "deliver";
  /** deliver: titik ambil yang dipilih server. */
  pickup: { name: string; x: number; z: number } | null;
  /** deliver: titik tujuan yang dipilih server. */
  target: { name: string; x: number; z: number } | null;
  /** deliver: batas waktu antar (ms epoch), diisi saat paket diambil. */
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
// Batas dunia: plaza lama ±42 m, Kampung Kita memanjang ke timur (Tahap 6),
// Pasar memanjang ke selatan (Tahap 7). HARUS sama dengan batas di client (main.ts).
const BOUND_MIN_X = -42;
const BOUND_MAX_X = 136;
const BOUND_MIN_Z = -42;
const BOUND_MAX_Z = 70;
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

/**
 * Sanitasi nama lapak (Tahap 7): buang karakter kontrol, sensor kata kasar
 * (pendekatan yang sama seperti chat), potong 20 karakter. "" = tidak sah.
 */
function cleanLapakName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 20);
  return filterChat(cleaned).trim();
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
  /** sessionId -> (jobId -> sif yang sedang berjalan) (Tahap 5 + 6B: maks. 2 sif bersamaan). */
  private shifts = new Map<string, Map<string, ShiftState>>();
  /** sessionId -> kapan terakhir ringkasan sif dikirim (pembaruan berkala 1 detik). */
  private lastJobSentAt = new Map<string, number>();
  /** sessionId -> meter kebutuhan hidup sesi ini (Tahap 6B). Akun: dimuat & disimpan ke store; tamu: sesi saja. */
  private needsMap = new Map<string, NeedsState>();
  /** sessionId -> kapan terakhir pesan "needs" dikirim. */
  private lastNeedsSentAt = new Map<string, number>();
  /** Kapan terakhir meter kebutuhan akun disimpan massal ke store. */
  private lastNeedsPersistAt = 0;
  /** Kotak tabrakan rumah yang sedang berdiri (Tahap 6) — diturunkan dari data kavling, dibangun ulang tiap ada perubahan. */
  private houseBoxes: Array<readonly [number, number, number, number]> = [];
  /** Kotak tabrakan meja lapak yang sudah dimiliki (Tahap 7) — diturunkan dari data pasar, dibangun ulang tiap ada perubahan. */
  private stallBoxes: Array<readonly [number, number, number, number]> = [];
  /** Gabungan kotak dinamis (rumah + lapak) yang ditegakkan loop simulasi. */
  private dynamicBoxes: Array<readonly [number, number, number, number]> = [];

  onCreate() {
    this.setState(new KotaState());
    this.maxClients = 50;
    // Waktu dunia (Tahap 6B): jam server berlaku sejak room dibuat.
    this.state.worldTime = worldTimeFraction();
    this.state.isNight = isWorldNight();
    // Kampung Kita (Tahap 6): muat kepemilikan kavling persisten ke state publik.
    this.syncPlotsState();
    // Pasar (Tahap 7): muat kepemilikan lapak persisten ke state publik.
    this.syncLapaksState();

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
        client.send("bonus_result", { ok: false, message: "Check-in harian hanya untuk pemain yang masuk dengan akun. Tamu tidak punya saldo." });
        return;
      }
      const result = accounts.claimCheckIn(me);
      client.send("bonus_result", {
        ok: result.ok,
        balance: result.balance,
        reward: result.reward,
        streak: result.streak,
        streakDay: result.streakDay,
        message: result.ok
          ? `Check-in hari ke-${result.streakDay} (streak ${result.streak} hari): +${result.reward} KC 🎁 Saldo sekarang ${result.balance} KC.`
          : result.error,
      });
      if (result.ok) client.send("balance", { balance: result.balance });
    });

    this.onMessage("job_start", (client, data: { jobId?: unknown }) => {
      const reject = (message: string) => client.send("job_result", { ok: false, message });
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) return reject("Masuk dengan akun dulu untuk bekerja — tamu tidak bisa menerima gaji.");
      const def = typeof data?.jobId === "string" ? JOBS[data.jobId] : undefined;
      if (!def) return reject("Pekerjaan tidak dikenal.");
      // Efek kritis kebutuhan (Tahap 6B): meter kosong = tidak bisa mulai sif.
      if (this.needsCritical(client.sessionId)) {
        return reject("Kebutuhanmu kritis (ada meter yang kosong) — makan/minum/ke WC dulu ya, baru bisa mulai sif. Ada jalur gratis kok!");
      }
      // Satpam Malam hanya saat malam server.
      if (def.nightOnly && !isWorldNight()) {
        return reject(`"${def.name}" hanya bisa diambil saat malam server. Tunggu malam tiba ya 🌙`);
      }
      const mine = this.shifts.get(client.sessionId) ?? new Map<string, ShiftState>();
      if (mine.has(def.id)) return reject(`Sif "${def.name}" sedang kamu jalankan.`);
      if (mine.size >= MAX_ACTIVE_SHIFTS) {
        return reject(`Kamu sudah memegang ${MAX_ACTIVE_SHIFTS} sif aktif — itu batasnya. Selesaikan atau batalkan salah satu dulu.`);
      }
      if (def.kind === "deliver") {
        const otherDelivery = [...mine.keys()].find((id) => JOBS[id]?.kind === "deliver");
        if (otherDelivery) {
          return reject(`Dua pekerjaan antar tidak boleh bersamaan — kamu sedang menjalankan "${JOBS[otherDelivery].name}".`);
        }
      }
      const cooldown = accounts.jobCooldownRemaining(me, def.id);
      if (cooldown > 0) {
        return reject(`"${def.name}" baru bisa diambil lagi ${Math.ceil(cooldown / 60000)} menit lagi (istirahat antar-sif). Bisa di-skip berbayar lewat panel pekerjaan.`);
      }
      const pick = <T,>(arr: ReadonlyArray<T>): T | null =>
        arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : null;
      const shift: ShiftState = {
        jobId: def.id,
        progressMs: 0,
        visited: (def.points ?? []).map(() => false),
        phase: "pickup",
        pickup: def.kind === "deliver" ? pick(def.pickups ?? []) : null,
        target: def.kind === "deliver" ? pick(def.targets ?? []) : null,
        deadline: 0,
      };
      mine.set(def.id, shift);
      this.shifts.set(client.sessionId, mine);
      client.send("job_result", { ok: true, message: `Sif dimulai: ${def.name}. Semangat! 💪` });
      this.sendShiftUpdate(client.sessionId, this.shiftStartHint(def, shift));
    });

    this.onMessage("job_cancel", (client, data?: { jobId?: unknown }) => {
      const mine = this.shifts.get(client.sessionId);
      if (!mine || mine.size === 0) return;
      const jobId = typeof data?.jobId === "string" ? data.jobId : null;
      if (jobId) {
        // Batalkan satu sif. Catatan: biaya skip (bila sif ini dimulai lewat
        // skip) TIDAK kembali — sudah hangus sejak dibayar (aturan Tahap 6B).
        if (mine.delete(jobId)) {
          if (mine.size === 0) this.shifts.delete(client.sessionId);
          this.sendShiftUpdate(client.sessionId, `Sif "${JOBS[jobId]?.name ?? jobId}" dibatalkan — tidak ada gaji dan tidak ada cooldown.`);
        }
      } else {
        // Tanpa jobId: batalkan semua sif aktif sesi ini.
        this.shifts.delete(client.sessionId);
        client.send("job_update", { actives: [], message: "Semua sif dibatalkan — tidak ada gaji dan tidak ada cooldown." });
      }
    });

    // --- Skip cooldown berbayar (Tahap 6B) ---
    // Biaya TERBAKAR (keluar dari peredaran) dan attempt terpakai saat
    // dibayar — tidak kembali walau sif sesudahnya dibatalkan/gagal.
    this.onMessage("job_skip", (client, data: { jobId?: unknown }) => {
      const reject = (message: string) => client.send("job_skip_result", { ok: false, message });
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) return reject("Skip cooldown hanya untuk pemain yang masuk dengan akun.");
      const def = typeof data?.jobId === "string" ? JOBS[data.jobId] : undefined;
      if (!def) return reject("Pekerjaan tidak dikenal.");
      if (accounts.jobCooldownRemaining(me, def.id) <= 0) {
        return reject(`"${def.name}" tidak sedang cooldown — tidak perlu skip, tidak ada biaya.`);
      }
      const skip = accounts.skipStatus(me);
      if (skip.left <= 0) {
        return reject("Jatah skip cooldown hari ini sudah habis (3x per hari). Reset besok bareng check-in ya.");
      }
      const eco = accounts.getEconomy(me);
      if (!eco || eco.balance < def.skipFee) {
        return reject(`Saldo tidak cukup untuk skip — perlu ${def.skipFee} KC, saldomu ${eco?.balance ?? 0} KC.`);
      }
      const paid = accounts.spendKC(me, def.skipFee, `Skip cooldown: ${def.name}`);
      if (!paid.ok) return reject(paid.error ?? "Saldo tidak cukup.");
      accounts.consumeSkip(me);
      accounts.clearJobCooldown(me, def.id);
      client.send("job_skip_result", {
        ok: true,
        message: `Cooldown "${def.name}" di-skip! −${def.skipFee} KC (terbakar). Sisa jatah skip hari ini: ${accounts.skipStatus(me).left}x. Ingat: biaya hangus walau sif dibatalkan/gagal.`,
      });
      client.send("balance", { balance: paid.balance });
    });

    // --- Kebutuhan hidup (Tahap 6B): isi ulang meter ---
    // Semua aksi divalidasi server dari POSISI otoritatif pemain + saldo
    // lewat spendKC. Yang gratis tetap butuh berada di tempatnya.
    this.onMessage("needs_get", (client) => {
      this.sendNeeds(client.sessionId, true);
    });

    this.onMessage("need_refill", (client, data: { action?: unknown }) => {
      const reject = (message: string) => client.send("needs_result", { ok: false, message });
      const player = this.state.players.get(client.sessionId);
      const needs = this.needsMap.get(client.sessionId);
      if (!player || !needs) return reject("Data kebutuhanmu tidak ditemukan.");
      const action = typeof data?.action === "string" ? (data.action as RefillAction) : null;
      if (!action) return reject("Aksi tidak dikenal.");
      const me = this.sessionAccount.get(client.sessionId);
      const distTo = (x: number, z: number) => Math.hypot(player.x - x, player.z - z);
      const price = REFILL_PRICE[action] ?? 0;

      // Validasi tempat per aksi.
      switch (action) {
        case "drink_fountain":
          if (distTo(FOUNTAIN_POINT.x, FOUNTAIN_POINT.z) > FOUNTAIN_POINT.radius)
            return reject("Minum gratis hanya di Air Mancur Plaza — mendekat ke air mancur dulu ya.");
          break;
        case "drink_bottle":
          if (distTo(WARKOP_FRONT.x, WARKOP_FRONT.z) > SHOP_REFILL_RADIUS)
            return reject("Air mineral dijual di Warung Kopi — datangi depan warungnya dulu.");
          break;
        case "eat_snack":
        case "eat_meal":
          if (
            distTo(WARKOP_FRONT.x, WARKOP_FRONT.z) > SHOP_REFILL_RADIUS &&
            distTo(BAKSO_FRONT.x, BAKSO_FRONT.z) > SHOP_REFILL_RADIUS
          )
            return reject("Makanan dijual di Warung Kopi & Bakso & Mie — datangi depan tokonya dulu.");
          break;
        case "cook_home":
        case "wc_home": {
          if (!me) return reject("Fitur rumah hanya untuk pemain yang masuk dengan akun.");
          if (!this.atOwnHouse(player, me)) {
            return reject(
              action === "cook_home"
                ? "Masak gratis hanya di rumahmu sendiri — pulang dulu ke kavlingmu (tombol 🏠)."
                : "WC rumah hanya di rumahmu sendiri — pulang dulu ke kavlingmu (tombol 🏠)."
            );
          }
          break;
        }
        case "wc_public":
          if (distTo(WC_PUBLIC_POINT.x, WC_PUBLIC_POINT.z) > WC_PUBLIC_POINT.radius)
            return reject("WC umum gratis ada di Balai Kota — datangi area terasnya dulu.");
          break;
        case "wc_paid":
          if (distTo(WC_PAID_POINT.x, WC_PAID_POINT.z) > WC_PAID_POINT.radius)
            return reject("WC bersih berbayar ada di kios dekat plaza (tenggara papan info).");
          break;
        default:
          return reject("Aksi tidak dikenal.");
      }

      // Aksi berbayar: potong saldo lewat satu-satunya jalur belanja server.
      if (price > 0) {
        if (!me) return reject("Yang berbayar butuh akun — tamu tidak punya saldo. Pakai jalur gratis ya!");
        const paid = accounts.spendKC(me, price, `Kebutuhan: ${action}`);
        if (!paid.ok) return reject(paid.error ?? "Saldo tidak cukup.");
        client.send("balance", { balance: paid.balance });
      }

      // Terapkan efek isi ulang.
      let message = "";
      switch (action) {
        case "drink_fountain":
          needs.thirst = 100;
          message = "Gluk gluk… 💧 Hausmu hilang — gratis dari Air Mancur Plaza!";
          break;
        case "drink_bottle":
          needs.thirst = 100;
          message = `Air mineral diminum 💧 Hausmu hilang (−${price} KC).`;
          break;
        case "eat_snack":
          needs.hunger = Math.min(100, needs.hunger + SNACK_HUNGER_RESTORE);
          message = `Jajanan dimakan 🍢 Laparmu berkurang banyak (−${price} KC).`;
          break;
        case "eat_meal":
          needs.hunger = 100;
          message = `Makan besar habis 🍛 Kamu kenyang penuh! (−${price} KC)`;
          break;
        case "cook_home":
          needs.hunger = 100;
          message = "Masak di rumah sendiri 🍳 Kenyang penuh, gratis!";
          break;
        case "wc_public":
          needs.toilet = 100;
          message = "WC umum Balai Kota 🚻 Lega — gratis!";
          break;
        case "wc_paid":
          needs.toilet = 100;
          message = `WC bersih selesai 🚽 Lega & wangi! (−${price} KC)`;
          break;
        case "wc_home":
          needs.toilet = 100;
          message = "WC rumah sendiri 🚽 Lega — gratis!";
          break;
      }
      if (me) accounts.setNeeds(me, needs);
      this.sendNeeds(client.sessionId, true);
      client.send("needs_result", { ok: true, message });
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

    // --- Usaha Pemain (Tahap 7): klaim lapak, atur menu, jual-beli, kas usaha ---
    // Semua validasi & perpindahan KC terjadi di server dalam satu langkah
    // sinkron: bila satu syarat gagal, TIDAK ada perubahan apa pun.
    // Kas usaha & log penjualan PRIVAT — hanya dikirim ke pemilik lewat
    // pesan "lapak_mine"; state room hanya memuat pemilik, nama & menu.
    this.onMessage("lapak_claim", (client, data: { lapakId?: unknown }) => {
      const reject = (message: string) => client.send("lapak_result", { ok: false, message });
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) return reject("Klaim lapak hanya untuk pemain yang masuk dengan akun. Tamu tidak punya saldo.");
      const def = typeof data?.lapakId === "string" ? LAPAK_BY_ID.get(data.lapakId) : undefined;
      if (!def) return reject("Lapak tidak dikenal.");
      if (marketStore.get(def.id)) return reject(`Lapak No. ${def.number} sudah ada pemiliknya. Cari yang masih kosong ya.`);
      const mine = marketStore.lapakOfAccount(me);
      if (mine) {
        const owned = LAPAK_BY_ID.get(mine);
        return reject(`Kamu sudah punya Lapak No. ${owned?.number}. Satu akun hanya boleh satu lapak.`);
      }
      const paid = accounts.spendKC(me, LAPAK_PRICE, `Klaim Lapak No. ${def.number}`);
      if (!paid.ok) return reject(paid.error ?? "Saldo tidak cukup.");
      const ownerName = accounts.getUser(me)?.username ?? me;
      marketStore.claim(def.id, me, ownerName);
      this.syncLapaksState();
      client.send("lapak_result", {
        ok: true,
        message: `Selamat! Lapak No. ${def.number} di Pasar sekarang milikmu 🎉 (−${LAPAK_PRICE} KC) Atur nama, harga & stoknya ya!`,
      });
      client.send("balance", { balance: paid.balance });
      this.sendLapakMine(client.sessionId);
    });

    this.onMessage("lapak_set_name", (client, data: { name?: unknown }) => {
      const reject = (message: string) => client.send("lapak_result", { ok: false, message });
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) return reject("Atur lapak hanya untuk pemilik yang masuk dengan akun.");
      const myLapakId = marketStore.lapakOfAccount(me);
      if (!myLapakId) return reject("Kamu belum punya lapak. Klaim dulu di Pasar ya.");
      const name = cleanLapakName(data?.name);
      if (!name) return reject("Nama lapak tidak boleh kosong (maks. 20 huruf).");
      marketStore.setName(myLapakId, name);
      this.syncLapaksState();
      client.send("lapak_result", { ok: true, message: `Nama lapakmu sekarang "${name}" 🏪` });
    });

    this.onMessage("lapak_set_item", (client, data: { itemId?: unknown; price?: unknown; stocked?: unknown }) => {
      const reject = (message: string) => client.send("lapak_result", { ok: false, message });
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) return reject("Atur lapak hanya untuk pemilik yang masuk dengan akun.");
      const myLapakId = marketStore.lapakOfAccount(me);
      if (!myLapakId) return reject("Kamu belum punya lapak. Klaim dulu di Pasar ya.");
      const item = typeof data?.itemId === "string" ? CATALOG[data.itemId] : undefined;
      if (!item) return reject("Barang tidak dikenal.");
      const rec = marketStore.get(myLapakId);
      if (!rec) return reject("Data lapakmu tidak ditemukan.");
      const current = rec.menu[item.id] ?? { price: item.defaultPrice, stocked: true };
      const price = typeof data?.price === "number" && Number.isFinite(data.price) ? Math.round(data.price) : current.price;
      if (price < item.minPrice || price > item.maxPrice) {
        return reject(`Harga ${item.name} harus di antara ${item.minPrice}–${item.maxPrice} KC (diatur sistem).`);
      }
      const stocked = typeof data?.stocked === "boolean" ? data.stocked : current.stocked;
      marketStore.setMenuItem(myLapakId, item.id, price, stocked);
      this.syncLapaksState();
      client.send("lapak_result", {
        ok: true,
        message: `${item.name}: harga ${price} KC, ${stocked ? "tersedia ✅" : "stok ditutup 🚫"}`,
      });
    });

    this.onMessage("lapak_buy", (client, data: { lapakId?: unknown; itemId?: unknown }) => {
      const reject = (message: string) => client.send("lapak_result", { ok: false, message });
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) return reject("Belanja di lapak butuh akun — tamu tidak punya saldo. Daftar dulu ya!");
      const def = typeof data?.lapakId === "string" ? LAPAK_BY_ID.get(data.lapakId) : undefined;
      if (!def) return reject("Lapak tidak dikenal.");
      const rec = marketStore.get(def.id);
      if (!rec) return reject(`Lapak No. ${def.number} belum ada pemiliknya — belum bisa belanja di sini.`);
      if (rec.owner === me) return reject("Ini lapakmu sendiri — tidak bisa belanja di lapak sendiri. 😄");
      const item = typeof data?.itemId === "string" ? CATALOG[data.itemId] : undefined;
      if (!item) return reject("Barang tidak dikenal.");
      const entry = rec.menu[item.id];
      if (!entry || !entry.stocked) return reject(`${item.name} sedang tidak tersedia di lapak ini.`);
      const player = this.state.players.get(client.sessionId);
      if (!player) return reject("Data pemainmu tidak ditemukan.");
      const front = lapakFront(def);
      if (Math.hypot(player.x - front.x, player.z - front.z) > LAPAK_NEAR_RADIUS) {
        return reject(`Datangi dulu depan ${rec.name} untuk belanja ya.`);
      }
      const needs = this.needsMap.get(client.sessionId);
      if (!needs) return reject("Data kebutuhanmu tidak ditemukan.");
      const price = entry.price;
      // Semua validasi lolos → terapkan SEKALIGUS (sinkron, tanpa jeda):
      // potong saldo pembeli lewat jalur resmi; bila gagal, berhenti di sini
      // dan tidak ada perubahan lain (kas, meter, log semua batal).
      const paid = accounts.spendKC(me, price, `Beli ${item.name} di ${rec.name}`);
      if (!paid.ok) return reject(paid.error ?? "Saldo tidak cukup.");
      marketStore.recordSale(def.id, accounts.getUser(me)?.username ?? me, item.id, price);
      // Efek kebutuhan pembeli (suvenir batik: koleksi persisten, tanpa efek meter).
      let effectNote = "";
      if (item.need === "thirst") {
        needs.thirst = Math.min(100, needs.thirst + item.restore);
        effectNote = " 💧 Hausmu berkurang banyak!";
      } else if (item.need === "hunger") {
        needs.hunger = Math.min(100, needs.hunger + item.restore);
        effectNote = " 🍗 Laparmu berkurang banyak!";
      } else if (item.id === "batik") {
        const total = accounts.addSouvenir(me);
        effectNote = ` 🎁 Batik masuk koleksimu (total ${total} suvenir).`;
      }
      accounts.setNeeds(me, needs);
      this.sendNeeds(client.sessionId, true);
      client.send("balance", { balance: paid.balance });
      client.send("lapak_result", {
        ok: true,
        message: `${item.name} terbeli dari ${rec.name} — ${price} KC.${effectNote} Saldo sekarang ${paid.balance} KC.`,
      });
      // Kabari pemilik bila sedang online: kas & log barunya (privat).
      const ownerSession = [...this.sessionAccount.entries()].find(([, acc]) => acc === rec.owner)?.[0];
      if (ownerSession) {
        this.sendLapakMine(ownerSession);
        const ownerClient = this.clients.find((c) => c.sessionId === ownerSession);
        ownerClient?.send("lapak_event", {
          message: `🔔 ${accounts.getUser(me)?.username ?? me} membeli ${item.name} (${price} KC) di lapakmu! Kas usaha bertambah.`,
        });
      }
    });

    this.onMessage("lapak_collect", (client) => {
      const reject = (message: string) => client.send("lapak_result", { ok: false, message });
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) return reject("Ambil kas hanya untuk pemilik yang masuk dengan akun.");
      const myLapakId = marketStore.lapakOfAccount(me);
      if (!myLapakId) return reject("Kamu belum punya lapak — tidak ada kas untuk diambil.");
      const def = LAPAK_BY_ID.get(myLapakId);
      const rec = marketStore.get(myLapakId);
      const player = this.state.players.get(client.sessionId);
      if (!def || !rec || !player) return reject("Data lapakmu tidak ditemukan.");
      const front = lapakFront(def);
      if (Math.hypot(player.x - front.x, player.z - front.z) > LAPAK_NEAR_RADIUS) {
        return reject("Ambil kas dilakukan di depan lapakmu sendiri — datangi lapakmu dulu ya.");
      }
      if (rec.kas <= 0) return reject("Kas usahamu masih kosong — belum ada penjualan. Semangat jualannya! 💪");
      const amount = marketStore.collectKas(myLapakId);
      const credited = accounts.creditKC(me, amount, `Ambil kas ${rec.name}`);
      if (!credited.ok) return reject(credited.error ?? "Gagal memindahkan kas.");
      client.send("lapak_result", {
        ok: true,
        message: `Kas usaha diambil: +${amount} KC masuk saldomu 💰 Saldo sekarang ${credited.balance} KC.`,
      });
      client.send("balance", { balance: credited.balance });
      this.sendLapakMine(client.sessionId);
    });

    this.onMessage("lapak_mine_get", (client) => {
      this.sendLapakMine(client.sessionId);
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
    // Kebutuhan hidup (Tahap 6B): akun memuat meter tersimpan; tamu mulai
    // penuh tapi hanya untuk sesi ini (tidak disimpan).
    const savedNeeds = accountKey ? accounts.getNeeds(accountKey) : null;
    this.needsMap.set(client.sessionId, savedNeeds ?? fullNeeds());
    this.lastNeedsSentAt.set(client.sessionId, 0);
  }

  onLeave(client: Client) {
    const accountKey = this.sessionAccount.get(client.sessionId);
    if (accountKey) {
      accounts.touchOnline(accountKey);
      // Simpan meter kebutuhan terakhir akun ini (tamu: dibuang bersama sesi).
      const needs = this.needsMap.get(client.sessionId);
      if (needs) accounts.setNeeds(accountKey, needs);
    }
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
    this.needsMap.delete(client.sessionId);
    this.lastNeedsSentAt.delete(client.sessionId);
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
    this.dynamicBoxes = [...this.houseBoxes, ...this.stallBoxes];
  }

  // ---------- Usaha Pemain (Tahap 7) ----------

  /**
   * Salin kepemilikan + menu lapak persisten ke state PUBLIK + bangun ulang
   * kotak tabrakan meja lapak. Kas & log penjualan TIDAK ikut — privat.
   * Lapak yang belum diklaim tampil dengan menu bawaan & stok tertutup.
   */
  private syncLapaksState() {
    const boxes: Array<readonly [number, number, number, number]> = [];
    for (const def of LAPAKS) {
      const rec = marketStore.get(def.id);
      let entry = this.state.lapaks.get(def.id);
      if (!entry) {
        entry = new LapakState();
        this.state.lapaks.set(def.id, entry);
      }
      entry.owner = rec?.ownerName ?? "";
      entry.name = rec?.name ?? "";
      for (const itemId of CATALOG_IDS) {
        let itemState = entry.menu.get(itemId);
        if (!itemState) {
          itemState = new LapakItemState();
          entry.menu.set(itemId, itemState);
        }
        const menuEntry = rec?.menu[itemId];
        itemState.price = menuEntry?.price ?? CATALOG[itemId].defaultPrice;
        itemState.stocked = rec ? (menuEntry?.stocked ?? true) : false;
      }
      if (rec) boxes.push(stallBox(def));
    }
    this.stallBoxes = boxes;
    this.state.lapaksActive = marketStore.ownedCount();
    this.dynamicBoxes = [...this.houseBoxes, ...this.stallBoxes];
  }

  /**
   * Kirim data PRIVAT lapak ke pemiliknya saja (kas usaha, log penjualan,
   * jumlah suvenir). Tidak pernah disiarkan & tidak ada di state room.
   * Sesi tamu / akun tanpa lapak menerima lapakId "" (tidak punya lapak).
   */
  private sendLapakMine(sessionId: string) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!client) return;
    const me = this.sessionAccount.get(sessionId);
    const myLapakId = me ? marketStore.lapakOfAccount(me) : null;
    const rec = myLapakId ? marketStore.get(myLapakId) : null;
    const eco = me ? accounts.getEconomy(me) : null;
    client.send("lapak_mine", {
      lapakId: myLapakId ?? "",
      kas: rec?.kas ?? 0,
      sales: (rec?.sales ?? []).map((s) => ({ buyer: s.buyer, item: s.item, price: s.price, ts: s.ts })),
      souvenirs: eco?.souvenirs ?? 0,
    });
  }

  // ---------- Ekonomi (Tahap 5 + 6B) ----------

  private shiftStartHint(def: JobDef, shift: ShiftState): string {
    if (def.kind === "stay") {
      return def.id === "satpam" ? "Ke area Balai Kota dan berjagalah di sana selama malam." : "Ke depan Warung Kopi dan berjagalah di sana.";
    }
    if (def.kind === "visit") {
      return def.id === "taman" ? "Kunjungi keenam titik tanaman di sekitar plaza." : "Kunjungi kelima titik bersih-bersih di sekitar plaza.";
    }
    return `Ambil dulu di ${shift.pickup?.name ?? "titik ambil"}.`;
  }

  /** Ringkasan satu sif untuk ditampilkan client (bukan data otoritatif — server tetap yang menilai). */
  private shiftSnapshot(shift: ShiftState) {
    const def = JOBS[shift.jobId];
    return {
      jobId: def.id,
      name: def.name,
      pay: def.pay,
      kind: def.kind,
      progressMs: Math.floor(shift.progressMs),
      needMs: def.stayMs ?? 0,
      visitedCount: shift.visited.filter(Boolean).length,
      totalPoints: def.points?.length ?? 0,
      phase: shift.phase,
      pickupName: shift.pickup?.name ?? "",
      pickupX: shift.pickup?.x ?? 0,
      pickupZ: shift.pickup?.z ?? 0,
      targetName: shift.target?.name ?? "",
      targetX: shift.target?.x ?? 0,
      targetZ: shift.target?.z ?? 0,
      deadline: shift.deadline,
    };
  }

  /** Semua ringkasan sif aktif satu sesi (0..2 sif). */
  private shiftSnapshots(sessionId: string) {
    const mine = this.shifts.get(sessionId);
    if (!mine) return [];
    return [...mine.values()].map((s) => this.shiftSnapshot(s));
  }

  /** Data panel pekerjaan untuk satu sesi: saldo, check-in streak, daftar pekerjaan + cooldown + skip, sif aktif. */
  private jobsPayload(sessionId: string) {
    const me = this.sessionAccount.get(sessionId);
    const eco = me ? accounts.getEconomy(me) : null;
    const checkIn = me ? accounts.checkInStatus(me) : null;
    const skip = me ? accounts.skipStatus(me) : { used: 0, left: 0 };
    return {
      guest: !me,
      balance: eco ? eco.balance : null,
      bonusAvailable: !!checkIn && !checkIn.claimedToday,
      bonusReward: checkIn?.nextReward ?? 0,
      bonusStreakDay: checkIn?.nextDay ?? 1,
      streakCount: checkIn?.currentStreak ?? 0,
      skipAttemptsLeft: skip.left,
      isNight: isWorldNight(),
      jobs: Object.values(JOBS).map((def) => ({
        id: def.id,
        name: def.name,
        pay: def.pay,
        desc: def.desc,
        nightOnly: !!def.nightOnly,
        skipFee: def.skipFee,
        cooldownMs: def.cooldownMs,
        cooldownRemainingMs: me ? accounts.jobCooldownRemaining(me, def.id) : 0,
      })),
      actives: this.shiftSnapshots(sessionId),
    };
  }

  private sendShiftUpdate(sessionId: string, message?: string) {
    this.lastJobSentAt.set(sessionId, Date.now());
    const client = this.clients.find((c) => c.sessionId === sessionId);
    client?.send("job_update", { actives: this.shiftSnapshots(sessionId), message });
  }

  /** Sif selesai: bayar tepat sekali lewat store, lalu kabari pemainnya. */
  private finishShift(sessionId: string, def: JobDef) {
    const mine = this.shifts.get(sessionId);
    if (mine) {
      mine.delete(def.id);
      if (mine.size === 0) this.shifts.delete(sessionId);
    }
    const me = this.sessionAccount.get(sessionId);
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!me || !client) return;
    const balance = accounts.completeJob(me, def.id, def.pay, def.name);
    client.send("job_update", {
      actives: this.shiftSnapshots(sessionId),
      earned: def.pay,
      message: `Sif "${def.name}" selesai! +${def.pay} KC 🎉`,
    });
    client.send("balance", { balance });
  }

  /** Penilaian kemajuan SEMUA sif aktif satu pemain per tick simulasi, dari posisi otoritatifnya. */
  private updateShifts(sessionId: string, player: Player, dt: number, now: number) {
    const mine = this.shifts.get(sessionId);
    if (!mine || mine.size === 0) return;
    // Salin daftar: finishShift mengubah map di tengah iterasi.
    for (const shift of [...mine.values()]) {
      this.updateShift(sessionId, shift, player, dt, now);
    }
    // Ringkasan berkala (±1 detik) agar bilah kemajuan & hitung mundur client tetap segar.
    if (this.shifts.has(sessionId) && now - (this.lastJobSentAt.get(sessionId) ?? 0) >= 1000) {
      this.sendShiftUpdate(sessionId);
    }
  }

  private updateShift(sessionId: string, shift: ShiftState, player: Player, dt: number, now: number) {
    const def = JOBS[shift.jobId];
    const distTo = (x: number, z: number) => Math.hypot(player.x - x, player.z - z);

    if (def.kind === "stay" && def.post && def.stayMs) {
      // Di dalam radius: waktu terakumulasi. Di luar: berhenti (tidak mengulang dari nol).
      // Satpam: sif yang sudah berjalan TIDAK dibatalkan saat siang tiba — dibiarkan selesai.
      if (distTo(def.post.x, def.post.z) <= def.post.radius) {
        shift.progressMs += dt * 1000;
      }
      if (shift.progressMs >= def.stayMs) return this.finishShift(sessionId, def);
    } else if (def.kind === "visit" && def.points) {
      let changed = false;
      def.points.forEach((p, i) => {
        if (!shift.visited[i] && distTo(p.x, p.z) <= (def.pointRadius ?? 2.5)) {
          shift.visited[i] = true;
          changed = true;
        }
      });
      if (shift.visited.every(Boolean)) return this.finishShift(sessionId, def);
      if (changed) {
        this.sendShiftUpdate(
          sessionId,
          def.id === "taman"
            ? `Tanaman disiram ${shift.visited.filter(Boolean).length}/${def.points.length} 🌷`
            : `Titik bersih-bersih ${shift.visited.filter(Boolean).length}/${def.points.length} ✓`
        );
        return;
      }
    } else if (def.kind === "deliver" && shift.pickup && shift.target) {
      if (shift.phase === "pickup") {
        if (distTo(shift.pickup.x, shift.pickup.z) <= (def.pickupRadius ?? 3)) {
          shift.phase = "deliver";
          shift.deadline = now + (def.deliverMs ?? 120000);
          this.sendShiftUpdate(
            sessionId,
            `Diambil dari ${shift.pickup.name}! Antar ke ${shift.target.name} dalam ${(def.deliverMs ?? 120000) / 1000} detik.`
          );
          return;
        }
      } else {
        if (now > shift.deadline) {
          const mine = this.shifts.get(sessionId);
          if (mine) {
            mine.delete(def.id);
            if (mine.size === 0) this.shifts.delete(sessionId);
          }
          const client = this.clients.find((c) => c.sessionId === sessionId);
          client?.send("job_update", {
            actives: this.shiftSnapshots(sessionId),
            message: "Waktu antar habis — sif gagal, tidak ada gaji. Coba lagi kapan-kapan!",
          });
          return;
        }
        if (distTo(shift.target.x, shift.target.z) <= DELIVER_RADIUS) {
          return this.finishShift(sessionId, def);
        }
      }
    }
  }

  // ---------- Kebutuhan hidup (Tahap 6B) ----------

  /** True bila ada meter kebutuhan sesi ini yang kosong (efek kritis berlaku). */
  private needsCritical(sessionId: string): boolean {
    const needs = this.needsMap.get(sessionId);
    if (!needs) return false;
    return needs.hunger <= 0 || needs.thirst <= 0 || needs.toilet <= 0;
  }

  /** Kirim meter kebutuhan ke pemiliknya (privat — bukan data publik). */
  private sendNeeds(sessionId: string, force = false) {
    const needs = this.needsMap.get(sessionId);
    if (!needs) return;
    const now = Date.now();
    if (!force && now - (this.lastNeedsSentAt.get(sessionId) ?? 0) < 2000) return;
    this.lastNeedsSentAt.set(sessionId, now);
    const client = this.clients.find((c) => c.sessionId === sessionId);
    client?.send("needs", {
      hunger: Math.round(needs.hunger),
      thirst: Math.round(needs.thirst),
      toilet: Math.round(needs.toilet),
      warnAt: NEEDS_WARN_AT,
    });
  }

  /** Apakah pemain sedang berada di petak rumahnya sendiri (punya kavling + rumah berdiri)? */
  private atOwnHouse(player: Player, accountKey: string): boolean {
    const myPlotId = plotStore.plotOfAccount(accountKey);
    if (!myPlotId) return false;
    const def = PLOT_BY_ID.get(myPlotId);
    const rec = plotStore.get(myPlotId);
    if (!def || !rec || rec.house <= 0) return false;
    return Math.abs(player.x - def.cx) <= def.w / 2 + 1 && Math.abs(player.z - def.cz) <= def.d / 2 + 1;
  }

  /**
   * Per tick: meter berkurang HANYA selama pemain ada di room (tidak ada
   * pengurangan offline — meter dimuat apa adanya saat masuk lagi).
   * Meter akun disimpan massal ke store tiap ±10 detik; tamu tidak disimpan.
   */
  private updateNeeds(dt: number, now: number) {
    this.state.players.forEach((_player, sessionId) => {
      const needs = this.needsMap.get(sessionId);
      if (!needs) return;
      needs.hunger = Math.max(0, needs.hunger - NEEDS_DECAY_PER_SEC.hunger * dt);
      needs.thirst = Math.max(0, needs.thirst - NEEDS_DECAY_PER_SEC.thirst * dt);
      needs.toilet = Math.max(0, needs.toilet - NEEDS_DECAY_PER_SEC.toilet * dt);
      this.sendNeeds(sessionId);
    });
    if (now - this.lastNeedsPersistAt >= 10000) {
      this.lastNeedsPersistAt = now;
      this.needsMap.forEach((needs, sessionId) => {
        const me = this.sessionAccount.get(sessionId);
        if (me) accounts.setNeeds(me, needs);
      });
    }
  }

  /** Per tick: samakan jam dunia state dengan jam server (semua klien melihat langit yang sama). */
  private updateWorldTime() {
    const frac = worldTimeFraction();
    if (Math.abs(frac - this.state.worldTime) > 0.001) this.state.worldTime = frac;
    const night = frac >= 2 / 3;
    if (night !== this.state.isNight) this.state.isNight = night;
  }

  private simulate(dt: number) {
    const now = Date.now();
    this.state.players.forEach((player, sessionId) => {
      const input = this.inputs.get(sessionId) ?? { x: 0, z: 0, sprint: false, jump: false };
      const moving = Math.abs(input.x) > 0.01 || Math.abs(input.z) > 0.01;
      // Efek kritis kebutuhan (Tahap 6B): meter kosong → lari dimatikan
      // server-side (kecepatan dibatasi jalan), TANPA kematian/denda.
      const sprinting = input.sprint && !this.needsCritical(sessionId);
      const speed = sprinting ? RUN_SPEED : WALK_SPEED;

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

      // Tabrakan bangunan (AABB sederhana) + rumah & meja lapak pemain (Tahap 6 + 7).
      resolveCollisions(player, this.dynamicBoxes);

      // Animasi. Emote yang masih aktif menang, kecuali pemain sedang di udara.
      const emote = this.emoteUntil.get(sessionId);
      const emoteActive = emote && emote.until > now && player.y <= 0.05;
      if (emoteActive && emote.name === "sit" && moving) {
        this.emoteUntil.delete(sessionId); // duduk batal saat bergerak
      }
      if (emoteActive && !(emote.name === "sit" && moving)) player.anim = emote.name;
      else if (player.y > 0.05) player.anim = "jump";
      else if (moving) player.anim = sprinting ? "run" : "walk";
      else player.anim = "idle";

      // Kemajuan pekerjaan (Tahap 5 + 6B) dinilai dari posisi resmi pemain ini.
      this.updateShifts(sessionId, player, dt, now);
    });

    // Kebutuhan hidup berkurang hanya selama bermain + jam dunia server (Tahap 6B).
    this.updateNeeds(dt, now);
    this.updateWorldTime();
  }
}
