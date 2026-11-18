// Uji Tahap 6: Kavling & Rumah Pribadi (Kampung Kita) end-to-end.
// Uji ini MENGELOLA SERVER SENDIRI (port 2577 + folder data sementara) karena
// harus membuktikan persistensi lintas restart server — tanpa backdoor apa pun:
// dana uji diatur dengan mengedit accounts.json di folder data SEMENTARA
// saat server mati, persis seperti operator mengedit data mentah.
//
// Yang dibuktikan:
//  1. Klaim dengan saldo kurang ditolak; tamu ditolak.
//  2. Klaim Kavling 1 berhasil — saldo turun TEPAT 2.500 KC.
//  3. Klaim ganda ditolak dua arah: petak yang sama oleh akun lain, dan
//     petak kedua oleh akun yang sama.
//  4. Rumah Tingkat di Kavling 1 ditolak; Rumah Bambu berhasil (−2.000 KC).
//  5. Upgrade Bambu → Batu hanya memotong selisih 3.000 KC; turun tingkat ditolak.
//  6. Klien kedua melihat nama pemilik + tingkat rumah A di state; jumlah
//     rumah berdiri (housesBuilt) benar.
//  7. Pemain yang berlari ke rumah yang berdiri DITAHAN collider (server).
//  8. "Ke Rumahku": pemilik ter-teleport ke halaman rumahnya; pemain tanpa
//     kavling ditolak.
//  9. Setelah server RESTART: kepemilikan, rumah, dan saldo tetap ada.
import { Client } from "colyseus.js";
import { spawn } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 2577;
const HTTP = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), "kota-plots-"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = Date.now().toString(36);
const userA = `kava_${suffix}`;
const userB = `kavb_${suffix}`;
const PASS = "rahasia123";

// Harus sama dengan denah di server/src/housing/housing.ts.
// k1_1: Kavling 1 utara pertama — tengah (50, -28), menghadap +z.
// Rumah Batu (8 x 6.5 m) berdiri di (50, -29.75) → kotak [46,54] x [-33,-26.5].
const PLOT_K1 = "k1_1";
const PLOT_K2 = "k2_1"; // Kavling 2 utara pertama — tengah (53, -12.5)
const HOUSE_BOX = { minX: 46, maxX: 54, minZ: -33, maxZ: -26.5 };
const HOME_POINT = { x: 50, z: -24.5 }; // halaman depan rumah Batu di k1_1

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

