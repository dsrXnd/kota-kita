import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

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

interface UserRecord {
  username: string; // bentuk tampilan (huruf besar/kecil seperti saat daftar)
  passHash: string; // "saltHex:hashHex"
  createdAt: number;
  lastOnline: number;
  profile: ProfileData;
  friends: string[]; // username (huruf kecil) akun teman
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

  appendChatLog(entry: unknown) {
    appendFileSync(CHAT_LOG, JSON.stringify(entry) + "\n");
  }

  appendReport(entry: unknown) {
    appendFileSync(REPORTS_LOG, JSON.stringify(entry) + "\n");
  }
}

/** Singleton yang dipakai server HTTP & room Colyseus. */
export const accounts = new AccountStore();
