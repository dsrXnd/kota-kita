// Uji Tahap 6B: check-in streak, kebutuhan hidup, 3 pekerjaan baru,
// cooldown per-pekerjaan, skip berbayar + 2 sif bersamaan, dan waktu dunia
// server. Uji ini MENGELOLA SERVER SENDIRI (port 2578 + folder data
// sementara) — tanpa backdoor apa pun:
//  - Hari check-in, saldo, meter kebutuhan, dan cooldown diatur dengan
//    mengedit accounts.json di folder data SEMENTARA saat server mati.
//  - Siang/malam diatur lewat konfigurasi KOTA_TIME_OFFSET_MIN saat server
//    menyala (bukan pesan curang saat permainan berjalan).
//
// Yang dibuktikan:
//  A. Streak Hari 1 = +10 KC; klaim kedua ditolak. Meter kebutuhan ada &
//     berkurang HANYA saat bermain. Dua klien melihat worldTime yang sama;
//     Satpam ditolak saat siang. Maks 2 sif; Kurir+Ojek ditolak bersamaan.
//     Taman +170 & Ojek +220 selesai lewat permainan nyata. Cooldown
//     Penjaga ≈90 mnt & Kurir ≈120 mnt (bukan rata 10 mnt lagi).
//  B. Isi ulang kebutuhan: botol −10 KC, jajanan −20 KC (+60 lapar),
//     WC berbayar −5 KC, masak/WC di rumah sendiri gratis; air mancur,
//     makan besar (−45 KC), WC umum gratis. Meter kritis (lapar 0):
//     job_start ditolak & lari dibatasi kecepatan jalan oleh server.
//  C. Streak: kemarin klaim → Hari 2 = +20; bolong sehari → reset +10;
//     streak 6 + kemarin → Hari 7 = +150.
//  D. Skip: skip tanpa cooldown ditolak tanpa biaya; skip Penjaga −60 KC
//     membersihkan cooldown & attempt 3→2; batalkan sif sesudah skip →
//     biaya TIDAK kembali; attempt habis → ditolak; saldo kurang → ditolak
//     tanpa attempt terpakai.
//  E. Malam server: isNight benar di state; Satpam diterima & +250 KC
//     setelah 60 detik jaga; cooldown Satpam ≈150 mnt.
import { Client } from "colyseus.js";
import { spawn } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 2578;
const HTTP = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), "kota-6b-"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = Date.now().toString(36);
const PASS = "rahasia123";

const userS = `streak_${suffix}`; // streak
const userK = `konkur_${suffix}`; // konkurensi sif
const userT = `taman_${suffix}`; // petugas taman
const userO = `ojek_${suffix}`; // ojek makanan
const userP = `penjaga_${suffix}`; // penjaga + kurir + cooldown
const userN = `needs_${suffix}`; // kebutuhan hidup
const userW = `skip_${suffix}`; // skip cooldown
const userM = `malam_${suffix}`; // satpam malam

// Harus sama dengan server/src/economy/economy.ts.
const TAMAN_POINTS = [
  { x: -19, z: -18 },
  { x: 19, z: -18 },
  { x: -13, z: 12 },
  { x: 13, z: -13 },
  { x: -8, z: 20 },
  { x: 9, z: 21 },
];
const CLEANUP_POINTS = [
  { x: 10, z: 10 },
  { x: -10, z: 10 },
  { x: 10, z: -10 },
  { x: -10, z: -10 },
  { x: 0, z: 16 },
];
const WARKOP_FRONT = { x: -12, z: -24 };
const BAKSO_FRONT = { x: 12, z: -24 };
const SATPAM_SPOT = { x: 0, z: -24 };

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function dayKey(ts) {
  const p = dayFmt.formatToParts(new Date(ts));
  const g = (t) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** Offset menit agar fraksi hari dunia server ≈ targetFrac (0.15 = pagi, 0.79 = malam). */
function offsetForFraction(targetFrac) {
  const cycleMin = 24;
  const nowMin = Date.now() / 60000;
  const cur = ((nowMin % cycleMin) + cycleMin) % cycleMin;
  return String(targetFrac * cycleMin - cur);
}

function fail(msg) {
  console.error("❌ GAGAL:", msg);
  stopServer();
  process.exit(1);
}

let serverProc = null;
function startServer(offsetMin) {
  serverProc = spawn("node", ["dist/index.js"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), KOTA_DATA_DIR: DATA_DIR, KOTA_TIME_OFFSET_MIN: offsetMin },
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
async function restartServer(offsetMin) {
  stopServer();
  await wait(400);
  startServer(offsetMin);
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

async function register(username) {
  const reg = await api("/auth/register", { username, password: PASS });
  if (reg.status !== 201 || !reg.data.token) fail(`Daftar ${username} gagal: ${reg.status} ${JSON.stringify(reg.data)}`);
  return reg.data.token;
}

function nextMessage(room, type, timeoutMs = 8000) {
  const p = new Promise((r) => room.onMessage(type, r));
  return Promise.race([p, wait(timeoutMs).then(() => null)]);
}

/** Tunggu job_update yang menandakan satu sif SELESAI (membawa earned tertentu). */
function waitForEarned(room, earned, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    room.onMessage("job_update", (data) => {
      if (data && data.earned === earned) {
        clearTimeout(timer);
        resolve(data);
      }
    });
  });
}

/** Pantau ringkasan sif aktif terakhir dari job_update (untuk antar: titik ambil & tujuan dari server). */
function trackActives(room) {
  const box = { actives: [] };
  room.onMessage("job_update", (data) => {
    if (data && Array.isArray(data.actives)) box.actives = data.actives;
  });
  return box;
}

async function waitForActive(track, predicate, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const found = track.actives.find(predicate);
    if (found) return found;
    if (Date.now() - start > timeoutMs) return null;
    await wait(200);
  }
}

