// Uji Tahap 8: Kota Hidup (Statistik, Kabar Kota & Voting Fasilitas)
// end-to-end. Uji ini MENGELOLA SERVER SENDIRI (port 2580 + folder data
// sementara + konfigurasi jendela voting KOTA_VOTE_MINUTES=1 menit) —
// tanpa backdoor apa pun: dana uji diatur dengan mengedit accounts.json
// di folder data SEMENTARA saat server mati.
//
// Yang dibuktikan:
//  1. Statistik: 2 akun terdaftar, klaim kavling (+2.500 kas), bangun
//     rumah (+2.000 kas), klaim lapak (+10.000 kas) → panel kota melapor
//     penduduk 2, online 2, rumah 1, lapak 1, kas kota TEPAT 14.500.
//  2. Kabar Kota: entri registrasi warga, rumah baru & lapak baru tercatat.
//  3. Lokasi fasilitas SEBELUM aktif bebas dilewati (tidak ada collider
//     hantu) — dibuktikan untuk Taman Bunga & Perpustakaan Mini.
//  4. Voting lolos: tamu ditolak; 1 akun 1 suara final (suara kedua &
//     suara berlawanan ditolak); tally 3 setuju / 1 tolak terbaca benar;
//     jendela berakhir → usulan LOLOS, fasilitas aktif di state & terlihat
//     klien kedua, kabar hasil voting + fasilitas selesai tercatat,
//     collider bedeng bunga menahan pemain, usulan berikutnya terbuka.
//  5. Voting gagal: 1 setuju / 2 tolak → usulan GAGAL, fasilitas TIDAK
//     aktif, kabar kegagalan tercatat, fasilitas masuk antrean belakang
//     (usulan berikutnya = Perpustakaan Mini).
//  6. Perpustakaan Mini lolos → aktif; collider dindingnya menahan pemain.
//  7. Setelah server RESTART: city.json (kas, kabar, fasilitas terbangun,
//     usulan aktif) persisten dan state klien mencerminkannya.
import { Client } from "colyseus.js";
import { spawn } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 2580;
const HTTP = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), "kota-city-"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = Date.now().toString(36);
const userA = `wa${suffix}`;
const userB = `wb${suffix}`;
const userC = `wc${suffix}`;
const userD = `wd${suffix}`;
const PASS = "rahasia123";

// Denah fasilitas — HARUS sama dengan server/src/city/city.ts.
// Bedeng Taman Bunga yang diuji: tengah (-39.2, -29.4), kotak
// x -41..-37.4, z -30.1..-28.7. Perpustakaan: kotak x -28..-20, z -41.25..-36.75.
const TAMAN_BED = { x: -39.2, z: -29.4 };
const TAMAN_BED_BOX = { minX: -41, maxX: -37.4, minZ: -30.1, maxZ: -28.7 };
const PERPUS_CENTER = { x: -24, z: -39 };
const PERPUS_BOX = { minX: -28, maxX: -20, minZ: -41.25, maxZ: -36.75 };
const FUTSAL_CENTER = { x: -36, z: 32 };

function fail(msg) {
  console.error("❌ GAGAL:", msg);
  stopServer();
  process.exit(1);
}

