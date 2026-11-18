import express from "express";
import cors from "cors";
import { createServer } from "http";
import { existsSync } from "fs";
import { join } from "path";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { KotaRoom } from "./rooms/KotaRoom";
import { accounts, validUsername, validPassword, DEFAULT_PROFILE, type ProfileData } from "./accounts/store";
import { city } from "./city/city";
import { isSeasonalStyle, seasonalStyleActive, activeSeason } from "./economy/seasons";

// Server KOTA KITA — Node.js + Colyseus + API akun (HTTP).
// Port bisa diganti lewat variabel lingkungan PORT (default 2567).
const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(cors());
app.use(express.json());

// Endpoint cek kesehatan sederhana (dipakai untuk memastikan server hidup).
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "kota-kita-server", time: new Date().toISOString() });
});

// Musim kosmetik aktif (Tahap 9) — publik & baca-saja: layar mulai client
// memakainya untuk menawarkan gaya baju musiman di editor avatar SEBELUM
// pemain masuk room. Server tetap otoritasnya (state room juga memuatnya,
// dan sanitasi profil menolak simpanan musiman di luar jendela).
app.get("/season", (_req, res) => {
  const season = activeSeason();
  res.json({
    ok: true,
    season: season ? { style: season.style, label: `${season.icon} ${season.label}`, styleName: season.styleName } : null,
  });
});

// Mode produksi (Tahap 4): server ini juga menyajikan website game,
// jadi satu alamat melayani semuanya — website, akun (HTTP), dan WebSocket.
// Lokasi folder build client bisa diatur lewat CLIENT_DIST.
const CLIENT_DIST = process.env.CLIENT_DIST || join(__dirname, "..", "..", "client", "dist");
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  console.log(`🌐 Website game disajikan dari ${CLIENT_DIST}`);
} else {
  console.log("ℹ️  Folder build client tidak ditemukan — hanya API & WebSocket yang jalan (mode pengembangan terpisah).");
}

// ---------- API Akun (Tahap 3) ----------
// Rate-limit sederhana khusus endpoint akun: maks 30 percobaan / 5 menit / IP.
const authHits = new Map<string, number[]>();
function authRateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (authHits.get(ip) ?? []).filter((t) => now - t < 5 * 60 * 1000);
  hits.push(now);
  authHits.set(ip, hits);
  return hits.length > 30;
}

function bearerToken(req: express.Request): string | undefined {
  const h = req.header("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

const HAIR_STYLES = ["pendek", "panjang", "hijab", "peci", "botak"];
const SHIRT_STYLES = ["polos", "batik", "merahputih", "koko", "pesta"];
function cleanColor(raw: unknown, fallback: string): string {
  return typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}
function sanitizeProfile(raw: any, base: ProfileData): ProfileData {
  const name =
    typeof raw?.name === "string"
      ? raw.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 16) || base.name
      : base.name;
  // Kosmetik musiman (Tahap 9): gaya musiman hanya boleh DISIMPAN BARU
  // saat jendelanya aktif; di luar jendela, simpanan yang mencobanya
  // jatuh ke "polos". Nilai yang tidak sah/tidak diisi mempertahankan
  // gaya profil lama — jadi gaya musiman yang sudah terpasang tetap
  // terpasang setelah musimnya berakhir.
  let shirtStyle = base.shirtStyle;
  if (typeof raw?.shirtStyle === "string" && SHIRT_STYLES.includes(raw.shirtStyle)) {
    shirtStyle = isSeasonalStyle(raw.shirtStyle) && !seasonalStyleActive(raw.shirtStyle) ? "polos" : raw.shirtStyle;
  }
  return {
    name,
    shirt: cleanColor(raw?.shirt, base.shirt),
    skin: cleanColor(raw?.skin, base.skin),
    pants: cleanColor(raw?.pants, base.pants),
    hair: HAIR_STYLES.includes(raw?.hair) ? raw.hair : base.hair,
    hairColor: cleanColor(raw?.hairColor, base.hairColor),
    shirtStyle,
  };
}

app.post("/auth/register", (req, res) => {
  if (authRateLimited(req.ip ?? "?")) return res.status(429).json({ ok: false, error: "Terlalu banyak percobaan. Tunggu beberapa menit." });
  const { username, password } = req.body ?? {};
  if (!validUsername(username)) return res.status(400).json({ ok: false, error: "Nama pengguna harus 3–16 karakter (huruf, angka, garis bawah)." });
  if (!validPassword(password)) return res.status(400).json({ ok: false, error: "Kata sandi minimal 6 karakter." });
  const result = accounts.register(username, password);
  if (!result.ok) return res.status(409).json(result);
  // Kabar Kota (Tahap 8): warga baru tercatat di umpan pengumuman server.
  city.addNews("👋", `Warga baru bergabung: @${username}. Selamat datang di KOTA KITA!`);
  const login = accounts.login(username, password);
  return res.status(201).json({ ok: true, token: login.token, username, profile: accounts.getUser(username.toLowerCase())?.profile });
});

app.post("/auth/login", (req, res) => {
  if (authRateLimited(req.ip ?? "?")) return res.status(429).json({ ok: false, error: "Terlalu banyak percobaan. Tunggu beberapa menit." });
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ ok: false, error: "Isi nama pengguna dan kata sandi." });
  }
  const result = accounts.login(username, password);
  if (!result.ok) return res.status(401).json(result);
  const user = accounts.getUser(username.toLowerCase());
  return res.json({ ok: true, token: result.token, username: user?.username, profile: user?.profile, lastOnline: user?.lastOnline });
});

app.get("/auth/me", (req, res) => {
  const username = accounts.verifyToken(bearerToken(req));
  if (!username) return res.status(401).json({ ok: false, error: "Sesi tidak sah. Masuk lagi ya." });
  const user = accounts.getUser(username);
  if (!user) return res.status(404).json({ ok: false, error: "Akun tidak ditemukan." });
  return res.json({ ok: true, username: user.username, profile: user.profile, lastOnline: user.lastOnline, friends: user.friends, balance: user.economy.balance, souvenirs: user.economy.souvenirs ?? 0 });
});

app.post("/auth/profile", (req, res) => {
  const username = accounts.verifyToken(bearerToken(req));
  if (!username) return res.status(401).json({ ok: false, error: "Sesi tidak sah. Masuk lagi ya." });
  const user = accounts.getUser(username);
  if (!user) return res.status(404).json({ ok: false, error: "Akun tidak ditemukan." });
  const profile = sanitizeProfile(req.body?.profile, user.profile ?? DEFAULT_PROFILE);
  accounts.saveProfile(username, profile);
  return res.json({ ok: true, profile });
});

const httpServer = createServer(app);

const gameServer = new Server({
  // maxPayload: tolak pesan WebSocket raksasa (proteksi dasar anti-penyalahgunaan).
  transport: new WebSocketTransport({ server: httpServer, maxPayload: 64 * 1024 }),
});

// Satu-satunya room di prototype: plaza utama.
gameServer.define("kota", KotaRoom);

gameServer.listen(PORT).then(() => {
  console.log(`🏙️  KOTA KITA server jalan di port ${PORT} (ws + http://localhost:${PORT}/health)`);
});
