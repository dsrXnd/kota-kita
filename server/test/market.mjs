// Uji Tahap 7: Usaha Pemain (Pasar) end-to-end.
// Uji ini MENGELOLA SERVER SENDIRI (port 2579 + folder data sementara) —
// tanpa backdoor apa pun: dana & meter uji diatur dengan mengedit
// accounts.json di folder data SEMENTARA saat server mati.
//
// Yang dibuktikan:
//  1. Klaim lapak: saldo kurang ditolak, tamu ditolak; klaim berhasil
//     memotong TEPAT 10.000 KC; klaim ganda ditolak dua arah.
//  2. State publik memuat pemilik, nama lapak & menu — tetapi TIDAK memuat
//     kas usaha (kas privat, hanya lewat pesan "lapak_mine" ke pemilik).
//  3. Harga: di dalam rentang sah, di luar rentang ditolak; non-pemilik
//     tidak bisa mengubah menu lapak orang lain; ganti nama bekerja.
//  4. Beli: saldo pembeli turun TEPAT sejumlah harga, kas pemilik naik
//     jumlah yang sama, meter pembeli terisi, penjualan tercatat di log
//     pemilik & ledger pembeli. Saldo kurang → ditolak tanpa perubahan.
//     Beli lapak sendiri ditolak; barang tak tersedia ditolak; tamu ditolak.
//     Batik menambah suvenir persisten tanpa mengubah meter.
//  5. Kas: non-pemilik tidak bisa mengambil; pemilik mengambil → saldo
//     naik tepat sejumlah kas & kas jadi 0; ambil kedua ditolak.
//  6. Collider meja lapak menahan pemain (server).
//  7. Setelah server RESTART: kepemilikan, nama, harga, stok, kas, log
//     penjualan, suvenir & ledger tetap utuh.
import { Client } from "colyseus.js";
import { spawn } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 2579;
const HTTP = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), "kota-market-"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = Date.now().toString(36);
const userA = `beli_${suffix}`; // pembeli
const userB = `jual_${suffix}`; // pemilik lapak
const userC = `misk_${suffix}`; // saldo kecil + bukan pemilik
const PASS = "rahasia123";

// Harus sama dengan denah di server/src/market/market.ts.
// lp_1: baris utara pertama — tengah (-32, 46), menghadap +z (jalan di z 49..55).
// Titik depan (papan): (-32, 48.4). Meja lapak: pusat (-32, 44.75),
// kotak [minX -34.5, maxX -29.5] x [minZ 43.5, maxZ 46].
const LAPAK = "lp_1";
const FRONT = { x: -32, z: 48.2 };
const STALL_BOX = { minX: -34.5, maxX: -29.5, minZ: 43.5, maxZ: 46 };

function fail(msg) {
  console.error("❌ GAGAL:", msg);
  stopServer();
  process.exit(1);
}

let serverProc = null;
function startServer() {
  serverProc = spawn("node", ["dist/index.js"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), KOTA_DATA_DIR: DATA_DIR },
    stdio: "ignore",
  });
}
async function waitServerUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(HTTP + "/health");
      if (r.ok) return;
    } catch { /* belum menyala */ }
    await wait(250);
  }
  fail("Server uji tidak menyala di port " + PORT);
}
function stopServer() {
  if (serverProc) {
    serverProc.kill("SIGKILL");
    serverProc = null;
  }
}
async function restartServer() {
  stopServer();
  await wait(400);
  startServer();
  await waitServerUp();
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

function nextMessage(room, type, timeoutMs = 6000) {
  const p = new Promise((r) => room.onMessage(type, r));
  return Promise.race([p, wait(timeoutMs).then(() => null)]);
}

/** Minta data privat lapak sesi ini dan tunggu jawabannya. */
async function getMine(room) {
  const p = nextMessage(room, "lapak_mine");
  room.send("lapak_mine_get", {});
  const mine = await p;
  if (!mine) fail("Tidak menerima pesan lapak_mine");
  return mine;
}

/** Minta meter kebutuhan sesi ini dan tunggu jawabannya. */
async function getNeeds(room) {
  const p = nextMessage(room, "needs");
  room.send("needs_get", {});
  const needs = await p;
  if (!needs) fail("Tidak menerima pesan needs");
  return needs;
}

/** Gerakkan pemain sendiri ke target murni lewat pesan input (lari), berhenti < 1 m dari target. */
async function driveTo(room, target, timeoutMs = 90000) {
  const start = Date.now();
  for (;;) {
    const me = room.state.players.get(room.sessionId);
    if (!me) fail("Pemain sendiri tidak ada di state");
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.0) break;
    if (Date.now() - start > timeoutMs) {
      room.send("input", { x: 0, z: 0, sprint: false, jump: false });
      fail(`Tidak sampai ke titik (${target.x}, ${target.z}) — jarak tersisa ${d.toFixed(1)} m`);
    }
    room.send("input", { x: dx / d, z: dz / d, sprint: true, jump: false });
    await wait(120);
  }
  room.send("input", { x: 0, z: 0, sprint: false, jump: false });
}

