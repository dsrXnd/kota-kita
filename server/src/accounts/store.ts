import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { KC_START_BALANCE, KC_DAILY_BONUS, JOB_COOLDOWN_MS, jakartaDayKey } from "../economy/economy";

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

/** Data ekonomi satu akun (Tahap 5) — semua perubahan lewat metode store ini. */
export interface EconomyData {
  /** Saldo Koin Kota (KC). */
  balance: number;
  /** Hari terakhir bonus harian diklaim, kunci "YYYY-MM-DD" Asia/Jakarta ("" = belum pernah). */
  lastBonusDay: string;
  /** jobId -> waktu (ms) sif terakhir SELESAI — dasar cooldown, persisten agar tidak bisa diakali dengan relog. */
  jobLastDone: Record<string, number>;
  /** Catatan mutasi sederhana (maks. 50 entri terakhir). */
  ledger: Array<{ ts: number; delta: number; reason: string; balanceAfter: number }>;
}

export function defaultEconomy(): EconomyData {
  return { balance: KC_START_BALANCE, lastBonusDay: "", jobLastDone: {}, ledger: [] };
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
      user.economy.jobLastDone ??= {};
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

  /** Bonus masuk harian: sekali per hari kalender Asia/Jakarta. */
  claimDailyBonus(usernameLower: string): { ok: boolean; balance: number; error?: string } {
    const user = this.db.users[usernameLower];
    if (!user) return { ok: false, balance: 0, error: "Akun tidak ditemukan." };
    const today = jakartaDayKey(Date.now());
    if (user.economy.lastBonusDay === today) {
      return { ok: false, balance: user.economy.balance, error: "Bonus hari ini sudah diklaim. Kembali lagi besok ya!" };
    }
    user.economy.lastBonusDay = today;
    const balance = this.applyDelta(user, KC_DAILY_BONUS, "Bonus masuk harian");
    this.save();
    return { ok: true, balance };
  }

  /** Sisa cooldown satu pekerjaan dalam ms (0 = boleh diambil). */
  jobCooldownRemaining(usernameLower: string, jobId: string): number {
    const user = this.db.users[usernameLower];
    if (!user) return 0;
    const last = user.economy.jobLastDone[jobId] ?? 0;
    return Math.max(0, last + JOB_COOLDOWN_MS - Date.now());
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

  appendChatLog(entry: unknown) {
    appendFileSync(CHAT_LOG, JSON.stringify(entry) + "\n");
  }

  appendReport(entry: unknown) {
    appendFileSync(REPORTS_LOG, JSON.stringify(entry) + "\n");
  }
}

/** Singleton yang dipakai server HTTP & room Colyseus. */
export const accounts = new AccountStore();