/** Tunggu pesan needs yang memenuhi syarat. */
function waitForNeeds(room, predicate, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    room.onMessage("needs", (data) => {
      if (data && predicate(data)) {
        clearTimeout(timer);
        resolve(data);
      }
    });
  });
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

/** Berkendara lewat titik-titik jalan (menghindari collider ruko) lalu ke target akhir. */
async function drivePath(room, points) {
  for (const p of points) await driveTo(room, p);
}

/** Antarkan sif antar (kurir/ojek): ke titik ambil dari snapshot server, lalu ke tujuannya. */
async function completeDelivery(room, track, earned) {
  const donePromise = waitForEarned(room, earned, 180000);
  const snap = await waitForActive(track, (a) => a.phase === "pickup" && (a.pickupX || a.pickupZ));
  if (!snap) fail("Snapshot titik ambil tidak pernah datang dari server");
  await driveTo(room, { x: snap.pickupX, z: snap.pickupZ });
  const delivering = await waitForActive(track, (a) => a.phase === "deliver");
  if (!delivering) fail("Fase antar tidak pernah dimulai (titik ambil tidak tercatat server?)");
  const target = { x: delivering.targetX, z: delivering.targetZ };
  if (target.x > 40) {
    await drivePath(room, [{ x: 24, z: 0 }, { x: 44, z: 0 }, { x: target.x, z: 0 }, target]);
  } else {
    await driveTo(room, target, 90000);
  }
  const done = await donePromise;
  if (!done) fail(`Sif antar tidak selesai dengan gaji ${earned} KC`);
  return done;
}

async function getJobs(room) {
  const p = nextMessage(room, "jobs");
  room.send("jobs_get", {});
  const jobs = await p;
  if (!jobs) fail("Server tidak menjawab jobs_get");
  return jobs;
}

async function startJob(room, jobId) {
  const p = nextMessage(room, "job_result");
  room.send("job_start", { jobId });
  return p;
}

async function balanceOf(token) {
  const me = await api("/auth/me", null, token);
  return me.data.balance;
}

/** Edit accounts.json folder data sementara (server HARUS mati). */
function editAccount(username, mutate) {
  const dbFile = join(DATA_DIR, "accounts.json");
  const db = JSON.parse(readFileSync(dbFile, "utf8"));
  const rec = db.users[username.toLowerCase()];
  if (!rec) fail(`Akun ${username} tidak ada di data uji`);
  mutate(rec.economy);
  writeFileSync(dbFile, JSON.stringify(db, null, 1));
}

const DAY = () => offsetForFraction(0.15);
const NIGHT = () => offsetForFraction(0.79);

// ================= FASE A: siang — streak, kebutuhan dasar, konkurensi, pekerjaan baru, cooldown =================
startServer(DAY());
await waitServerUp();

const tokenS = await register(userS);
const tokenK = await register(userK);
const tokenT = await register(userT);
const tokenO = await register(userO);
const tokenP = await register(userP);
const tokenN = await register(userN);
const tokenW = await register(userW);