// ---------- Fase 1: daftar akun (saldo awal 500 KC) ----------
startServer();
await waitServerUp();

const regA = await api("/auth/register", { username: userA, password: PASS });
if (regA.status !== 201 || !regA.data.token) fail(`Daftar A gagal: ${regA.status}`);
const regB = await api("/auth/register", { username: userB, password: PASS });
if (regB.status !== 201 || !regB.data.token) fail(`Daftar B gagal: ${regB.status}`);
const regC = await api("/auth/register", { username: userC, password: PASS });
if (regC.status !== 201 || !regC.data.token) fail(`Daftar C gagal: ${regC.status}`);
const tokenA = regA.data.token;
const tokenB = regB.data.token;
const tokenC = regC.data.token;

const clientA = new Client(WS);
let roomA = await clientA.joinOrCreate("kota", { name: "UjiBeliA", token: tokenA });
await wait(300);

// 1a. Klaim dengan saldo 500 KC harus ditolak (harga lapak 10.000 KC).
let resultPromise = nextMessage(roomA, "lapak_result");
roomA.send("lapak_claim", { lapakId: LAPAK });
let result = await resultPromise;
if (!result || result.ok) fail("Klaim lapak dengan saldo kurang harusnya ditolak");
console.log("✅ Klaim lapak dengan saldo 500 KC ditolak server (harga 10.000 KC)");

// 1b. Tamu ditolak klaim.
const guestClient = new Client(WS);
let guestRoom = await guestClient.joinOrCreate("kota", { name: "TamuPasar" });
await wait(300);
resultPromise = nextMessage(guestRoom, "lapak_result");
guestRoom.send("lapak_claim", { lapakId: LAPAK });
result = await resultPromise;
if (!result || result.ok) fail("Tamu harusnya ditolak saat klaim lapak");
await guestRoom.leave();
console.log("✅ Tamu ditolak untuk klaim lapak");
await roomA.leave();

// ---------- Fase 2: danai akun uji lewat data mentah (server mati) ----------
stopServer();
await wait(400);
const dbFile = join(DATA_DIR, "accounts.json");
const db = JSON.parse(readFileSync(dbFile, "utf8"));
db.users[userA.toLowerCase()].economy.balance = 30000;
db.users[userA.toLowerCase()].economy.needs = { hunger: 50, thirst: 30, toilet: 100 };
db.users[userB.toLowerCase()].economy.balance = 30000;
db.users[userC.toLowerCase()].economy.balance = 100;
writeFileSync(dbFile, JSON.stringify(db, null, 1));
startServer();
await waitServerUp();
console.log("✅ Akun uji didanai lewat berkas data sementara (A 30.000, B 30.000, C 100 KC; meter A diatur)");

roomA = await clientA.joinOrCreate("kota", { name: "UjiBeliA", token: tokenA });
const clientB = new Client(WS);
const roomB = await clientB.joinOrCreate("kota", { name: "UjiJualB", token: tokenB });
const clientC = new Client(WS);
const roomC = await clientC.joinOrCreate("kota", { name: "UjiMiskC", token: tokenC });
await wait(500);

// State awal: 10 lapak terdaftar, semuanya kosong, tanpa kas di state.
if (roomA.state.lapaks.size !== 10) fail(`State harusnya memuat 10 lapak, terbaca ${roomA.state.lapaks.size}`);
if (roomA.state.lapaksActive !== 0) fail("lapaksActive awal harusnya 0");
const emptyLapak = roomA.state.lapaks.get(LAPAK);
if (!emptyLapak || emptyLapak.owner !== "") fail("lp_1 awal harusnya kosong");
if (emptyLapak.kas !== undefined) fail("State lapak TIDAK BOLEH memuat kas usaha");
console.log("✅ State awal: 10 lapak kosong, lapaksActive 0, dan state TIDAK memuat kas");