let serverProc = null;
function startServer() {
  serverProc = spawn("node", ["dist/index.js"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), KOTA_DATA_DIR: DATA_DIR, KOTA_VOTE_MINUTES: "1" },
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

async function getCity(room) {
  const p = nextMessage(room, "city");
  room.send("city_get", {});
  const payload = await p;
  if (!payload) fail("Tidak menerima payload city");
  return payload;
}

async function castVote(room, choice) {
  const p = nextMessage(room, "vote_result");
  room.send("vote_cast", { choice });
  const result = await p;
  if (!result) fail("Tidak menerima vote_result");
  return result;
}

function stateFacilities(room) {
  const arr = room.state.facilities;
  const out = [];
  if (!arr) return out;
  if (typeof arr.length === "number") {
    for (let i = 0; i < arr.length; i++) out.push(arr[i]);
  } else if (typeof arr.forEach === "function") {
    arr.forEach((v) => out.push(v));
  }
  return out;
}

const hasNews = (payload, ...words) =>
  payload.news.some((e) => words.every((w) => e.text.includes(w)));

/** Gerakkan pemain sendiri ke target lewat pesan input (lari), berhenti < 1 m dari target. */
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

/** Dorong pemain ke satu arah selama ms; kembalikan posisi awal & akhir. */
async function pushToward(room, input, ms) {
  const me = room.state.players.get(room.sessionId);
  const start = { x: me.x, z: me.z };
  const timer = setInterval(() => room.send("input", { ...input, sprint: true, jump: false }), 66);
  await wait(ms);
  clearInterval(timer);
  room.send("input", { x: 0, z: 0, sprint: false, jump: false });
  await wait(400);
  return { start, end: { x: me.x, z: me.z } };
}

const insideBox = (p, box) => p.x > box.minX && p.x < box.maxX && p.z > box.minZ && p.z < box.maxZ;

async function waitFor(condFn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condFn()) return;
    await wait(1500);
  }
  fail("Timeout menunggu: " + label);
}

// ---------- Fase 1: daftar A & B (kabar registrasi tercatat), lalu danai ----------
startServer();
await waitServerUp();

const regA = await api("/auth/register", { username: userA, password: PASS });
if (regA.status !== 201 || !regA.data.token) fail(`Daftar A gagal: ${regA.status}`);
const regB = await api("/auth/register", { username: userB, password: PASS });
if (regB.status !== 201 || !regB.data.token) fail(`Daftar B gagal: ${regB.status}`);
const tokenA = regA.data.token;
const tokenB = regB.data.token;

stopServer();
await wait(400);
const dbFile = join(DATA_DIR, "accounts.json");
const db = JSON.parse(readFileSync(dbFile, "utf8"));
db.users[userA.toLowerCase()].economy.balance = 30000;
db.users[userB.toLowerCase()].economy.balance = 30000;
writeFileSync(dbFile, JSON.stringify(db, null, 1));
startServer();
await waitServerUp();
console.log("✅ A & B terdaftar (kabar registrasi harusnya tercatat) dan didanai 30.000 KC lewat berkas sementara");

// ---------- Fase 2: lokasi fasilitas bebas SEBELUM aktif + aksi kas kota ----------
const clientA = new Client(WS);
const roomA = await clientA.joinOrCreate("kota", { name: "WargaA", token: tokenA });
await wait(400);
if (stateFacilities(roomA).length !== 0) fail("Awal: belum boleh ada fasilitas aktif di state");

// Taman Bunga belum aktif → bedengnya bebas diinjak.
await driveTo(roomA, { x: -20, z: -4 });
await driveTo(roomA, { x: -30, z: -20 });
await driveTo(roomA, TAMAN_BED);
console.log("✅ Lokasi bedeng Taman Bunga bebas dilewati SEBELUM fasilitas aktif (tidak ada collider hantu)");

// Perpustakaan Mini belum aktif → tanahnya bebas diinjak (lewat belakang ruko dari barat).
await driveTo(roomA, { x: -33, z: -39 });
await driveTo(roomA, PERPUS_CENTER);
console.log("✅ Lokasi Perpustakaan Mini bebas dilewati SEBELUM fasilitas aktif");

// A klaim kavling k1_1 (2.500) + bangun Rumah Bambu (2.000) — tanpa validasi jarak.
let resultPromise = nextMessage(roomA, "plot_result");
roomA.send("plot_claim", { plotId: "k1_1" });
let result = await resultPromise;
if (!result?.ok) fail(`Klaim kavling A gagal: ${JSON.stringify(result)}`);
resultPromise = nextMessage(roomA, "plot_result");
roomA.send("plot_build", { tier: 1 });
result = await resultPromise;
if (!result?.ok) fail(`Bangun rumah A gagal: ${JSON.stringify(result)}`);

