import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import {
  QUEST_BY_ID,
  QUEST_ZONE_BY_ID,
  emptyQuestDay,
  questStatusList,
  type QuestDayData,
  type QuestProgressInfo,
} from "../quests/quests";
import {
  KC_START_BALANCE,
  JOBS,
  JOB_CHANGE_FEE,
  JOB_CHOOSE_COUNT,
  MAX_SKIP_PER_DAY,
  fullNeeds,
  jakartaDayKey,
  streakCycleDay,
  streakReward,
  type NeedsState,
} from "../economy/economy";

/**
 * Penyimpanan akun KOTA KITA (Tahap 3).
 *
 * Kenapa bukan Supabase dulu? Akun Supabase harus dibuat atas nama pemilik
 * proyek dan kuncinya belum ada — kode yang tidak bisa diuji = kode palsu.
 * Jadi Tahap 3 memakai akun di server sendiri (fitur sama: daftar/masuk,
 * profil tersimpan, teman, moderasi). Jalur migrasi ke Supabase didokumenkan
 * di docs/accounts.md lengkap dengan skema SQL-nya.
 *
 * Keamanan:
 * - Password TIDAK disimpan mentah: hash scrypt + salt acak per pengguna.
 * - Token sesi acak 32 byte, kedaluwarsa 30 hari.
 * - Data disimpan di folder data/ (tidak masuk repo, lihat .gitignore).
 */

export interface ProfileData {
  name: string;
  shirt: string;
  skin: string;
  pants: string;
  hair: string;
  hairColor: string;
  shirtStyle: string;
}

/** Statistik satu pekerjaan untuk satu akun (Tahap 10) — dihitung sejak Tahap 10, tanpa riwayat mundur. */
export interface JobStatEntry {
  /** Jumlah sif selesai (dibayar). */
  done: number;
  /** Jumlah sif GAGAL (antar kelewat waktu). Batal tidak dihitung. */
  failed: number;
  /** Total gaji KC dari pekerjaan ini (gaji saja — hadiah quest tidak ikut). */
  earned: number;
}

/** Data ekonomi satu akun (Tahap 5 + 6B) — semua perubahan lewat metode store ini. */
export interface EconomyData {
  /** Saldo Koin Kota (KC). */
  balance: number;
  /** Hari terakhir check-in diklaim, kunci "YYYY-MM-DD" Asia/Jakarta ("" = belum pernah). */
  lastBonusDay: string;
  /** Jumlah hari check-in BERUNTUN sampai klaim terakhir (Tahap 6B). */
  streakCount: number;
  /** Hari jatah skip cooldown berlaku (kunci hari Asia/Jakarta). */
  skipDay: string;
  /** Jumlah attempt skip yang sudah dipakai pada skipDay. */
  skipUsed: number;
  /** jobId -> waktu (ms) sif terakhir SELESAI — dasar cooldown, persisten agar tidak bisa diakali dengan relog. */
  jobLastDone: Record<string, number>;
  /** 2 pekerjaan pilihan akun (Tahap 10) — hanya ini yang boleh diambil; [] = belum memilih. */
  chosenJobs: string[];
  /** Statistik pekerjaan per akun (Tahap 10): jobId -> { done, failed, earned }. */
  jobStats: Record<string, JobStatEntry>;
  /** Meter kebutuhan hidup 0..100 (Tahap 6B) — hanya berkurang saat bermain. */
  needs: NeedsState;
  /** Jumlah suvenir batik yang dibeli dari lapak pemain (Tahap 7) — koleksi persisten. */
  souvenirs: number;
  /** Kemajuan quest sosial harian (Tahap 9) — diatur ulang per hari Asia/Jakarta. */
  quests: QuestDayData;
  /** Catatan mutasi sederhana (maks. 50 entri terakhir). */
  ledger: Array<{ ts: number; delta: number; reason: string; balanceAfter: number }>;
}