// 2. B klaim lp_1 → saldo 30.000 − 10.000 = 20.000.
resultPromise = nextMessage(roomB, "lapak_result");
roomB.send("lapak_claim", { lapakId: LAPAK });
result = await resultPromise;
if (!result?.ok) fail(`Klaim lapak B gagal: ${JSON.stringify(result)}`);
let meB = await api("/auth/me", null, tokenB);
if (meB.data.balance !== 20000) fail(`Saldo B setelah klaim = ${meB.data.balance}, harusnya 20000`);
await wait(400);
const claimed = roomA.state.lapaks.get(LAPAK);
if (claimed.owner !== userB) fail(`Pemilik lp_1 di mata A = "${claimed.owner}", harusnya "${userB}"`);
if (claimed.name !== `Lapak ${userB}`) fail(`Nama bawaan lp_1 = "${claimed.name}", harusnya "Lapak ${userB}"`);
if (claimed.menu.get("es_teh")?.price !== 10 || claimed.menu.get("es_teh")?.stocked !== true) {
  fail("Menu bawaan es_teh harusnya harga 10 & tersedia");
}
if (roomA.state.lapaksActive !== 1) fail(`lapaksActive = ${roomA.state.lapaksActive}, harusnya 1`);
console.log("✅ B klaim Lapak No. 1 — saldo turun tepat 10.000 KC (30.000 → 20.000); A melihat pemilik, nama bawaan & menu di state");

// 3a. A klaim lapak yang sama → ditolak.
resultPromise = nextMessage(roomA, "lapak_result");
roomA.send("lapak_claim", { lapakId: LAPAK });
result = await resultPromise;
if (!result || result.ok) fail("Klaim lapak yang sudah dimiliki harusnya ditolak");

// 3b. B klaim lapak kedua → ditolak (satu akun satu lapak).
resultPromise = nextMessage(roomB, "lapak_result");
roomB.send("lapak_claim", { lapakId: "lp_2" });
result = await resultPromise;
if (!result || result.ok) fail("Klaim lapak kedua oleh akun yang sama harusnya ditolak");
console.log("✅ Klaim ganda ditolak dua arah (lapak sama oleh A, lapak kedua oleh B)");

// 3c. Kepemilikan lapak TIDAK menghalangi kavling & sebaliknya — dibuktikan
//     cukup di sini lewat data: B tetap bisa punya keduanya (klaim kavling
//     dibuktikan test:plots; di sini pastikan lapakOfAccount terpisah dari
//     plotOfAccount — klaim kavling B tidak ditolak karena punya lapak).
resultPromise = nextMessage(roomB, "plot_result");
roomB.send("plot_claim", { plotId: "k1_3" });
result = await resultPromise;
if (!result?.ok) fail(`Pemilik lapak harusnya tetap boleh klaim kavling: ${JSON.stringify(result)}`);
meB = await api("/auth/me", null, tokenB);
if (meB.data.balance !== 17500) fail(`Saldo B setelah klaim kavling = ${meB.data.balance}, harusnya 17500`);
console.log("✅ B (pemilik lapak) tetap bisa klaim kavling — dua kepemilikan independen");

// 4. Privasi kas: A (bukan pemilik) meminta data lapaknya → tidak dapat apa-apa.
let mine = await getMine(roomA);
if (mine.lapakId !== "") fail(`A tidak punya lapak, lapak_mine harusnya kosong, terbaca "${mine.lapakId}"`);
mine = await getMine(roomB);
if (mine.lapakId !== LAPAK || mine.kas !== 0 || mine.sales.length !== 0) {
  fail(`Data privat B salah: ${JSON.stringify(mine)}`);
}
console.log("✅ Kas privat: A tidak menerima data lapak B; B menerima kas 0 & log kosong");

// 5a. B atur harga es teh 10 → 20 (di dalam rentang 5–25) → sah, terlihat A.
resultPromise = nextMessage(roomB, "lapak_result");
roomB.send("lapak_set_item", { itemId: "es_teh", price: 20, stocked: true });
result = await resultPromise;
if (!result?.ok) fail(`Atur harga es teh 20 harusnya sah: ${JSON.stringify(result)}`);
await wait(400);
if (roomA.state.lapaks.get(LAPAK).menu.get("es_teh")?.price !== 20) fail("Harga es teh di state A harusnya 20");