const clientB = new Client(WS);
const roomB = await clientB.joinOrCreate("kota", { name: "WargaB", token: tokenB });
await wait(400);
resultPromise = nextMessage(roomB, "lapak_result");
roomB.send("lapak_claim", { lapakId: "lp_1" });
result = await resultPromise;
if (!result?.ok) fail(`Klaim lapak B gagal: ${JSON.stringify(result)}`);
console.log("✅ A klaim kavling + bangun Rumah Bambu; B klaim Lapak No. 1");

// Statistik & kabar: penduduk 2, online 2, rumah 1, lapak 1, kas TEPAT 14.500.
let city = await getCity(roomA);
if (city.residents !== 2) fail(`Penduduk = ${city.residents}, harusnya 2`);
if (city.online !== 2) fail(`Online = ${city.online}, harusnya 2`);
if (city.houses !== 1) fail(`Rumah berdiri = ${city.houses}, harusnya 1`);
if (city.lapaks !== 1) fail(`Lapak aktif = ${city.lapaks}, harusnya 1`);
if (city.kasKota !== 14500) fail(`Kas kota = ${city.kasKota}, harusnya TEPAT 14500 (2500 + 2000 + 10000)`);
if (!hasNews(city, "Warga baru", `@${userA}`)) fail("Kabar registrasi A tidak ditemukan");
if (!hasNews(city, "Warga baru", `@${userB}`)) fail("Kabar registrasi B tidak ditemukan");
if (!hasNews(city, "Rumah Bambu", `@${userA}`)) fail("Kabar rumah baru A tidak ditemukan");
if (!hasNews(city, "Lapak No. 1", `@${userB}`)) fail("Kabar lapak baru B tidak ditemukan");
if (!city.vote || city.vote.facilityId !== "taman_bunga") {
  fail(`Usulan aktif harusnya taman_bunga, terbaca ${city.vote?.facilityId}`);
}
if (city.vote.minYes !== 3 || city.vote.myVote !== "" || city.vote.yes !== 0 || city.vote.no !== 0) {
  fail(`Keadaan awal voting salah: ${JSON.stringify(city.vote)}`);
}
console.log("✅ Statistik kota tepat: penduduk 2, online 2, rumah 1, lapak 1, kas kota 14.500; kabar registrasi/rumah/lapak tercatat; usulan aktif = Taman Bunga");

// ---------- Fase 3: voting Taman Bunga — LOLOS (3 setuju / 1 tolak) ----------
const regC = await api("/auth/register", { username: userC, password: PASS });
if (regC.status !== 201 || !regC.data.token) fail(`Daftar C gagal: ${regC.status}`);
const regD = await api("/auth/register", { username: userD, password: PASS });
if (regD.status !== 201 || !regD.data.token) fail(`Daftar D gagal: ${regD.status}`);
const clientC = new Client(WS);
const roomC = await clientC.joinOrCreate("kota", { name: "WargaC", token: regC.data.token });
const clientD = new Client(WS);
const roomD = await clientD.joinOrCreate("kota", { name: "WargaD", token: regD.data.token });
const guestClient = new Client(WS);
const guestRoom = await guestClient.joinOrCreate("kota", { name: "TamuKota" });
await wait(500);

// Tamu tidak bisa memilih.
let voteResult = await castVote(guestRoom, "yes");
if (voteResult.ok) fail("Tamu harusnya ditolak saat voting");
await guestRoom.leave();
console.log("✅ Tamu ditolak untuk voting");

// A setuju; suara kedua A (setuju lagi & berlawanan) sama-sama ditolak — final.
voteResult = await castVote(roomA, "yes");
if (!voteResult.ok) fail(`Suara A harusnya diterima: ${JSON.stringify(voteResult)}`);
voteResult = await castVote(roomA, "yes");
if (voteResult.ok) fail("Suara kedua A pada usulan yang sama harusnya ditolak");
voteResult = await castVote(roomA, "no");
if (voteResult.ok) fail("A tidak boleh mengganti suara (final)");
console.log("✅ Satu akun satu suara & final: suara kedua dan ganti suara A ditolak");

