// Uji Tahap 3: akun end-to-end (HTTP API + WebSocket).
// Cara pakai: server harus sudah jalan (npm start), lalu: npm run test:accounts
// Yang dibuktikan:
//  1. Daftar dua akun baru berhasil; login dengan sandi salah ditolak.
//  2. Profil yang diubah lewat API tersimpan persisten (/auth/me).
//  3. Masuk room dengan token: nama pengguna akun tampil di state (publik),
//     dan pilihan tampilan saat join tersimpan ke profil akun.
//  4. Tambah teman lewat room berhasil; status online teman terbaca benar.
//  5. Laporan moderasi diterima server & tertulis di data/reports.jsonl.
import { Client } from "colyseus.js";
import { readFileSync, existsSync } from "fs";

const HTTP = process.env.KOTA_HTTP || "http://localhost:2567";
const WS = process.env.KOTA_SERVER || "ws://localhost:2567";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = Date.now().toString(36);
const userA = `uji_a_${suffix}`;
const userB = `uji_b_${suffix}`;
const PASS = "rahasia123";

function fail(msg) {
  console.error("❌ GAGAL:", msg);
  process.exit(1);
}

async function api(path, body, token) {
  const res = await fetch(HTTP + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// 1. Daftar + login salah ditolak.
const regA = await api("/auth/register", { username: userA, password: PASS });
if (regA.status !== 201 || !regA.data.token) fail(`Daftar A gagal: ${regA.status} ${JSON.stringify(regA.data)}`);
const regB = await api("/auth/register", { username: userB, password: PASS });
if (regB.status !== 201 || !regB.data.token) fail(`Daftar B gagal: ${regB.status}`);
const badLogin = await api("/auth/login", { username: userA, password: "salahbanget" });
if (badLogin.status !== 401) fail(`Login sandi salah harusnya 401, dapat ${badLogin.status}`);
console.log("✅ Daftar 2 akun berhasil; login dengan sandi salah ditolak (401)");

// 2. Profil persisten lewat API.
const tokenA = regA.data.token;
const save = await api("/auth/profile", { profile: { ...regA.data.profile, shirt: "#123456" } }, tokenA);
if (!save.data.ok || save.data.profile.shirt !== "#123456") fail("Simpan profil lewat API gagal");
const me = await api("/auth/me", null, tokenA);
if (me.data.profile.shirt !== "#123456") fail("Profil tidak persisten di /auth/me");
console.log("✅ Profil tersimpan persisten lewat API (shirt #123456 terbaca kembali)");

// 3. Join room dengan token.
const clientA = new Client(WS);
const clientB = new Client(WS);
const roomA = await clientA.joinOrCreate("kota", {
  name: "UjiA",
  shirt: "#654321",
  skin: "#f1c27d",
  pants: "#3b4a6b",
  hair: "hijab",
  hairColor: "#2e8c83",
  shirtStyle: "batik",
  token: tokenA,
});
const roomB = await clientB.joinOrCreate("kota", {
  name: "UjiB",
  shirt: "#2e8c83",
  token: regB.data.token,
});
await wait(700);
const aInB = roomB.state.players.get(roomA.sessionId);
if (!aInB) fail("A tidak terlihat oleh B");
if (aInB.account !== userA) fail(`State account A = "${aInB.account}", harusnya "${userA}"`);
if (aInB.shirt !== "#654321" || aInB.hair !== "hijab" || aInB.shirtStyle !== "batik") {
  fail(`Tampilan A di state tidak sesuai pilihan join: ${aInB.shirt}/${aInB.hair}/${aInB.shirtStyle}`);
}
console.log("✅ Join bertoken: akun tampil di state, tampilan (baju/hijab/batik) sesuai & tersinkron");

// 4. Teman + status online.
const resultPromise = new Promise((r) => roomA.onMessage("friends_result", r));
roomA.send("friend_add", { username: userB });
const result = await Promise.race([resultPromise, wait(3000).then(() => null)]);
if (!result?.ok) fail(`Tambah teman gagal: ${JSON.stringify(result)}`);
const listPromise = new Promise((r) => roomA.onMessage("friends", r));
roomA.send("friends_get", {});
const friends = await Promise.race([listPromise, wait(3000).then(() => null)]);
const friendB = friends?.list?.find((f) => f.username === userB);
if (!friendB) fail("B tidak ada di daftar teman A");
if (friendB.online !== true) fail("Status online B harusnya true (sedang di room yang sama)");
console.log("✅ Tambah teman berhasil; B terbaca ONLINE di daftar teman A");

// 5. Laporan moderasi tertulis di server.
const reportPromise = new Promise((r) => roomB.onMessage("report_result", r));
roomB.send("report", { targetId: roomA.sessionId, reason: "uji otomatis tahap 3" });
const reportAck = await Promise.race([reportPromise, wait(3000).then(() => null)]);
if (!reportAck?.ok) fail("Server tidak mengakui laporan");
await wait(300);
const reportsFile = new URL("../data/reports.jsonl", import.meta.url);
if (!existsSync(reportsFile)) fail("File data/reports.jsonl tidak dibuat server");
const reports = readFileSync(reportsFile, "utf8");
if (!reports.includes("uji otomatis tahap 3") || !reports.includes("UjiA")) {
  fail("Isi reports.jsonl tidak memuat laporan uji");
}
console.log("✅ Laporan moderasi diterima & tertulis di data/reports.jsonl milik server");

// Profil A setelah join: pilihan join harus sudah tersimpan ke akun.
const meAfter = await api("/auth/me", null, tokenA);
if (meAfter.data.profile.shirt !== "#654321" || meAfter.data.profile.hair !== "hijab") {
  fail("Pilihan tampilan saat join tidak tersimpan ke profil akun");
}
console.log("✅ Pilihan tampilan saat join tersimpan permanen ke profil akun");

await roomA.leave();
await roomB.leave();
console.log("🎉 SEMUA UJI TAHAP 3 LULUS — akun, profil, teman, dan moderasi bekerja end-to-end.");
process.exit(0);