// 5b. Harga di luar rentang ditolak dua sisi (26 > maks 25; 4 < min 5).
resultPromise = nextMessage(roomB, "lapak_result");
roomB.send("lapak_set_item", { itemId: "es_teh", price: 26, stocked: true });
result = await resultPromise;
if (!result || result.ok) fail("Harga es teh 26 (di atas maks 25) harusnya ditolak");
resultPromise = nextMessage(roomB, "lapak_result");
roomB.send("lapak_set_item", { itemId: "es_teh", price: 4, stocked: true });
result = await resultPromise;
if (!result || result.ok) fail("Harga es teh 4 (di bawah min 5) harusnya ditolak");
await wait(300);
if (roomA.state.lapaks.get(LAPAK).menu.get("es_teh")?.price !== 20) fail("Harga es teh tidak boleh berubah oleh harga yang ditolak");

// 5c. Non-pemilik tidak bisa mengubah menu: A tidak punya lapak → ditolak,
//     dan menu lp_1 tidak berubah.
resultPromise = nextMessage(roomA, "lapak_result");
roomA.send("lapak_set_item", { itemId: "es_teh", price: 5, stocked: true });
result = await resultPromise;
if (!result || result.ok) fail("Non-pemilik harusnya ditolak saat mengatur menu");
await wait(300);
if (roomA.state.lapaks.get(LAPAK).menu.get("es_teh")?.price !== 20) fail("Menu lp_1 berubah oleh non-pemilik!");
console.log("✅ Harga: 20 KC sah & tersinkron; 26 & 4 ditolak; non-pemilik tidak bisa mengubah menu");

// 5d. B ganti nama lapak + tutup stok kopi + naikkan batik ke 250.
resultPromise = nextMessage(roomB, "lapak_result");
roomB.send("lapak_set_name", { name: "Lapak Berkah" });
result = await resultPromise;
if (!result?.ok) fail(`Ganti nama lapak gagal: ${JSON.stringify(result)}`);
resultPromise = nextMessage(roomB, "lapak_result");
roomB.send("lapak_set_item", { itemId: "kopi", price: 15, stocked: false });
result = await resultPromise;
if (!result?.ok) fail(`Tutup stok kopi gagal: ${JSON.stringify(result)}`);
resultPromise = nextMessage(roomB, "lapak_result");
roomB.send("lapak_set_item", { itemId: "batik", price: 250, stocked: true });
result = await resultPromise;
if (!result?.ok) fail(`Atur harga batik 250 (batas maks) harusnya sah: ${JSON.stringify(result)}`);
await wait(400);
const renamed = roomA.state.lapaks.get(LAPAK);
if (renamed.name !== "Lapak Berkah") fail(`Nama lapak di mata A = "${renamed.name}", harusnya "Lapak Berkah"`);
if (renamed.menu.get("kopi")?.stocked !== false) fail("Stok kopi di state A harusnya tertutup");
if (renamed.menu.get("batik")?.price !== 250) fail("Harga batik di state A harusnya 250");
console.log("✅ Nama lapak jadi 'Lapak Berkah', stok kopi tertutup, batik 250 KC — semua terlihat A di state");

// ---------- Fase 3: jual-beli (semua pihak mendatangi depan lp_1) ----------
await driveTo(roomA, { x: -8, z: 40 });
await driveTo(roomA, FRONT);
await driveTo(roomB, { x: -8, z: 40 });
await driveTo(roomB, { x: -30, z: 48.2 });
await driveTo(roomC, { x: -8, z: 40 });
await driveTo(roomC, { x: -34, z: 48.2 });
console.log("✅ A, B & C sampai di depan Lapak No. 1");