voteResult = await castVote(roomB, "yes");
if (!voteResult.ok) fail("Suara B harusnya diterima");
voteResult = await castVote(roomC, "yes");
if (!voteResult.ok) fail("Suara C harusnya diterima");
voteResult = await castVote(roomD, "no");
if (!voteResult.ok) fail("Suara D harusnya diterima");

city = await getCity(roomB);
if (city.vote?.yes !== 3 || city.vote?.no !== 1) {
  fail(`Tally harusnya 3 setuju / 1 tolak, terbaca ${city.vote?.yes}/${city.vote?.no}`);
}
if (city.vote?.myVote !== "yes") fail(`myVote B harusnya "yes", terbaca "${city.vote?.myVote}"`);
if (stateFacilities(roomB).length !== 0) fail("Fasilitas tidak boleh aktif sebelum jendela berakhir");
console.log("✅ Tally terbaca benar: 3 setuju / 1 tolak; B melihat suaranya sendiri tercatat");

// Tunggu jendela berakhir (60 detik sejak usulan dibuka) → penutupan oleh loop server.
await waitFor(() => stateFacilities(roomB).includes("taman_bunga"), 90000, "Taman Bunga aktif di state B");
if (!stateFacilities(roomA).includes("taman_bunga")) fail("A tidak melihat Taman Bunga aktif di state");
city = await getCity(roomA);
if (!city.lastResult || city.lastResult.facilityId !== "taman_bunga" || !city.lastResult.passed) {
  fail(`Hasil terakhir harusnya Taman Bunga LOLOS: ${JSON.stringify(city.lastResult)}`);
}
if (city.lastResult.yes !== 3 || city.lastResult.no !== 1) fail("Tally hasil penutupan salah");
if (city.vote?.facilityId !== "lapangan_futsal") {
  fail(`Usulan berikutnya harusnya lapangan_futsal, terbaca ${city.vote?.facilityId}`);
}
if (!hasNews(city, "LOLOS", "Taman Bunga")) fail("Kabar hasil voting (LOLOS) tidak ditemukan");
if (!hasNews(city, "selesai dibangun", "Taman Bunga")) fail("Kabar fasilitas selesai tidak ditemukan");
console.log("✅ Jendela berakhir → Taman Bunga LOLOS & aktif di state (terlihat klien kedua), kabar hasil + fasilitas tercatat, usulan Futsal terbuka");

// Collider bedeng bunga: A berlari ke selatan menuju bedeng — harus tertahan di muka bedeng.
await driveTo(roomA, { x: -33, z: -39 });
await driveTo(roomA, { x: -39.2, z: -24 });
const push1 = await pushToward(roomA, { x: 0, z: -1 }, 3500);
const travelled1 = Math.hypot(push1.end.x - push1.start.x, push1.end.z - push1.start.z);
if (travelled1 < 2) fail(`A hanya bergerak ${travelled1.toFixed(1)} m menuju bedeng`);
if (insideBox(push1.end, TAMAN_BED_BOX)) {
  fail(`A menembus bedeng bunga! Posisi akhir (${push1.end.x.toFixed(1)}, ${push1.end.z.toFixed(1)})`);
}
if (push1.end.z <= TAMAN_BED_BOX.maxZ) {
  fail(`A berhenti terlalu jauh dari bedeng (z=${push1.end.z.toFixed(1)}) — collider tidak terasa`);
}
console.log(`✅ Collider Taman Bunga bekerja — A tertahan di muka bedeng (${push1.end.x.toFixed(1)}, ${push1.end.z.toFixed(1)})`);

// ---------- Fase 4: voting Lapangan Futsal — GAGAL (1 setuju / 2 tolak) ----------
// Lapangan belum aktif → lapangannya bebas diinjak.
await driveTo(roomB, { x: -10, z: 20 });
await driveTo(roomB, { x: -30, z: 20 });
await driveTo(roomB, FUTSAL_CENTER);
console.log("✅ Lokasi Lapangan Futsal bebas dilewati SEBELUM aktif");