// A1. Check-in streak Hari 1 = +10 KC; klaim kedua di hari sama ditolak.
{
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", { name: "UjiStreak", token: tokenS });
  const jobs = await getJobs(room);
  if (jobs.jobs.length !== 6) fail(`Daftar pekerjaan harusnya 6, terbaca ${jobs.jobs.length}`);
  if (!jobs.bonusAvailable || jobs.bonusReward !== 10 || jobs.bonusStreakDay !== 1) {
    fail(`Status check-in awal salah: ${JSON.stringify({ a: jobs.bonusAvailable, r: jobs.bonusReward, d: jobs.bonusStreakDay })}`);
  }
  const claimP = nextMessage(room, "bonus_result");
  room.send("bonus_claim", {});
  const claim = await claimP;
  if (!claim?.ok || claim.reward !== 10 || claim.streakDay !== 1 || claim.balance !== 510) {
    fail(`Check-in Hari 1 salah: ${JSON.stringify(claim)}`);
  }
  const claim2P = nextMessage(room, "bonus_result");
  room.send("bonus_claim", {});
  const claim2 = await claim2P;
  if (!claim2 || claim2.ok) fail("Klaim check-in kedua di hari yang sama harusnya ditolak");
  console.log("✅ Streak: check-in Hari 1 = +10 KC (500 → 510); klaim kedua hari sama ditolak");

  // A2. Kebutuhan: meter ada (100) lalu BERKURANG hanya karena bermain.
  const needsP = nextMessage(room, "needs");
  room.send("needs_get", {});
  const needs0 = await needsP;
  if (!needs0 || needs0.hunger !== 100 || needs0.thirst !== 100 || needs0.toilet !== 100) {
    fail(`Meter awal harusnya 100/100/100: ${JSON.stringify(needs0)}`);
  }
  const decayed = await waitForNeeds(room, (n) => n.thirst < 100 && n.hunger < 100, 40000);
  if (!decayed) fail("Meter tidak berkurang setelah ±20 detik bermain");
  console.log(`✅ Kebutuhan: meter mulai 100 dan berkurang saat bermain (haus ${decayed.thirst}, lapar ${decayed.hunger})`);

  // A3. Waktu dunia sama untuk dua klien & sedang siang.
  const client2 = new Client(WS);
  const room2 = await client2.joinOrCreate("kota", { name: "UjiWaktu", token: tokenK });
  await wait(600);
  if (room.state.isNight !== false || room2.state.isNight !== false) fail("Fase ini harusnya siang server (isNight=false)");
  if (Math.abs(room.state.worldTime - room2.state.worldTime) > 0.01) {
    fail(`worldTime dua klien berbeda: ${room.state.worldTime} vs ${room2.state.worldTime}`);
  }
  console.log(`✅ Waktu dunia: dua klien melihat worldTime sama (${room.state.worldTime.toFixed(3)}), siang`);

  // A4. Satpam ditolak saat siang.
  const satpamDay = await startJob(room, "satpam");
  if (!satpamDay || satpamDay.ok) fail("Satpam Malam harusnya DITOLAK saat siang server");
  console.log("✅ Satpam Malam ditolak saat siang server");
  await room.leave();
  await room2.leave();
}

// A5. Konkurensi: 2 sif OK; sif ketiga ditolak; Kurir + Ojek ditolak.
{
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", { name: "UjiKonkur", token: tokenK });
  const track = trackActives(room);
  let r = await startJob(room, "penjaga_warung");
  if (!r?.ok) fail(`Mulai penjaga gagal: ${JSON.stringify(r)}`);
  r = await startJob(room, "kebersihan");
  if (!r?.ok) fail(`Mulai kebersihan (sif ke-2) gagal: ${JSON.stringify(r)}`);
  const two = await waitForActive(track, (a) => a.jobId === "kebersihan");
  if (!two || track.actives.length !== 2) fail(`Harusnya 2 sif aktif bersamaan, terbaca ${track.actives.length}`);
  r = await startJob(room, "taman");
  if (!r || r.ok) fail("Sif ketiga bersamaan harusnya ditolak");
  room.send("job_cancel", { jobId: "penjaga_warung" });
  room.send("job_cancel", { jobId: "kebersihan" });
  await wait(400);
  r = await startJob(room, "kurir");
  if (!r?.ok) fail(`Mulai kurir gagal: ${JSON.stringify(r)}`);
  r = await startJob(room, "ojek");
  if (!r || r.ok) fail("Kurir + Ojek bersamaan harusnya ditolak (dua pekerjaan antar)");
  room.send("job_cancel", { jobId: "kurir" });
  await wait(300);
  console.log("✅ Konkurensi: 2 sif bersamaan OK; sif ke-3 ditolak; Kurir+Ojek bersamaan ditolak");
  await room.leave();
}

// A6. Petugas Taman: 6 titik → +170 KC tepat sekali.
{
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", { name: "UjiTaman", token: tokenT });
  const r = await startJob(room, "taman");
  if (!r?.ok) fail(`Mulai taman gagal: ${JSON.stringify(r)}`);
  const doneP = waitForEarned(room, 170, 180000);
  for (const p of TAMAN_POINTS) await driveTo(room, p);
  const done = await doneP;
  if (!done) fail("Sif taman tidak selesai setelah 6 titik");
  if ((await balanceOf(tokenT)) !== 675) fail(`Saldo taman harusnya 675, terbaca ${await balanceOf(tokenT)}`);
  await wait(1500);
  if ((await balanceOf(tokenT)) !== 675) fail("Gaji taman dibayar lebih dari sekali");
  console.log("✅ Petugas Taman: 6 titik disiram — gaji 170 KC tepat sekali (500 → 675, termasuk quest Kerja Keras +5 dari Tahap 9)");
  await room.leave();
}