/** Gerakkan pemain sendiri ke target murni lewat pesan input (lari), berhenti < 1 m dari target. */
async function driveTo(room, target, timeoutMs = 60000) {
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
const tokenA = regA.data.token;
const tokenB = regB.data.token;

// 1a. Klaim dengan saldo 500 KC harus ditolak (harga Kavling 1 = 2.500 KC).
const clientA = new Client(WS);
let roomA = await clientA.joinOrCreate("kota", { name: "UjiKavA", token: tokenA });
let claimPromise = nextMessage(roomA, "plot_result");
roomA.send("plot_claim", { plotId: PLOT_K1 });
let claim = await claimPromise;
if (!claim || claim.ok) fail("Klaim dengan saldo kurang harusnya ditolak");
console.log("✅ Klaim Kavling 1 dengan saldo 500 KC ditolak server (harga 2.500 KC)");

// 1b. Tamu ditolak klaim.
const guestClient = new Client(WS);
const guestRoom = await guestClient.joinOrCreate("kota", { name: "TamuKav" });
await wait(300);
const guestPromise = nextMessage(guestRoom, "plot_result");
guestRoom.send("plot_claim", { plotId: PLOT_K1 });
const guestClaim = await guestPromise;
if (!guestClaim || guestClaim.ok) fail("Tamu harusnya ditolak saat klaim kavling");
await guestRoom.leave();
console.log("✅ Tamu ditolak untuk klaim kavling");
await roomA.leave();

// ---------- Fase 2: danai akun uji lewat data mentah (server mati) ----------
stopServer();
await wait(400);
const dbFile = join(DATA_DIR, "accounts.json");
const db = JSON.parse(readFileSync(dbFile, "utf8"));
db.users[userA.toLowerCase()].economy.balance = 20000;
db.users[userB.toLowerCase()].economy.balance = 20000;
writeFileSync(dbFile, JSON.stringify(db, null, 1));
startServer();
await waitServerUp();
console.log("✅ Akun uji didanai 20.000 KC lewat berkas data sementara (server direstart)");

roomA = await clientA.joinOrCreate("kota", { name: "UjiKavA", token: tokenA });
const clientB = new Client(WS);
const roomB = await clientB.joinOrCreate("kota", { name: "UjiKavB", token: tokenB });
await wait(500);

// State awal: 24 kavling terdaftar, semuanya kosong.
if (roomA.state.plots.size !== 24) fail(`State harusnya memuat 24 kavling, terbaca ${roomA.state.plots.size}`);
if (roomA.state.housesBuilt !== 0) fail("housesBuilt awal harusnya 0");

// 2. A klaim k1_1 → saldo 20.000 − 2.500 = 17.500.
claimPromise = nextMessage(roomA, "plot_result");
roomA.send("plot_claim", { plotId: PLOT_K1 });
claim = await claimPromise;
if (!claim?.ok) fail(`Klaim A gagal: ${JSON.stringify(claim)}`);
let me = await api("/auth/me", null, tokenA);
if (me.data.balance !== 17500) fail(`Saldo A setelah klaim = ${me.data.balance}, harusnya 17500`);
console.log("✅ A klaim Kavling 1 No. 1 — saldo turun tepat 2.500 KC (20.000 → 17.500)");

// 3a. B klaim petak yang sama → ditolak.
const claimBPromise = nextMessage(roomB, "plot_result");
roomB.send("plot_claim", { plotId: PLOT_K1 });
const claimB = await claimBPromise;
if (!claimB || claimB.ok) fail("Klaim petak yang sudah dimiliki harusnya ditolak");

// 3b. A klaim petak kedua → ditolak (satu akun satu kavling).
const claimA2Promise = nextMessage(roomA, "plot_result");
roomA.send("plot_claim", { plotId: "k1_2" });
const claimA2 = await claimA2Promise;
if (!claimA2 || claimA2.ok) fail("Klaim kavling kedua oleh akun yang sama harusnya ditolak");
console.log("✅ Klaim ganda ditolak dua arah (petak sama oleh B, petak kedua oleh A)");

// B melihat kepemilikan A di state.
await wait(400);
const plotInB = roomB.state.plots.get(PLOT_K1);
if (!plotInB) fail("B tidak melihat kavling k1_1 di state");
if (plotInB.owner !== userA) fail(`Pemilik k1_1 di mata B = "${plotInB.owner}", harusnya "${userA}"`);
if (plotInB.house !== 0) fail("k1_1 harusnya belum ada rumah");
console.log(`✅ B melihat pemilik k1_1 = @${plotInB.owner} di state (tanah kosong)`);

// 4a. Rumah Tingkat di Kavling 1 → ditolak.
let buildPromise = nextMessage(roomA, "plot_result");
roomA.send("plot_build", { tier: 3 });
let build = await buildPromise;
if (!build || build.ok) fail("Rumah Tingkat di Kavling 1 harusnya ditolak");

// 4b. Rumah Bambu → berhasil, saldo 17.500 − 2.000 = 15.500.
buildPromise = nextMessage(roomA, "plot_result");
roomA.send("plot_build", { tier: 1 });
build = await buildPromise;
if (!build?.ok) fail(`Bangun Rumah Bambu gagal: ${JSON.stringify(build)}`);
me = await api("/auth/me", null, tokenA);
if (me.data.balance !== 15500) fail(`Saldo A setelah bangun Bambu = ${me.data.balance}, harusnya 15500`);
console.log("✅ Rumah Tingkat ditolak di Kavling 1; Rumah Bambu berdiri (−2.000 KC → 15.500)");

// 5a. Turun tingkat (Bambu lagi / tier lebih rendah) → ditolak.
buildPromise = nextMessage(roomA, "plot_result");
roomA.send("plot_build", { tier: 1 });
build = await buildPromise;
if (!build || build.ok) fail("Bangun tingkat yang sama harusnya ditolak");

// 5b. Upgrade Bambu → Batu: hanya selisih 5.000 − 2.000 = 3.000 → saldo 12.500.
buildPromise = nextMessage(roomA, "plot_result");
roomA.send("plot_build", { tier: 2 });
build = await buildPromise;
if (!build?.ok) fail(`Upgrade ke Rumah Batu gagal: ${JSON.stringify(build)}`);
me = await api("/auth/me", null, tokenA);
if (me.data.balance !== 12500) fail(`Saldo A setelah upgrade = ${me.data.balance}, harusnya 12500 (selisih 3.000)`);
console.log("✅ Upgrade Bambu → Batu hanya memotong selisih 3.000 KC (15.500 → 12.500)");

// 6. B melihat rumah A + housesBuilt = 1. B juga membuktikan Kavling 2 + Tingkat sah:
//    B klaim k2_1 (5.000) lalu bangun Rumah Tingkat (7.500) → saldo 20.000 − 12.500 = 7.500.
await wait(400);
const plotInB2 = roomB.state.plots.get(PLOT_K1);
if (plotInB2.house !== 2) fail(`Rumah di k1_1 menurut B = tingkat ${plotInB2.house}, harusnya 2 (Batu)`);
if (roomB.state.housesBuilt !== 1) fail(`housesBuilt = ${roomB.state.housesBuilt}, harusnya 1`);
console.log("✅ B melihat Rumah Batu A di state; housesBuilt = 1");

const claimB2Promise = nextMessage(roomB, "plot_result");
roomB.send("plot_claim", { plotId: PLOT_K2 });
const claimB2 = await claimB2Promise;
if (!claimB2?.ok) fail(`Klaim Kavling 2 oleh B gagal: ${JSON.stringify(claimB2)}`);
const buildBPromise = nextMessage(roomB, "plot_result");
roomB.send("plot_build", { tier: 3 });
const buildB = await buildBPromise;
if (!buildB?.ok) fail(`Rumah Tingkat di Kavling 2 harusnya boleh: ${JSON.stringify(buildB)}`);
const meB = await api("/auth/me", null, tokenB);
if (meB.data.balance !== 7500) fail(`Saldo B = ${meB.data.balance}, harusnya 7500 (20.000 − 5.000 − 7.500)`);
await wait(400);
if (roomA.state.housesBuilt !== 2) fail(`housesBuilt setelah rumah B = ${roomA.state.housesBuilt}, harusnya 2`);
console.log("✅ B klaim Kavling 2 (5.000) + Rumah Tingkat (7.500) — sah di petak premium; housesBuilt = 2");

// 8a. "Ke Rumahku" untuk pemain tanpa kavling — pakai akun ketiga? B & A sama-sama punya.
//     Gunakan tamu akun C tanpa kavling: daftar cepat.
const regC = await api("/auth/register", { username: `kavc_${suffix}`, password: PASS });
const clientC = new Client(WS);
const roomC = await clientC.joinOrCreate("kota", { name: "UjiKavC", token: regC.data.token });
await wait(300);
const homeCPromise = nextMessage(roomC, "home_result");
roomC.send("home", {});
const homeC = await homeCPromise;
if (!homeC || homeC.ok) fail("Pemain tanpa kavling harusnya ditolak saat 'Ke Rumahku'");
await roomC.leave();
console.log("✅ 'Ke Rumahku' ditolak untuk pemain tanpa kavling");

// 8b. A teleport pulang: posisi A harus berpindah ke halaman rumahnya.
const aBefore = roomA.state.players.get(roomA.sessionId);
const beforePos = { x: aBefore.x, z: aBefore.z };
const homeAPromise = nextMessage(roomA, "home_result");
roomA.send("home", {});
const homeA = await homeAPromise;
if (!homeA?.ok) fail(`Teleport pulang A gagal: ${JSON.stringify(homeA)}`);
await wait(400);
const aAfter = roomA.state.players.get(roomA.sessionId);
const homeDist = Math.hypot(aAfter.x - HOME_POINT.x, aAfter.z - HOME_POINT.z);
if (homeDist > 1.5) {
  fail(`Posisi A setelah teleport (${aAfter.x.toFixed(1)}, ${aAfter.z.toFixed(1)}), harusnya dekat (${HOME_POINT.x}, ${HOME_POINT.z}) — dari (${beforePos.x.toFixed(1)}, ${beforePos.z.toFixed(1)})`);
}
console.log(`✅ 'Ke Rumahku' memindahkan A ke halaman rumahnya (${aAfter.x.toFixed(1)}, ${aAfter.z.toFixed(1)})`);

// 7. Collider rumah: B berlari menembus rumah Batu A — harus tertahan di luar kotak.
//    Rute aman: spawn B → jalan utama (30, 0) → jalan lingkungan utara (50, -20.5) → lurus ke pusat rumah.
await driveTo(roomB, { x: 30, z: 0 });
await driveTo(roomB, { x: 50, z: -20.5 });
const bInA = roomA.state.players.get(roomB.sessionId);
const driveStart = { x: bInA.x, z: bInA.z };
// Dorong B lurus ke pusat rumah selama 5 detik (lari).
const target = { x: 50, z: -29.75 };
const dirX = target.x - driveStart.x;
const dirZ = target.z - driveStart.z;
const len = Math.hypot(dirX, dirZ);
const runTimer = setInterval(
  () => roomB.send("input", { x: dirX / len, z: dirZ / len, sprint: true, jump: false }),
  66
);
await wait(5000);
clearInterval(runTimer);
roomB.send("input", { x: 0, z: 0, sprint: false, jump: false });
await wait(400);
const bFinal = { x: bInA.x, z: bInA.z };
const travelled = Math.hypot(bFinal.x - driveStart.x, bFinal.z - driveStart.z);
const insideHouse =
  bFinal.x > HOUSE_BOX.minX && bFinal.x < HOUSE_BOX.maxX && bFinal.z > HOUSE_BOX.minZ && bFinal.z < HOUSE_BOX.maxZ;
if (travelled < 3) fail(`B hanya bergerak ${travelled.toFixed(1)} m menuju rumah (harusnya > 3 m)`);
if (insideHouse) fail(`B menembus rumah! Posisi akhir (${bFinal.x.toFixed(1)}, ${bFinal.z.toFixed(1)}) di dalam kotak rumah`);
if (bFinal.z <= HOUSE_BOX.maxZ) fail(`B berhenti terlalu jauh dari rumah (${bFinal.z.toFixed(1)}) — collider tidak terasa di tepi yang benar`);
console.log(
  `✅ Collider rumah bekerja — B berlari ${travelled.toFixed(1)} m dan tertahan di depan rumah A (${bFinal.x.toFixed(1)}, ${bFinal.z.toFixed(1)})`
);

await roomA.leave();
await roomB.leave();

// ---------- Fase 3: restart server — semua harus persisten ----------
await restartServer();
if (!existsSync(join(DATA_DIR, "plots.json"))) fail("Berkas plots.json tidak ada di folder data");
const plotsDb = JSON.parse(readFileSync(join(DATA_DIR, "plots.json"), "utf8"));
if (plotsDb.plots[PLOT_K1]?.owner !== userA.toLowerCase() || plotsDb.plots[PLOT_K1]?.house !== 2) {
  fail(`Isi plots.json salah untuk ${PLOT_K1}: ${JSON.stringify(plotsDb.plots[PLOT_K1])}`);
}
console.log("✅ plots.json persisten di server (pemilik + tingkat rumah tercatat)");

const clientA2 = new Client(WS);
const roomA2 = await clientA2.joinOrCreate("kota", { name: "UjiKavA", token: tokenA });
await wait(500);
const p1 = roomA2.state.plots.get(PLOT_K1);
const p2 = roomA2.state.plots.get(PLOT_K2);
if (!p1 || p1.owner !== userA || p1.house !== 2) fail(`Setelah restart k1_1 = ${JSON.stringify(p1 && { owner: p1.owner, house: p1.house })}`);
if (!p2 || p2.owner !== userB || p2.house !== 3) fail(`Setelah restart k2_1 = ${JSON.stringify(p2 && { owner: p2.owner, house: p2.house })}`);
if (roomA2.state.housesBuilt !== 2) fail(`housesBuilt setelah restart = ${roomA2.state.housesBuilt}, harusnya 2`);
const meFinal = await api("/auth/me", null, tokenA);
if (meFinal.data.balance !== 12500) fail(`Saldo A setelah restart = ${meFinal.data.balance}, harusnya 12500`);
await roomA2.leave();
console.log("✅ Setelah RESTART server: kepemilikan, kedua rumah, housesBuilt, dan saldo tetap utuh");

stopServer();
console.log("🎉 SEMUA UJI TAHAP 6 LULUS — klaim kavling, katalog rumah, upgrade selisih, teleport, collider dinamis, persistensi restart.");
process.exit(0);