voteResult = await castVote(roomA, "yes");
if (!voteResult.ok) fail("Suara A untuk futsal harusnya diterima");
voteResult = await castVote(roomB, "no");
if (!voteResult.ok) fail("Suara B untuk futsal harusnya diterima");
voteResult = await castVote(roomC, "no");
if (!voteResult.ok) fail("Suara C untuk futsal harusnya diterima");

// Tunggu sampai hasil futsal tercatat sebagai hasil terakhir (jendela 60 detik).
{
  const start = Date.now();
  let done = false;
  while (Date.now() - start < 90000) {
    const c = await getCity(roomA);
    if (c.lastResult?.facilityId === "lapangan_futsal") {
      city = c;
      done = true;
      break;
    }
    await wait(2000);
  }
  if (!done) fail("Timeout menunggu penutupan voting futsal");
}
if (city.lastResult.passed) fail("Futsal dengan 1 setuju / 2 tolak harusnya GAGAL");
if (city.lastResult.yes !== 1 || city.lastResult.no !== 2) fail("Tally hasil futsal salah");
if (stateFacilities(roomB).includes("lapangan_futsal")) fail("Futsal TIDAK boleh aktif setelah gagal");
if (!hasNews(city, "belum lolos", "Lapangan Futsal")) fail("Kabar kegagalan futsal tidak ditemukan");
if (city.vote?.facilityId !== "perpustakaan") {
  fail(`Setelah futsal gagal, usulan aktif harusnya perpustakaan (futsal ke belakang antrean), terbaca ${city.vote?.facilityId}`);
}
console.log("✅ Lapangan Futsal GAGAL (1 setuju / 2 tolak): tidak aktif, kabar tercatat, usulan berikutnya = Perpustakaan Mini");

// ---------- Fase 5: voting Perpustakaan Mini — LOLOS ----------
voteResult = await castVote(roomA, "yes");
if (!voteResult.ok) fail("Suara A untuk perpustakaan harusnya diterima");
voteResult = await castVote(roomB, "yes");
if (!voteResult.ok) fail("Suara B untuk perpustakaan harusnya diterima");
voteResult = await castVote(roomC, "yes");
if (!voteResult.ok) fail("Suara C untuk perpustakaan harusnya diterima");

await waitFor(() => stateFacilities(roomA).includes("perpustakaan"), 90000, "Perpustakaan aktif di state A");
city = await getCity(roomB);
if (!city.lastResult || city.lastResult.facilityId !== "perpustakaan" || !city.lastResult.passed) {
  fail(`Hasil terakhir harusnya Perpustakaan LOLOS: ${JSON.stringify(city.lastResult)}`);
}
if (!hasNews(city, "selesai dibangun", "Perpustakaan Mini")) fail("Kabar Perpustakaan selesai tidak ditemukan");
if (city.vote?.facilityId !== "lapangan_futsal") {
  fail(`Satu-satunya yang belum terbangun adalah futsal — usulan aktif harusnya futsal, terbaca ${city.vote?.facilityId}`);
}
console.log("✅ Perpustakaan Mini LOLOS & aktif; usulan aktif kembali ke Lapangan Futsal (sisa antrean)");

// Collider dinding perpustakaan: B mendekat dari barat menyusuri jalur utara, lalu dorong ke timur.
await driveTo(roomB, { x: -37, z: -10 });
await driveTo(roomB, { x: -37, z: -30 });
await driveTo(roomB, { x: -33, z: -39 });
const push2 = await pushToward(roomB, { x: 1, z: 0 }, 3500);
const travelled2 = Math.hypot(push2.end.x - push2.start.x, push2.end.z - push2.start.z);
if (travelled2 < 2) fail(`B hanya bergerak ${travelled2.toFixed(1)} m menuju perpustakaan`);
if (insideBox(push2.end, PERPUS_BOX)) {
  fail(`B menembus dinding Perpustakaan! Posisi akhir (${push2.end.x.toFixed(1)}, ${push2.end.z.toFixed(1)})`);
}
if (push2.end.x >= PERPUS_BOX.minX) {
  fail(`B berhenti terlalu jauh dari dinding (x=${push2.end.x.toFixed(1)}) — collider tidak terasa`);
}
console.log(`✅ Collider Perpustakaan Mini bekerja — B tertahan di muka dinding (${push2.end.x.toFixed(1)}, ${push2.end.z.toFixed(1)})`);