// 6a. A beli es teh (20 KC): saldo A −20, kas B +20, haus A terisi +60.
const needsBefore = await getNeeds(roomA);
resultPromise = nextMessage(roomA, "lapak_result");
roomA.send("lapak_buy", { lapakId: LAPAK, itemId: "es_teh" });
result = await resultPromise;
if (!result?.ok) fail(`Beli es teh gagal: ${JSON.stringify(result)}`);
let meA = await api("/auth/me", null, tokenA);
if (meA.data.balance !== 29980) fail(`Saldo A setelah beli es teh = ${meA.data.balance}, harusnya 29980`);
const needsAfter = await getNeeds(roomA);
const thirstGain = needsAfter.thirst - needsBefore.thirst;
if (thirstGain < 45 || needsAfter.thirst > 100) {
  fail(`Haus A harusnya naik ±60 setelah es teh (dari ${needsBefore.thirst} ke ${needsAfter.thirst})`);
}
mine = await getMine(roomB);
if (mine.kas !== 20) fail(`Kas B setelah penjualan pertama = ${mine.kas}, harusnya 20`);
if (mine.sales.length !== 1 || mine.sales[0].item !== "es_teh" || mine.sales[0].price !== 20 || mine.sales[0].buyer !== userA) {
  fail(`Log penjualan B salah: ${JSON.stringify(mine.sales)}`);
}
console.log(`✅ A beli Es Teh 20 KC: saldo A 30.000 → 29.980, kas B = 20, haus A ${needsBefore.thirst} → ${needsAfter.thirst}, log penjualan tercatat`);

// 6b. A beli kopi (stok ditutup) → ditolak, tidak ada perubahan.
resultPromise = nextMessage(roomA, "lapak_result");
roomA.send("lapak_buy", { lapakId: LAPAK, itemId: "kopi" });
result = await resultPromise;
if (!result || result.ok) fail("Beli barang yang stoknya ditutup harusnya ditolak");
meA = await api("/auth/me", null, tokenA);
if (meA.data.balance !== 29980) fail("Saldo A berubah oleh pembelian yang ditolak");
mine = await getMine(roomB);
if (mine.kas !== 20 || mine.sales.length !== 1) fail("Kas/log B berubah oleh pembelian yang ditolak");
console.log("✅ Beli barang tak tersedia ditolak — saldo & kas tidak berubah");

// 6c. B beli di lapak sendiri → ditolak.
resultPromise = nextMessage(roomB, "lapak_result");
roomB.send("lapak_buy", { lapakId: LAPAK, itemId: "es_teh" });
result = await resultPromise;
if (!result || result.ok) fail("Beli di lapak sendiri harusnya ditolak");
console.log("✅ Beli di lapak sendiri ditolak");

// 6d. C (saldo 100) beli batik 250 → saldo kurang, ditolak tanpa perubahan.
resultPromise = nextMessage(roomC, "lapak_result");
roomC.send("lapak_buy", { lapakId: LAPAK, itemId: "batik" });
result = await resultPromise;
if (!result || result.ok) fail("Beli dengan saldo kurang harusnya ditolak");
const meC = await api("/auth/me", null, tokenC);
if (meC.data.balance !== 100) fail(`Saldo C berubah: ${meC.data.balance}, harusnya tetap 100`);
mine = await getMine(roomB);
if (mine.kas !== 20 || mine.sales.length !== 1) fail("Kas/log B berubah oleh pembelian gagal bayar");
console.log("✅ Beli batik 250 KC dengan saldo 100 ditolak — saldo C & kas B utuh (atomik)");

// 6e. A beli batik 250 → suvenir +1, meter TIDAK berubah (selain peluruhan alami).
const needsBeforeBatik = await getNeeds(roomA);
resultPromise = nextMessage(roomA, "lapak_result");
roomA.send("lapak_buy", { lapakId: LAPAK, itemId: "batik" });
result = await resultPromise;
if (!result?.ok) fail(`Beli batik gagal: ${JSON.stringify(result)}`);
meA = await api("/auth/me", null, tokenA);
if (meA.data.balance !== 29730) fail(`Saldo A setelah beli batik = ${meA.data.balance}, harusnya 29730`);
if (meA.data.souvenirs !== 1) fail(`Suvenir A = ${meA.data.souvenirs}, harusnya 1`);
const needsAfterBatik = await getNeeds(roomA);
if (needsAfterBatik.thirst > needsBeforeBatik.thirst + 1 || needsAfterBatik.hunger > needsBeforeBatik.hunger + 1) {
  fail(`Batik tidak boleh mengisi meter (haus ${needsBeforeBatik.thirst} → ${needsAfterBatik.thirst}, lapar ${needsBeforeBatik.hunger} → ${needsAfterBatik.hunger})`);
}
mine = await getMine(roomB);
if (mine.kas !== 270) fail(`Kas B setelah batik = ${mine.kas}, harusnya 270`);
console.log("✅ A beli Batik 250 KC: saldo 29.980 → 29.730, suvenir A = 1, meter tidak berubah, kas B = 270");

