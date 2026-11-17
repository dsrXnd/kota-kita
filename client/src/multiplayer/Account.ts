import { serverEndpoint, type Profile } from "./Network";

/**
 * Klien API akun (Tahap 3) — bicara ke endpoint HTTP server game yang sama.
 * Token sesi disimpan di localStorage perangkat ini.
 * Kata sandi hanya dikirim saat daftar/masuk lewat form, tidak pernah disimpan.
 */

const TOKEN_KEY = "kota-token";
const USER_KEY = "kota-account-user";

export interface AccountInfo {
  username: string;
  profile: Profile;
  lastOnline: number;
}

function httpBase(): string {
  return serverEndpoint().replace(/^ws:/, "http:").replace(/^wss:/, "https:");
}

export function savedToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function savedUsername(): string | null {
  return window.localStorage.getItem(USER_KEY);
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

async function post(path: string, body: unknown, token?: string | null): Promise<any> {
  const res = await fetch(httpBase() + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Server memberi jawaban aneh." }));
  if (!res.ok || !data.ok) throw new Error(data.error ?? `Gagal (${res.status})`);
  return data;
}

export async function registerAccount(username: string, password: string): Promise<AccountInfo> {
  const data = await post("/auth/register", { username, password });
  window.localStorage.setItem(TOKEN_KEY, data.token);
  window.localStorage.setItem(USER_KEY, data.username);
  return { username: data.username, profile: data.profile, lastOnline: Date.now() };
}

export async function loginAccount(username: string, password: string): Promise<AccountInfo> {
  const data = await post("/auth/login", { username, password });
  window.localStorage.setItem(TOKEN_KEY, data.token);
  window.localStorage.setItem(USER_KEY, data.username);
  return { username: data.username, profile: data.profile, lastOnline: data.lastOnline };
}

/** Ambil profil akun dari token tersimpan; null bila sesi sudah tidak sah. */
export async function fetchMe(): Promise<AccountInfo | null> {
  const token = savedToken();
  if (!token) return null;
  try {
    const res = await fetch(httpBase() + "/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      clearSession();
      return null;
    }
    const data = await res.json();
    return { username: data.username, profile: data.profile, lastOnline: data.lastOnline };
  } catch {
    return null; // server tidak terjangkau — jangan hapus sesi, coba lagi nanti
  }
}