export function defaultEconomy(): EconomyData {
  return {
    balance: KC_START_BALANCE,
    lastBonusDay: "",
    streakCount: 0,
    skipDay: "",
    skipUsed: 0,
    jobLastDone: {},
    chosenJobs: [],
    jobStats: {},
    needs: fullNeeds(),
    souvenirs: 0,
    quests: emptyQuestDay(jakartaDayKey(Date.now())),
    ledger: [],
  };
}

interface UserRecord {
  username: string; // bentuk tampilan (huruf besar/kecil seperti saat daftar)
  passHash: string; // "saltHex:hashHex"
  createdAt: number;
  lastOnline: number;
  profile: ProfileData;
  friends: string[]; // username (huruf kecil) akun teman
  economy: EconomyData;
}

interface TokenRecord {
  username: string; // huruf kecil
  expiresAt: number;
}

interface DB {
  users: Record<string, UserRecord>;
  tokens: Record<string, TokenRecord>;
}

export const DEFAULT_PROFILE: ProfileData = {
  name: "Pemain",
  shirt: "#d64545",
  skin: "#f1c27d",
  pants: "#3b4a6b",
  hair: "pendek",
  hairColor: "#3a2a1c",
  shirtStyle: "polos",
};

const DATA_DIR = process.env.KOTA_DATA_DIR || join(process.cwd(), "data");
const DB_FILE = join(DATA_DIR, "accounts.json");
const CHAT_LOG = join(DATA_DIR, "chat.log.jsonl");
const REPORTS_LOG = join(DATA_DIR, "reports.jsonl");
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function validUsername(u: unknown): u is string {
  return typeof u === "string" && /^[a-zA-Z0-9_]{3,16}$/.test(u);
}

export function validPassword(p: unknown): p is string {
  return typeof p === "string" && p.length >= 6 && p.length <= 72;
}