// 6f. Tamu tidak bisa belanja.
guestRoom = await guestClient.joinOrCreate("kota", { name: "TamuPasar" });
await wait(500);
await driveTo(guestRoom, { x: -8, z: 40 });
await driveTo(guestRoom, FRONT);
resultPromise = nextMessage(guestRoom, "lapak_result");
guestRoom.send("lapak_buy", { lapakId: LAPAK, itemId: "es_teh" });
result = await resultPromise;
if (!result || result.ok) fail("Tamu harusnya ditolak saat belanja");
await guestRoom.leave();
console.log("✅ Tamu ditolak untuk belanja di lapak");

// ---------- Fase 4: ambil kas usaha ----------
// 7a. C (non-pemilik) mengambil kas → ditolak, kas utuh.
resultPromise = nextMessage(roomC, "lapak_result");
roomC.send("lapak_collect", {});
result = await resultPromise;
if (!result || result.ok) fail("Non-pemilik harusnya ditolak saat mengambil kas");
mine = await getMine(roomB);
if (mine.kas !== 270) fail(`Kas B berubah oleh percobaan ambil non-pemilik: ${mine.kas}`);
console.log("✅ Non-pemilik tidak bisa mengambil kas usaha (kas tetap 270)");

// 7b. B mengambil kas di depan lapaknya: saldo 17.500 + 270 = 17.770, kas → 0.
resultPromise = nextMessage(roomB, "lapak_result");
roomB.send("lapak_collect", {});
result = await resultPromise;
if (!result?.ok) fail(`Ambil kas oleh pemilik gagal: ${JSON.stringify(result)}`);
meB = await api("/auth/me", null, tokenB);
if (meB.data.balance !== 17770) fail(`Saldo B setelah ambil kas = ${meB.data.balance}, harusnya 17770`);
mine = await getMine(roomB);
if (mine.kas !== 0) fail(`Kas B setelah diambil = ${mine.kas}, harusnya 0`);
console.log("✅ Pemilik mengambil kas: saldo B 17.500 → 17.770 (tepat +270), kas jadi 0");

// 7c. Ambil lagi saat kas kosong → ditolak, saldo tidak berubah.
resultPromise = nextMessage(roomB, "lapak_result");
roomB.send("lapak_collect", {});
result = await resultPromise;
if (!result || result.ok) fail("Ambil kas kosong harusnya ditolak");
meB = await api("/auth/me", null, tokenB);
if (meB.data.balance !== 17770) fail("Saldo B berubah oleh ambil kas kosong");
console.log("✅ Ambil kas kedua (kas kosong) ditolak — saldo utuh");

// 7d. Satu penjualan lagi agar kas > 0 saat restart (membuktikan persistensi kas).
resultPromise = nextMessage(roomA, "lapak_result");
roomA.send("lapak_buy", { lapakId: LAPAK, itemId: "es_teh" });
result = await resultPromise;
if (!result?.ok) fail(`Beli es teh kedua gagal: ${JSON.stringify(result)}`);
mine = await getMine(roomB);
if (mine.kas !== 20 || mine.sales.length !== 3) fail(`Kas/log sebelum restart salah: kas ${mine.kas}, log ${mine.sales.length}`);
console.log("✅ Penjualan ketiga tercatat — kas 20, log 3 entri menjelang restart");

// ---------- Fase 5: collider meja lapak ----------
// A berlari lurus ke selatan→utara menembus meja lapak B dari depan jalan —
// harus tertahan di muka meja. Dorongan dibuat tegak lurus (sumbu z murni)
// dari tepat di depan pusat meja: menguji collider-nya, bukan selip sudut.
await driveTo(roomA, FRONT);
const aSelf = roomA.state.players.get(roomA.sessionId);
const driveStart = { x: aSelf.x, z: aSelf.z };
const runTimer = setInterval(
  () => roomA.send("input", { x: 0, z: -1, sprint: true, jump: false }),
  66
);
await wait(4000);
clearInterval(runTimer);
roomA.send("input", { x: 0, z: 0, sprint: false, jump: false });
await wait(400);
const aFinal = { x: aSelf.x, z: aSelf.z };
const travelled = Math.hypot(aFinal.x - driveStart.x, aFinal.z - driveStart.z);
const insideStall =
  aFinal.x > STALL_BOX.minX && aFinal.x < STALL_BOX.maxX && aFinal.z > STALL_BOX.minZ && aFinal.z < STALL_BOX.maxZ;