await roomA.leave();
await roomB.leave();
await roomC.leave();
await roomD.leave();

// ---------- Fase 6: restart server — data kota persisten ----------
await restartServer();
if (!existsSync(join(DATA_DIR, "city.json"))) fail("Berkas city.json tidak ada di folder data");
const cityDb = JSON.parse(readFileSync(join(DATA_DIR, "city.json"), "utf8"));
if (cityDb.kasKota !== 14500) fail(`Kas kota di city.json = ${cityDb.kasKota}, harusnya 14500`);
if (!cityDb.built.includes("taman_bunga") || !cityDb.built.includes("perpustakaan")) {
  fail(`Fasilitas terbangun di city.json salah: ${JSON.stringify(cityDb.built)}`);
}
if (cityDb.built.includes("lapangan_futsal")) fail("Futsal tidak boleh ada di daftar terbangun");
if (!Array.isArray(cityDb.news) || cityDb.news.length < 10) {
  fail(`Kabar di city.json hanya ${cityDb.news?.length} entri, harusnya >= 10`);
}
if (!cityDb.news.some((e) => e.text.includes("Warga baru") && e.text.includes(`@${userA}`))) {
  fail("Kabar registrasi A hilang dari city.json");
}
if (!cityDb.news.some((e) => e.text.includes("LOLOS") && e.text.includes("Taman Bunga"))) {
  fail("Kabar hasil voting Taman Bunga hilang dari city.json");
}
console.log(`✅ city.json persisten: kas 14.500, ${cityDb.news.length} kabar, fasilitas terbangun [${cityDb.built.join(", ")}]`);

const clientA2 = new Client(WS);
const roomA2 = await clientA2.joinOrCreate("kota", { name: "WargaA", token: tokenA });
const clientB2 = new Client(WS);
const roomB2 = await clientB2.joinOrCreate("kota", { name: "WargaB", token: tokenB });
await wait(500);
const facsAfter = stateFacilities(roomA2);
if (!facsAfter.includes("taman_bunga") || !facsAfter.includes("perpustakaan")) {
  fail(`State setelah restart harusnya memuat 2 fasilitas aktif, terbaca [${facsAfter.join(", ")}]`);
}
if (facsAfter.includes("lapangan_futsal")) fail("Futsal tidak boleh aktif setelah restart");
const cityAfter = await getCity(roomB2);
if (cityAfter.kasKota !== 14500) fail(`Kas kota setelah restart = ${cityAfter.kasKota}, harusnya 14500`);
if (cityAfter.residents !== 4) fail(`Penduduk setelah restart = ${cityAfter.residents}, harusnya 4`);
if (cityAfter.vote?.facilityId !== "lapangan_futsal") {
  fail(`Usulan aktif setelah restart harusnya lapangan_futsal, terbaca ${cityAfter.vote?.facilityId}`);
}
if (!hasNews(cityAfter, "LOLOS", "Perpustakaan Mini")) fail("Kabar Perpustakaan hilang setelah restart");
await roomA2.leave();
await roomB2.leave();
console.log("✅ Setelah RESTART server: fasilitas aktif, kas kota, penduduk & kabar tetap utuh; usulan futsal berlanjut");

stopServer();
console.log("🎉 SEMUA UJI TAHAP 8 LULUS — statistik kota tepat, kabar tercatat & persisten, voting 1 akun 1 suara final, lolos/gagal benar, fasilitas aktif di state + collider bekerja, lokasi pra-aktif bebas dilewati.");
process.exit(0);