// A7. Ojek Makanan: ambil + antar dalam waktu → +220 KC.
{
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", { name: "UjiOjek", token: tokenO });
  const track = trackActives(room);
  const r = await startJob(room, "ojek");
  if (!r?.ok) fail(`Mulai ojek gagal: ${JSON.stringify(r)}`);
  await completeDelivery(room, track, 220);
  if ((await balanceOf(tokenO)) !== 725) fail(`Saldo ojek harusnya 725, terbaca ${await balanceOf(tokenO)}`);
  console.log("✅ Ojek Makanan: ambil & antar selesai — gaji 220 KC (500 → 725, termasuk quest Kerja Keras +5 dari Tahap 9)");
  await room.leave();
}

// A8+A9. Penjaga (45 dtk) & Kurir selesai; cooldown ≈90 & ≈120 menit.
{
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", { name: "UjiPenjaga", token: tokenP });
  const track = trackActives(room);
  let r = await startJob(room, "penjaga_warung");
  if (!r?.ok) fail(`Mulai penjaga gagal: ${JSON.stringify(r)}`);
  const doneP = waitForEarned(room, 150, 120000);
  await driveTo(room, WARKOP_FRONT);
  const done = await doneP;
  if (!done) fail("Sif penjaga tidak selesai setelah 45 detik di pos");
  r = await startJob(room, "kurir");
  if (!r?.ok) fail(`Mulai kurir gagal: ${JSON.stringify(r)}`);
  await completeDelivery(room, track, 200);
  if ((await balanceOf(tokenP)) !== 855) fail(`Saldo P harusnya 855, terbaca ${await balanceOf(tokenP)}`);
  const jobs = await getJobs(room);
  const cdPenjaga = jobs.jobs.find((j) => j.id === "penjaga_warung")?.cooldownRemainingMs ?? 0;
  const cdKurir = jobs.jobs.find((j) => j.id === "kurir")?.cooldownRemainingMs ?? 0;
  if (!(cdPenjaga > 80 * 60000 && cdPenjaga <= 90 * 60000)) fail(`Cooldown penjaga = ${(cdPenjaga / 60000).toFixed(1)} mnt, harusnya ±90`);
  if (!(cdKurir > 110 * 60000 && cdKurir <= 120 * 60000)) fail(`Cooldown kurir = ${(cdKurir / 60000).toFixed(1)} mnt, harusnya ±120`);
  console.log(`✅ Cooldown per-pekerjaan: Penjaga ${(cdPenjaga / 60000).toFixed(0)} mnt (±90), Kurir ${(cdKurir / 60000).toFixed(0)} mnt (±120) — bukan 10 mnt lagi`);
  await room.leave();
}

// Tamu: kebutuhan berlaku sesi saja (mulai penuh, tidak tersimpan).
{
  const guestClient = new Client(WS);
  const guestRoom = await guestClient.joinOrCreate("kota", { name: "TamuNeeds" });
  await wait(300);
  const needsP = nextMessage(guestRoom, "needs");
  guestRoom.send("needs_get", {});
  const gn = await needsP;
  if (!gn || gn.hunger !== 100) fail("Tamu harusnya punya meter sesi mulai 100");
  await guestRoom.leave();
  console.log("✅ Tamu: meter kebutuhan sesi berjalan (mulai 100, tidak disimpan)");
}

// ================= FASE B: isi ulang kebutuhan + efek kritis =================
// Beri userN rumah lewat berkas plots.json sementara (pola data mentah, server mati).
stopServer();
await wait(400);
{
  const plotsFile = join(DATA_DIR, "plots.json");
  writeFileSync(
    plotsFile,
    JSON.stringify({ plots: { k1_1: { owner: userN.toLowerCase(), ownerName: userN, house: 1, claimedAt: 1 } } }, null, 1)
  );
  editAccount(userN, (eco) => {
    eco.balance = 1000;
    eco.needs = { hunger: 30, thirst: 30, toilet: 20 };
  });
}
startServer(DAY());
await waitServerUp();