export class AccountStore {
  private db: DB = { users: {}, tokens: {} };

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(DB_FILE)) {
      try {
        this.db = JSON.parse(readFileSync(DB_FILE, "utf8")) as DB;
      } catch {
        this.db = { users: {}, tokens: {} };
      }
    }
    // Migrasi lembut: akun lama (sebelum Tahap 5) mendapat data ekonomi bawaan,
    // akun yang sudah punya data ekonomi dilengkapi kolom yang mungkin kurang.
    for (const user of Object.values(this.db.users)) {
      if (!user.economy) user.economy = defaultEconomy();
      if (typeof user.economy.balance !== "number") user.economy.balance = KC_START_BALANCE;
      user.economy.lastBonusDay ??= "";
      user.economy.streakCount ??= 0;
      user.economy.skipDay ??= "";
      user.economy.skipUsed ??= 0;
      user.economy.jobLastDone ??= {};
      // Tahap 10: pilihan pekerjaan (saring ke id sah, unik, maks. JOB_CHOOSE_COUNT)
      // + statistik pekerjaan (sanitasi entri angka).
      user.economy.chosenJobs = Array.isArray(user.economy.chosenJobs)
        ? [...new Set(user.economy.chosenJobs.filter((id) => typeof id === "string" && id in JOBS))].slice(0, JOB_CHOOSE_COUNT)
        : [];
      if (!user.economy.jobStats || typeof user.economy.jobStats !== "object") user.economy.jobStats = {};
      for (const [jobId, st] of Object.entries(user.economy.jobStats)) {
        if (!(jobId in JOBS) || !st || typeof st !== "object") {
          delete user.economy.jobStats[jobId];
          continue;
        }
        const clean = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
        user.economy.jobStats[jobId] = { done: clean(st.done), failed: clean(st.failed), earned: clean(st.earned) };
      }
      user.economy.needs ??= fullNeeds();
      user.economy.souvenirs ??= 0;
      if (!user.economy.quests || typeof user.economy.quests.day !== "string") {
        user.economy.quests = emptyQuestDay(jakartaDayKey(Date.now()));
      }
      user.economy.quests.zones = Array.isArray(user.economy.quests.zones) ? user.economy.quests.zones.filter((z) => QUEST_ZONE_BY_ID.has(z)) : [];
      user.economy.quests.greeted = Array.isArray(user.economy.quests.greeted) ? user.economy.quests.greeted.filter((v) => typeof v === "string") : [];
      user.economy.quests.jobDone = user.economy.quests.jobDone === true;
      user.economy.quests.paid = Array.isArray(user.economy.quests.paid) ? user.economy.quests.paid.filter((id) => QUEST_BY_ID.has(id)) : [];
      for (const k of ["hunger", "thirst", "toilet"] as const) {
        const v = user.economy.needs[k];
        user.economy.needs[k] = typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100;
      }
      user.economy.ledger ??= [];
    }
  }

  private save() {
    const tmp = DB_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.db, null, 1));
    renameSync(tmp, DB_FILE);
  }

  register(username: string, password: string): { ok: boolean; error?: string } {
    const key = username.toLowerCase();
    if (this.db.users[key]) return { ok: false, error: "Nama pengguna sudah dipakai. Coba nama lain." };
    this.db.users[key] = {
      username,
      passHash: hashPassword(password),
      createdAt: Date.now(),
      lastOnline: Date.now(),
      profile: { ...DEFAULT_PROFILE, name: username },
      friends: [],
      economy: defaultEconomy(),
    };
    this.save();
    return { ok: true };
  }

  login(username: string, password: string): { ok: boolean; error?: string; token?: string } {
    const user = this.db.users[username.toLowerCase()];
    if (!user || !verifyPassword(password, user.passHash)) {
      return { ok: false, error: "Nama pengguna atau kata sandi salah." };
    }
    const token = randomBytes(32).toString("hex");
    this.db.tokens[token] = { username: username.toLowerCase(), expiresAt: Date.now() + TOKEN_TTL_MS };
    user.lastOnline = Date.now();
    this.save();
    return { ok: true, token };
  }

  /** Kembalikan username (huruf kecil) pemilik token, atau null. */
  verifyToken(token: string | undefined): string | null {
    if (!token) return null;
    const rec = this.db.tokens[token];
    if (!rec) return null;
    if (rec.expiresAt < Date.now()) {
      delete this.db.tokens[token];
      this.save();
      return null;
    }
    return rec.username;
  }

  getUser(usernameLower: string): UserRecord | null {
    return this.db.users[usernameLower] ?? null;
  }

  /** Jumlah total akun terdaftar (statistik "penduduk" Tahap 8). */
  userCount(): number {
    return Object.keys(this.db.users).length;
  }

  saveProfile(usernameLower: string, profile: ProfileData) {
    const user = this.db.users[usernameLower];
    if (!user) return;
    user.profile = { ...profile };
    user.lastOnline = Date.now();
    this.save();
  }

  touchOnline(usernameLower: string) {
    const user = this.db.users[usernameLower];
    if (!user) return;
    user.lastOnline = Date.now();
    this.save();
  }

  addFriend(usernameLower: string, friendRaw: string): { ok: boolean; error?: string } {
    const user = this.db.users[usernameLower];
    if (!user) return { ok: false, error: "Akun tidak ditemukan." };
    const friendKey = friendRaw.trim().toLowerCase();
    if (friendKey === usernameLower) return { ok: false, error: "Tidak bisa menambahkan diri sendiri." };
    if (!this.db.users[friendKey]) return { ok: false, error: `Pemain "${friendRaw}" belum punya akun di KOTA KITA.` };
    if (user.friends.includes(friendKey)) return { ok: false, error: "Sudah ada di daftar temanmu." };
    user.friends.push(friendKey);
    this.save();
    return { ok: true };
  }

  // ---------- Ekonomi (Tahap 5): Koin Kota ----------
  // Satu-satunya jalan mengubah saldo. Semua pemanggil adalah kode server
  // (room), tidak pernah client — client hanya menerima hasilnya.

  getEconomy(usernameLower: string): EconomyData | null {
    return this.db.users[usernameLower]?.economy ?? null;
  }

  /** Terapkan satu mutasi saldo + catat ke ledger. Mengembalikan saldo baru. */
  private applyDelta(user: UserRecord, delta: number, reason: string): number {
    user.economy.balance += delta;
    user.economy.ledger.push({ ts: Date.now(), delta, reason, balanceAfter: user.economy.balance });
    if (user.economy.ledger.length > 50) {
      user.economy.ledger = user.economy.ledger.slice(-50);
    }
    return user.economy.balance;
  }

  /**
   * Status check-in streak untuk ditampilkan client: apakah hari ini sudah
   * klaim, dan bila klaim sekarang — streak ke berapa, hari siklus berapa,
   * dan hadiahnya berapa. Kemarin dihitung dari kunci hari Asia/Jakarta
   * (zona tanpa DST, jadi now − 24 jam selalu hari kalender sebelumnya).
   */
  checkInStatus(usernameLower: string): {
    claimedToday: boolean;
    currentStreak: number;
    nextStreak: number;
    nextDay: number;
    nextReward: number;
  } | null {
    const user = this.db.users[usernameLower];
    if (!user) return null;
    const eco = user.economy;
    const now = Date.now();
    const today = jakartaDayKey(now);
    const claimedToday = eco.lastBonusDay === today;
    const yesterday = jakartaDayKey(now - 24 * 60 * 60 * 1000);
    const nextStreak = claimedToday ? eco.streakCount : eco.lastBonusDay === yesterday ? eco.streakCount + 1 : 1;
    return {
      claimedToday,
      currentStreak: eco.streakCount,
      nextStreak,
      nextDay: streakCycleDay(nextStreak),
      nextReward: streakReward(nextStreak),
    };
  }

  /**
   * Check-in harian streak (Tahap 6B — menggantikan bonus rata +100 KC):
   * klaim beruntun menaiki tangga 10/20/30/40/50/60/150 KC; kelewat satu
   * hari kalender Asia/Jakarta → streak kembali ke Hari 1.
   */
  claimCheckIn(usernameLower: string): {
    ok: boolean;
    balance: number;
    reward?: number;
    streak?: number;
    streakDay?: number;
    error?: string;
  } {
    const user = this.db.users[usernameLower];
    if (!user) return { ok: false, balance: 0, error: "Akun tidak ditemukan." };
    const status = this.checkInStatus(usernameLower)!;
    if (status.claimedToday) {
      return { ok: false, balance: user.economy.balance, error: "Check-in hari ini sudah diklaim. Kembali lagi besok ya!" };
    }
    user.economy.streakCount = status.nextStreak;
    user.economy.lastBonusDay = jakartaDayKey(Date.now());
    const balance = this.applyDelta(user, status.nextReward, `Check-in streak hari ke-${status.nextDay}`);
    this.save();
    return { ok: true, balance, reward: status.nextReward, streak: status.nextStreak, streakDay: status.nextDay };
  }

  /** Sisa cooldown satu pekerjaan dalam ms (0 = boleh diambil) — durasi dari definisi pekerjaan. */
  jobCooldownRemaining(usernameLower: string, jobId: string): number {
    const user = this.db.users[usernameLower];
    if (!user) return 0;
    const def = JOBS[jobId];
    if (!def) return 0;
    const last = user.economy.jobLastDone[jobId] ?? 0;
    return Math.max(0, last + def.cooldownMs - Date.now());
  }

  /** Hapus cooldown satu pekerjaan (dipakai jalur skip berbayar setelah biaya dibayar). */
  clearJobCooldown(usernameLower: string, jobId: string) {
    const user = this.db.users[usernameLower];
    if (!user) return;
    if (user.economy.jobLastDone[jobId]) {
      delete user.economy.jobLastDone[jobId];
      this.save();
    }
  }

  /** Jatah skip cooldown hari ini (reset otomatis saat hari kalender berganti). */
  skipStatus(usernameLower: string): { used: number; left: number } {
    const user = this.db.users[usernameLower];
    if (!user) return { used: 0, left: 0 };
    const today = jakartaDayKey(Date.now());
    const used = user.economy.skipDay === today ? user.economy.skipUsed : 0;
    return { used, left: Math.max(0, MAX_SKIP_PER_DAY - used) };
  }

  /** Pakai satu attempt skip (dipanggil room HANYA setelah biaya skip berhasil dibayar). */
  consumeSkip(usernameLower: string): boolean {
    const user = this.db.users[usernameLower];
    if (!user) return false;
    const status = this.skipStatus(usernameLower);
    if (status.left <= 0) return false;
    const today = jakartaDayKey(Date.now());
    if (user.economy.skipDay !== today) {
      user.economy.skipDay = today;
      user.economy.skipUsed = 0;
    }
    user.economy.skipUsed += 1;
    this.save();
    return true;
  }

  /** Meter kebutuhan hidup tersimpan akun (salinan — ubah lewat setNeeds). */
  getNeeds(usernameLower: string): NeedsState | null {
    const user = this.db.users[usernameLower];
    if (!user) return null;
    return { ...user.economy.needs };
  }

  /** Simpan meter kebutuhan hidup akun (dipanggil room berkala & saat pemain keluar). */
  setNeeds(usernameLower: string, needs: NeedsState) {
    const user = this.db.users[usernameLower];
    if (!user) return;
    const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
    user.economy.needs = { hunger: clamp(needs.hunger), thirst: clamp(needs.thirst), toilet: clamp(needs.toilet) };
    this.save();
  }

  /**
   * Selesaikan satu sif: bayar gaji + catat waktu selesai (memulai cooldown).
   * Dipanggil room HANYA setelah kemajuan terverifikasi dari posisi server.
   * Mengembalikan saldo baru.
   */
  completeJob(usernameLower: string, jobId: string, pay: number, jobName: string): number {
    const user = this.db.users[usernameLower];
    if (!user) return 0;
    user.economy.jobLastDone[jobId] = Date.now();
    const balance = this.applyDelta(user, pay, `Gaji: ${jobName}`);
    this.save();
    return balance;
  }

  // ---------- Pilihan & statistik pekerjaan (Tahap 10) ----------

  /**
   * Tetapkan 2 pekerjaan pilihan akun. Aturan (keputusan user):
   * - Tepat JOB_CHOOSE_COUNT id, semuanya sah & berbeda — selain itu ditolak.
   * - Pilihan PERTAMA gratis. Ganti pilihan (himpunan berbeda dari yang
   *   sekarang) membakar JOB_CHANGE_FEE KC lewat applyDelta — TIDAK masuk
   *   Kas Kota, perlakuan sama seperti biaya skip.
   * - Pilihan yang sama persis = ditolak sebagai "tidak ada perubahan",
   *   tanpa biaya. Saldo kurang = ditolak, tidak ada perubahan apa pun.
   * Cooldown TIDAK disentuh di sini: cooldown terikat jobId di jobLastDone
   * dan tetap berjalan walau pilihan diganti (anti-akalan).
   */
  chooseJobs(
    usernameLower: string,
    jobIds: unknown
  ): { ok: boolean; balance: number; charged: number; error?: string } {
    const user = this.db.users[usernameLower];
    if (!user) return { ok: false, balance: 0, charged: 0, error: "Akun tidak ditemukan." };
    const balance = user.economy.balance;
    if (
      !Array.isArray(jobIds) ||
      jobIds.length !== JOB_CHOOSE_COUNT ||
      !jobIds.every((id) => typeof id === "string" && id in JOBS) ||
      new Set(jobIds).size !== jobIds.length
    ) {
      return { ok: false, balance, charged: 0, error: `Pilih tepat ${JOB_CHOOSE_COUNT} pekerjaan yang berbeda dari daftar pekerjaan.` };
    }
    const current = user.economy.chosenJobs ?? [];
    const sameSet = current.length === jobIds.length && jobIds.every((id) => current.includes(id));
    if (sameSet) {
      return { ok: false, balance, charged: 0, error: "Itu memang pilihanmu yang sekarang — tidak ada perubahan, jadi tidak ada biaya." };
    }
    let charged = 0;
    if (current.length > 0) {
      if (balance < JOB_CHANGE_FEE) {
        return {
          ok: false,
          balance,
          charged: 0,
          error: `Saldo tidak cukup untuk ganti pilihan — perlu ${JOB_CHANGE_FEE} KC, saldomu ${balance} KC.`,
        };
      }
      this.applyDelta(user, -JOB_CHANGE_FEE, "Ganti pilihan pekerjaan");
      charged = JOB_CHANGE_FEE;
    }
    user.economy.chosenJobs = [...jobIds];
    this.save();
    return { ok: true, balance: user.economy.balance, charged };
  }

  /** Catat satu sif SELESAI ke statistik akun (Tahap 10): done +1, earned += gaji pekerjaan itu saja. */
  recordJobDone(usernameLower: string, jobId: string, pay: number) {
    const user = this.db.users[usernameLower];
    if (!user || !(jobId in JOBS)) return;
    const st = (user.economy.jobStats[jobId] ??= { done: 0, failed: 0, earned: 0 });
    st.done += 1;
    st.earned += pay;
    this.save();
  }

  /** Catat satu sif GAGAL (antar kelewat waktu) ke statistik akun (Tahap 10). Batal TIDAK dicatat. */
  recordJobFailed(usernameLower: string, jobId: string) {
    const user = this.db.users[usernameLower];
    if (!user || !(jobId in JOBS)) return;
    const st = (user.economy.jobStats[jobId] ??= { done: 0, failed: 0, earned: 0 });
    st.failed += 1;
    this.save();
  }

  /**
   * Belanja KC (Tahap 6: klaim kavling & bangun rumah). Ditolak bila saldo
   * kurang — saldo tidak pernah boleh negatif. Mengembalikan saldo baru.
   */
  spendKC(usernameLower: string, amount: number, reason: string): { ok: boolean; balance: number; error?: string } {
    const user = this.db.users[usernameLower];
    if (!user) return { ok: false, balance: 0, error: "Akun tidak ditemukan." };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, balance: user.economy.balance, error: "Jumlah tidak sah." };
    if (user.economy.balance < amount) {
      return {
        ok: false,
        balance: user.economy.balance,
        error: `Saldo tidak cukup — perlu ${amount} KC, saldomu ${user.economy.balance} KC. Kerja dulu yuk!`,
      };
    }
    const balance = this.applyDelta(user, -amount, reason);
    this.save();
    return { ok: true, balance };
  }

  /**
   * Kredit KC (Tahap 7: pemilik mengambil kas usaha lapaknya). Jalur resmi
   * menambah saldo di luar gaji/check-in — jumlah harus positif & sah.
   * Mengembalikan saldo baru.
   */
  creditKC(usernameLower: string, amount: number, reason: string): { ok: boolean; balance: number; error?: string } {
    const user = this.db.users[usernameLower];
    if (!user) return { ok: false, balance: 0, error: "Akun tidak ditemukan." };
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, balance: user.economy.balance, error: "Jumlah tidak sah." };
    }
    const balance = this.applyDelta(user, amount, reason);
    this.save();
    return { ok: true, balance };
  }

  /** Tambah satu suvenir batik ke koleksi akun (Tahap 7). Mengembalikan jumlah koleksi kini. */
  addSouvenir(usernameLower: string): number {
    const user = this.db.users[usernameLower];
    if (!user) return 0;
    user.economy.souvenirs = (user.economy.souvenirs ?? 0) + 1;
    this.save();
    return user.economy.souvenirs;
  }

  // ---------- Quest Sosial Harian (Tahap 9) ----------
  // Kemajuan hanya berubah lewat metode ini (dipanggil room dari peristiwa
  // server: posisi pemain, emote wave, dan sif selesai). Hadiah dibayar
  // SEKETIKA saat target tercapai lewat applyDelta yang sama seperti gaji,
  // lengkap dengan catatan ledger — dan hanya sekali per quest per hari.

  /** Data quest akun untuk hari ini; berganti hari = data baru yang kosong. */
  private questData(user: UserRecord): QuestDayData {
    const today = jakartaDayKey(Date.now());
    if (!user.economy.quests || user.economy.quests.day !== today) {
      user.economy.quests = emptyQuestDay(today);
    }
    return user.economy.quests;
  }

  /** Status semua quest harian akun (untuk payload panel client). */
  questStatus(usernameLower: string): QuestProgressInfo[] | null {
    const user = this.db.users[usernameLower];
    if (!user) return null;
    const before = user.economy.quests?.day;
    const data = this.questData(user);
    if (before !== data.day) this.save();
    return questStatusList(data);
  }

  /** Selesaikan pembayaran satu quest bila targetnya tercapai & belum dibayar hari ini. */
  private payQuestIfComplete(
    user: UserRecord,
    data: QuestDayData,
    questId: string,
    progress: number
  ): { reward: number; balance: number } {
    const def = QUEST_BY_ID.get(questId);
    if (!def || progress < def.target || data.paid.includes(questId)) {
      return { reward: 0, balance: user.economy.balance };
    }
    data.paid.push(questId);
    const balance = this.applyDelta(user, def.reward, `Quest harian: ${def.name}`);
    return { reward: def.reward, balance };
  }

  /** Catat kunjungan ke satu zona quest Jelajah Kota. */
  recordQuestZone(
    usernameLower: string,
    zoneId: string
  ): { changed: boolean; reward: number; balance: number; quests: QuestProgressInfo[] } | null {
    const user = this.db.users[usernameLower];
    if (!user || !QUEST_ZONE_BY_ID.has(zoneId)) return null;
    const data = this.questData(user);
    let changed = false;
    if (!data.zones.includes(zoneId)) {
      data.zones.push(zoneId);
      changed = true;
    }
    const paid = this.payQuestIfComplete(user, data, "jelajah", Math.min(data.zones.length, QUEST_BY_ID.get("jelajah")!.target));
    if (changed || paid.reward > 0) this.save();
    return { changed: changed || paid.reward > 0, reward: paid.reward, balance: paid.balance, quests: questStatusList(data) };
  }

  /** Catat sapaan wave ke warga berakun lain (yang sama hanya dihitung sekali sehari). */
  recordQuestGreets(
    usernameLower: string,
    targetAccountKeys: ReadonlyArray<string>
  ): { changed: boolean; reward: number; balance: number; quests: QuestProgressInfo[] } | null {
    const user = this.db.users[usernameLower];
    if (!user) return null;
    const data = this.questData(user);
    let changed = false;
    for (const target of targetAccountKeys) {
      if (!target || target === usernameLower || !this.db.users[target]) continue;
      if (!data.greeted.includes(target)) {
        data.greeted.push(target);
        changed = true;
      }
    }
    const paid = this.payQuestIfComplete(user, data, "sapa", Math.min(data.greeted.length, QUEST_BY_ID.get("sapa")!.target));
    if (changed || paid.reward > 0) this.save();
    return { changed: changed || paid.reward > 0, reward: paid.reward, balance: paid.balance, quests: questStatusList(data) };
  }

  /** Catat satu sif pekerjaan yang selesai untuk quest Kerja Keras. */
  recordQuestJob(
    usernameLower: string
  ): { changed: boolean; reward: number; balance: number; quests: QuestProgressInfo[] } | null {
    const user = this.db.users[usernameLower];
    if (!user) return null;
    const data = this.questData(user);
    const changed = !data.jobDone;
    data.jobDone = true;
    const paid = this.payQuestIfComplete(user, data, "kerja", 1);
    if (changed || paid.reward > 0) this.save();
    return { changed: changed || paid.reward > 0, reward: paid.reward, balance: paid.balance, quests: questStatusList(data) };
  }

  appendChatLog(entry: unknown) {
    appendFileSync(CHAT_LOG, JSON.stringify(entry) + "\n");
  }

  appendReport(entry: unknown) {
    appendFileSync(REPORTS_LOG, JSON.stringify(entry) + "\n");
  }
}

/** Singleton yang dipakai server HTTP & room Colyseus. */
export const accounts = new AccountStore();