if (travelled < 1) fail(`A hanya bergerak ${travelled.toFixed(1)} m menuju meja lapak`);
if (insideStall) fail(`A menembus meja lapak! Posisi akhir (${aFinal.x.toFixed(1)}, ${aFinal.z.toFixed(1)})`);
if (aFinal.z <= STALL_BOX.maxZ) fail(`A berhenti terlalu jauh dari meja (${aFinal.z.toFixed(1)}) — collider tidak terasa`);
console.log(`✅ Collider meja lapak bekerja — A tertahan di depan meja (${aFinal.x.toFixed(1)}, ${aFinal.z.toFixed(1)})`);

await roomA.leave();
await roomB.leave();
await roomC.leave();

// ---------- Fase 6: restart server — semua harus persisten ----------
await restartServer();
if (!existsSync(join(DATA_DIR, "market.json"))) fail("Berkas market.json tidak ada di folder data");
const marketDb = JSON.parse(readFileSync(join(DATA_DIR, "market.json"), "utf8"));
const rec = marketDb.lapaks[LAPAK];
if (!rec) fail("Catatan lp_1 tidak ada di market.json");
if (rec.owner !== userB.toLowerCase()) fail(`Pemilik di market.json = "${rec.owner}"`);
if (rec.name !== "Lapak Berkah") fail(`Nama di market.json = "${rec.name}"`);
if (rec.kas !== 20) fail(`Kas di market.json = ${rec.kas}, harusnya 20`);
if (rec.sales.length !== 3) fail(`Log di market.json = ${rec.sales.length} entri, harusnya 3`);
if (rec.menu.es_teh.price !== 20 || rec.menu.kopi.stocked !== false || rec.menu.batik.price !== 250) {
  fail(`Menu di market.json salah: ${JSON.stringify(rec.menu)}`);
}
const accDb = JSON.parse(readFileSync(dbFile, "utf8"));
const ledgerA = accDb.users[userA.toLowerCase()].economy.ledger;
if (!ledgerA.some((e) => e.delta === -20)) fail("Ledger A tidak memuat pembelian es teh −20 KC");
if (!ledgerA.some((e) => e.delta === -250 && /Batik/.test(e.reason))) fail("Ledger A tidak memuat pembelian batik −250 KC");
if (accDb.users[userA.toLowerCase()].economy.souvenirs !== 1) fail("Suvenir A di accounts.json harusnya 1");
console.log("✅ market.json & accounts.json persisten: pemilik, nama, kas 20, log 3, menu, ledger & suvenir tercatat");

const clientA2 = new Client(WS);
const roomA2 = await clientA2.joinOrCreate("kota", { name: "UjiBeliA", token: tokenA });
const clientB2 = new Client(WS);
const roomB2 = await clientB2.joinOrCreate("kota", { name: "UjiJualB", token: tokenB });
await wait(500);
const after = roomA2.state.lapaks.get(LAPAK);
if (!after || after.owner !== userB || after.name !== "Lapak Berkah") {
  fail(`Setelah restart lp_1 = ${JSON.stringify(after && { owner: after.owner, name: after.name })}`);
}
if (after.menu.get("es_teh")?.price !== 20 || after.menu.get("kopi")?.stocked !== false || after.menu.get("batik")?.price !== 250) {
  fail("Menu lp_1 setelah restart tidak utuh");
}
if (after.kas !== undefined) fail("State setelah restart TIDAK BOLEH memuat kas");
const mineAfter = await getMine(roomB2);
if (mineAfter.kas !== 20 || mineAfter.sales.length !== 3) {
  fail(`Data privat B setelah restart salah: kas ${mineAfter.kas}, log ${mineAfter.sales.length}`);
}
const meFinal = await api("/auth/me", null, tokenA);
if (meFinal.data.balance !== 29710) fail(`Saldo A setelah restart = ${meFinal.data.balance}, harusnya 29710`);
if (meFinal.data.souvenirs !== 1) fail(`Suvenir A setelah restart = ${meFinal.data.souvenirs}, harusnya 1`);
await roomA2.leave();
await roomB2.leave();
console.log("✅ Setelah RESTART server: kepemilikan, nama, menu, kas, log, saldo & suvenir tetap utuh; kas tetap privat");

stopServer();
console.log("🎉 SEMUA UJI TAHAP 7 LULUS — klaim lapak 10.000 KC, katalog & rentang harga, jual-beli atomik antar-akun, kas usaha privat, collider, persistensi restart.");
process.exit(0);