{
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", { name: "UjiNeeds", token: tokenN });
  const needsP = nextMessage(room, "needs");
  room.send("needs_get", {});
  const n0 = await needsP;
  if (!n0 || Math.abs(n0.hunger - 30) > 2 || Math.abs(n0.thirst - 30) > 2 || Math.abs(n0.toilet - 20) > 2) {
    fail(`Meter fixture tidak termuat: ${JSON.stringify(n0)}`);
  }
  console.log("✅ Meter kebutuhan termuat dari data akun (30/30/20)");

  const refill = async (action) => {
    const p = nextMessage(room, "needs_result");
    room.send("need_refill", { action });
    return p;
  };
  const needsNow = async () => {
    const p = nextMessage(room, "needs");
    room.send("needs_get", {});
    return p;
  };

  // Minum botol di Warung Kopi: −10 KC, haus penuh.
  await driveTo(room, WARKOP_FRONT);
  let res = await refill("drink_bottle");
  if (!res?.ok) fail(`drink_bottle gagal: ${JSON.stringify(res)}`);
  if ((await balanceOf(tokenN)) !== 990) fail(`Saldo setelah botol harusnya 990, terbaca ${await balanceOf(tokenN)}`);
  let n = await needsNow();
  if (n.thirst !== 100) fail(`Haus setelah botol harusnya 100, terbaca ${n.thirst}`);

  // Jajanan di tempat yang sama: −20 KC, lapar +60 (30 → ±90).
  res = await refill("eat_snack");
  if (!res?.ok) fail(`eat_snack gagal: ${JSON.stringify(res)}`);
  if ((await balanceOf(tokenN)) !== 970) fail(`Saldo setelah jajanan harusnya 970, terbaca ${await balanceOf(tokenN)}`);
  n = await needsNow();
  if (!(n.hunger >= 84 && n.hunger <= 92)) fail(`Lapar setelah jajanan harusnya ±90, terbaca ${n.hunger}`);

  // WC berbayar dekat plaza: −5 KC, kebelet penuh.
  await driveTo(room, { x: 6, z: 15 });
  res = await refill("wc_paid");
  if (!res?.ok) fail(`wc_paid gagal: ${JSON.stringify(res)}`);
  if ((await balanceOf(tokenN)) !== 965) fail(`Saldo setelah WC berbayar harusnya 965, terbaca ${await balanceOf(tokenN)}`);
  n = await needsNow();
  if (n.toilet !== 100) fail(`Kebelet setelah WC berbayar harusnya 100, terbaca ${n.toilet}`);

  // Masak & WC di rumah sendiri (k1_1): GRATIS, lapar penuh.
  await drivePath(room, [{ x: 44, z: 0 }, { x: 50, z: -20.5 }, { x: 50, z: -25 }]);
  res = await refill("cook_home");
  if (!res?.ok) fail(`cook_home gagal: ${JSON.stringify(res)}`);
  res = await refill("wc_home");
  if (!res?.ok) fail(`wc_home gagal: ${JSON.stringify(res)}`);
  if ((await balanceOf(tokenN)) !== 965) fail(`Masak/WC di rumah harusnya gratis, saldo terbaca ${await balanceOf(tokenN)}`);
  n = await needsNow();
  if (n.hunger !== 100) fail(`Lapar setelah masak di rumah harusnya 100, terbaca ${n.hunger}`);
  console.log("✅ Isi ulang berbayar & rumah: botol −10 KC, jajanan −20 KC (+60), WC berbayar −5 KC, masak/WC rumah GRATIS");
  await room.leave();
}

// B2. Jalur gratis murni: air mancur, makan besar berbayar, WC umum gratis.
stopServer();
await wait(400);
editAccount(userN, (eco) => {
  eco.needs = { hunger: 10, thirst: 10, toilet: 10 };
});
startServer(DAY());
await waitServerUp();
{
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", { name: "UjiNeeds", token: tokenN });
  await wait(300);
  const refill = async (action) => {
    const p = nextMessage(room, "needs_result");
    room.send("need_refill", { action });
    return p;
  };
  const needsNow = async () => {
    const p = nextMessage(room, "needs");
    room.send("needs_get", {});
    return p;
  };
  const before = await balanceOf(tokenN);
  await driveTo(room, { x: 4.5, z: 0 });
  let res = await refill("drink_fountain");
  if (!res?.ok) fail(`drink_fountain gagal: ${JSON.stringify(res)}`);
  let n = await needsNow();
  if (n.thirst !== 100) fail(`Haus setelah air mancur harusnya 100, terbaca ${n.thirst}`);
  if ((await balanceOf(tokenN)) !== before) fail("Minum di air mancur harusnya GRATIS");
  await driveTo(room, BAKSO_FRONT);
  res = await refill("eat_meal");
  if (!res?.ok) fail(`eat_meal gagal: ${JSON.stringify(res)}`);
  if ((await balanceOf(tokenN)) !== before - 45) fail(`Makan besar harusnya −45 KC, saldo terbaca ${await balanceOf(tokenN)}`);
  n = await needsNow();
  if (n.hunger !== 100) fail(`Lapar setelah makan besar harusnya 100, terbaca ${n.hunger}`);
  await driveTo(room, SATPAM_SPOT);
  res = await refill("wc_public");
  if (!res?.ok) fail(`wc_public gagal: ${JSON.stringify(res)}`);
  n = await needsNow();
  if (n.toilet !== 100) fail(`Kebelet setelah WC umum harusnya 100, terbaca ${n.toilet}`);
  if ((await balanceOf(tokenN)) !== before - 45) fail("WC umum harusnya GRATIS");
  console.log("✅ Jalur gratis: air mancur & WC Balai Kota gratis; makan besar −45 KC → kenyang penuh");
  await room.leave();
}

// B3. Efek kritis: lapar 0 → job_start ditolak & lari dibatasi server.
stopServer();
await wait(400);
editAccount(userN, (eco) => {
  eco.needs = { hunger: 0, thirst: 50, toilet: 50 };
});
startServer(DAY());
await waitServerUp();
{
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", { name: "UjiNeeds", token: tokenN });
  await wait(400);
  const r = await startJob(room, "kebersihan");
  if (!r || r.ok) fail("job_start saat lapar kritis (0) harusnya DITOLAK");
  // Ukur kecepatan: sprint ke utara 2 detik dari posisi diam.
  const me0 = room.state.players.get(room.sessionId);
  const startPos = { x: me0.x, z: me0.z };
  const timer = setInterval(() => room.send("input", { x: 0, z: -1, sprint: true, jump: false }), 66);
  await wait(2000);
  clearInterval(timer);
  room.send("input", { x: 0, z: 0, sprint: false, jump: false });
  await wait(300);
  const me1 = room.state.players.get(room.sessionId);
  const dist = Math.hypot(me1.x - startPos.x, me1.z - startPos.z);
  if (!(dist >= 5.5 && dist <= 11)) {
    fail(`Jarak sprint saat kritis = ${dist.toFixed(1)} m dalam 2 dtk — harusnya ±8 m (kecepatan jalan 4 m/dtk), bukan ±14 m (lari)`);
  }
  console.log(`✅ Efek kritis: job_start ditolak; sprint dibatasi server ke kecepatan jalan (${dist.toFixed(1)} m / 2 dtk)`);
  // Pulih: jalan ke Warung Kopi, makan jajanan → sif boleh dimulai lagi.
  await driveTo(room, WARKOP_FRONT, 90000);
  const resP = nextMessage(room, "needs_result");
  room.send("need_refill", { action: "eat_snack" });
  const res = await resP;
  if (!res?.ok) fail(`eat_snack pemulihan gagal: ${JSON.stringify(res)}`);
  const r2 = await startJob(room, "kebersihan");
  if (!r2?.ok) fail(`job_start setelah makan harusnya diterima: ${JSON.stringify(r2)}`);
  room.send("job_cancel", { jobId: "kebersihan" });
  await wait(300);
  console.log("✅ Setelah kebutuhan teratasi, job_start diterima lagi");
  await room.leave();
}

// ================= FASE C: tangga streak lewat data hari =================
async function streakFixture(lastDay, streakCount) {
  stopServer();
  await wait(400);
  editAccount(userS, (eco) => {
    eco.lastBonusDay = lastDay;
    eco.streakCount = streakCount;
  });
  startServer(DAY());
  await waitServerUp();
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", { name: "UjiStreak", token: tokenS });
  const p = nextMessage(room, "bonus_result");
  room.send("bonus_claim", {});
  const claim = await p;
  await room.leave();
  return claim;
}
{
  const yesterday = dayKey(Date.now() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = dayKey(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const c1 = await streakFixture(yesterday, 1);
  if (!c1?.ok || c1.reward !== 20 || c1.streakDay !== 2 || c1.balance !== 530) {
    fail(`Streak Hari 2 salah: ${JSON.stringify(c1)}`);
  }
  console.log("✅ Streak: klaim beruntun → Hari 2 = +20 KC (510 → 530)");
  const c2 = await streakFixture(twoDaysAgo, 5);
  if (!c2?.ok || c2.reward !== 10 || c2.streakDay !== 1 || c2.balance !== 540) {
    fail(`Streak reset salah: ${JSON.stringify(c2)}`);
  }
  console.log("✅ Streak: bolong sehari → reset ke Hari 1 = +10 KC (530 → 540)");
  const c3 = await streakFixture(yesterday, 6);
  if (!c3?.ok || c3.reward !== 150 || c3.streakDay !== 7 || c3.balance !== 690) {
    fail(`Streak Hari 7 salah: ${JSON.stringify(c3)}`);
  }
  console.log("✅ Streak: Hari 7 = jackpot +150 KC (540 → 690)");
}

// ================= FASE D: skip cooldown berbayar =================
stopServer();
await wait(400);
editAccount(userW, (eco) => {
  eco.balance = 20000;
  eco.jobLastDone = {};
  eco.skipDay = "";
  eco.skipUsed = 0;
  eco.needs = { hunger: 100, thirst: 100, toilet: 100 };
});
startServer(DAY());
await waitServerUp();
{
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", { name: "UjiSkip", token: tokenW });
  const skip = async (jobId) => {
    const p = nextMessage(room, "job_skip_result");
    room.send("job_skip", { jobId });
    return p;
  };
  // D1. Skip pekerjaan yang TIDAK cooldown → ditolak, tanpa biaya, attempt utuh.
  let s = await skip("taman");
  if (!s || s.ok) fail("Skip pekerjaan yang tidak cooldown harusnya ditolak");
  if ((await balanceOf(tokenW)) !== 20000) fail("Skip yang ditolak tidak boleh memotong saldo");
  let jobs = await getJobs(room);
  if (jobs.skipAttemptsLeft !== 3) fail(`Attempt awal harusnya 3, terbaca ${jobs.skipAttemptsLeft}`);
  console.log("✅ Skip tanpa cooldown ditolak — saldo & attempt utuh");

  // D2. Selesaikan Penjaga → cooldown. D3. Skip −60 KC membersihkannya.
  let r = await startJob(room, "penjaga_warung");
  if (!r?.ok) fail(`Mulai penjaga (skip suite) gagal: ${JSON.stringify(r)}`);
  const doneP = waitForEarned(room, 150, 120000);
  await driveTo(room, WARKOP_FRONT);
  if (!(await doneP)) fail("Sif penjaga (skip suite) tidak selesai");
  if ((await balanceOf(tokenW)) !== 20155) fail(`Saldo W harusnya 20155, terbaca ${await balanceOf(tokenW)}`);
  s = await skip("penjaga_warung");
  if (!s?.ok) fail(`Skip penjaga gagal: ${JSON.stringify(s)}`);
  if ((await balanceOf(tokenW)) !== 20095) fail(`Skip penjaga harusnya −60 KC → 20095, terbaca ${await balanceOf(tokenW)}`);
  jobs = await getJobs(room);
  if (jobs.skipAttemptsLeft !== 2) fail(`Attempt setelah skip harusnya 2, terbaca ${jobs.skipAttemptsLeft}`);
  const cdAfterSkip = jobs.jobs.find((j) => j.id === "penjaga_warung")?.cooldownRemainingMs ?? -1;
  if (cdAfterSkip !== 0) fail(`Cooldown penjaga setelah skip harusnya 0, terbaca ${cdAfterSkip}`);
  console.log("✅ Skip Penjaga: −60 KC terbakar, cooldown bersih, attempt 3 → 2");

  // D4. Mulai lagi lalu BATALKAN → biaya skip TIDAK kembali.
  r = await startJob(room, "penjaga_warung");
  if (!r?.ok) fail(`Mulai penjaga pasca-skip gagal: ${JSON.stringify(r)}`);
  room.send("job_cancel", { jobId: "penjaga_warung" });
  await wait(400);
  if ((await balanceOf(tokenW)) !== 20095) fail(`Biaya skip harusnya HANGUS setelah batal, saldo terbaca ${await balanceOf(tokenW)}`);
  console.log("✅ Sif hasil skip dibatalkan → biaya 60 KC tetap hangus (tidak kembali)");

  // D5. Kebersihan selesai → skip −80 KC (attempt 2 → 1).
  r = await startJob(room, "kebersihan");
  if (!r?.ok) fail(`Mulai kebersihan (skip suite) gagal: ${JSON.stringify(r)}`);
  const doneK = waitForEarned(room, 180, 180000);
  for (const p of CLEANUP_POINTS) await driveTo(room, p);
  if (!(await doneK)) fail("Sif kebersihan (skip suite) tidak selesai");
  s = await skip("kebersihan");
  if (!s?.ok) fail(`Skip kebersihan gagal: ${JSON.stringify(s)}`);
  if ((await balanceOf(tokenW)) !== 20195) fail(`Saldo setelah skip kebersihan harusnya 20195, terbaca ${await balanceOf(tokenW)}`);

  // D6. Taman selesai → skip −70 KC (attempt 1 → 0).
  r = await startJob(room, "taman");
  if (!r?.ok) fail(`Mulai taman (skip suite) gagal: ${JSON.stringify(r)}`);
  const doneT = waitForEarned(room, 170, 180000);
  for (const p of TAMAN_POINTS) await driveTo(room, p);
  if (!(await doneT)) fail("Sif taman (skip suite) tidak selesai");
  s = await skip("taman");
  if (!s?.ok) fail(`Skip taman gagal: ${JSON.stringify(s)}`);
  jobs = await getJobs(room);
  if (jobs.skipAttemptsLeft !== 0) fail(`Attempt setelah 3x skip harusnya 0, terbaca ${jobs.skipAttemptsLeft}`);
  if ((await balanceOf(tokenW)) !== 20295) fail(`Saldo setelah skip taman harusnya 20295, terbaca ${await balanceOf(tokenW)}`);
  console.log("✅ Skip Kebersihan −80 KC & Taman −70 KC — attempt bersama habis (0 tersisa)");

  // D7. Taman selesai lagi (sedang cooldown) → skip ke-4 DITOLAK (attempt habis).
  r = await startJob(room, "taman");
  if (!r?.ok) fail(`Mulai taman kedua (skip suite) gagal: ${JSON.stringify(r)}`);
  const doneT2 = waitForEarned(room, 170, 180000);
  for (const p of TAMAN_POINTS) await driveTo(room, p);
  if (!(await doneT2)) fail("Sif taman kedua (skip suite) tidak selesai");
  const balBefore = await balanceOf(tokenW);
  s = await skip("taman");
  if (!s || s.ok) fail("Skip ke-4 harusnya ditolak (jatah harian habis)");
  if ((await balanceOf(tokenW)) !== balBefore) fail("Skip yang ditolak tidak boleh memotong saldo");
  console.log("✅ Skip ke-4 ditolak — jatah 3x/hari ditegakkan server");
  await room.leave();
}

// D8. Saldo kurang → skip ditolak, attempt TIDAK terpakai.
stopServer();
await wait(400);
editAccount(userW, (eco) => {
  eco.balance = 50;
  eco.jobLastDone = { kurir: Date.now() };
  eco.skipDay = dayKey(Date.now());
  eco.skipUsed = 0;
});
startServer(DAY());
await waitServerUp();
{
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", { name: "UjiSkip", token: tokenW });
  const p = nextMessage(room, "job_skip_result");
  room.send("job_skip", { jobId: "kurir" });
  const s = await p;
  if (!s || s.ok) fail("Skip dengan saldo 50 KC (biaya 90) harusnya ditolak");
  if ((await balanceOf(tokenW)) !== 50) fail("Saldo tidak boleh berubah saat skip ditolak");
  const jobs = await getJobs(room);
  if (jobs.skipAttemptsLeft !== 3) fail(`Attempt tidak boleh terpakai saat skip ditolak, terbaca ${jobs.skipAttemptsLeft}`);
  console.log("✅ Skip saldo kurang ditolak — saldo & attempt utuh");
  await room.leave();
}

// ================= FASE E: malam server — Satpam Malam =================
await restartServer(NIGHT());
const tokenM = await register(userM);
{
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", { name: "UjiMalam", token: tokenM });
  const client2 = new Client(WS);
  const room2 = await client2.joinOrCreate("kota", { name: "UjiMalam2", token: tokenS });
  await wait(600);
  if (room.state.isNight !== true) fail("Fase ini harusnya malam server (isNight=true)");
  if (Math.abs(room.state.worldTime - room2.state.worldTime) > 0.01) fail("worldTime dua klien di malam hari berbeda");
  console.log(`✅ Malam server: isNight=true di state, worldTime sama untuk dua klien (${room.state.worldTime.toFixed(3)})`);
  const r = await startJob(room, "satpam");
  if (!r?.ok) fail(`Satpam harusnya DITERIMA saat malam: ${JSON.stringify(r)}`);
  const doneP = waitForEarned(room, 250, 150000);
  await driveTo(room, SATPAM_SPOT);
  const done = await doneP;
  if (!done) fail("Sif satpam tidak selesai setelah 60 detik jaga");
  if ((await balanceOf(tokenM)) !== 755) fail(`Saldo satpam harusnya 755, terbaca ${await balanceOf(tokenM)}`);
  await wait(1500);
  if ((await balanceOf(tokenM)) !== 755) fail("Gaji satpam dibayar lebih dari sekali");
  const jobs = await getJobs(room);
  const cdSatpam = jobs.jobs.find((j) => j.id === "satpam")?.cooldownRemainingMs ?? 0;
  if (!(cdSatpam > 140 * 60000 && cdSatpam <= 150 * 60000)) {
    fail(`Cooldown satpam = ${(cdSatpam / 60000).toFixed(1)} mnt, harusnya ±150`);
  }
  console.log(`✅ Satpam Malam: diterima saat malam, 60 detik jaga → +250 KC tepat sekali; cooldown ${(cdSatpam / 60000).toFixed(0)} mnt (±150)`);
  await room.leave();
  await room2.leave();
}

stopServer();
console.log("🎉 SEMUA UJI TAHAP 6B LULUS — streak, kebutuhan hidup + jalur gratis, efek kritis, 3 pekerjaan baru, cooldown per-pekerjaan, skip berbayar & 2 sif, waktu dunia server.");
process.exit(0);
