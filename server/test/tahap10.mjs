// Uji Tahap 10: Polesan Hasil Tes Main — pilihan 2 pekerjaan (ganti bayar
// 500 KC terbakar), statistik pekerjaan per akun, dan tujuan sif (objective)
// di payload. Uji ini MENGELOLA SERVER SENDIRI (port 2582 + folder data
// sementara) — tanpa backdoor: saldo diatur lewat berkas data sementara
// saat server mati, sisanya murni pesan permainan & API publik.
//
// Yang dibuktikan:
//  1. job_choose: tamu ditolak; 1/3/duplikat/id tak dikenal ditolak;
//     pilihan pertama 2 pekerjaan GRATIS (saldo utuh); payload memuat
//     chosenJobs/needsChoice/changeFee=500/jobStats; job_start pekerjaan
//     yang belum dipilih ditolak ("Pilih dulu 2 pekerjaanmu"), pekerjaan
//     di luar pilihan ditolak ("bukan pilihanmu"), pekerjaan pilihan OK;
//     ganti pilihan saat sif berjalan ditolak.
//  2. Ganti pilihan: himpunan sama ditolak TANPA biaya; saldo 400 (< 500)
//     ditolak dengan pilihan & saldo utuh; ganti yang sah membakar TEPAT
//     500 KC dan himpunan baru ditegakkan server.
//  3. Cooldown MENEMPEL pada pekerjaan: selesai kebersihan → cooldown
//     berjalan; ganti pilihan pergi & kembali (2x bayar) → cooldown
//     kebersihan MASIH berjalan (tidak reset oleh ganti pilihan).
//  4. Statistik: sif selesai → done+1 & earned = gaji; antar kelewat
//     waktu → failed+1; mulai lalu BATAL → statistik tidak berubah.
//  5. Objective: kebersihan → salah satu titik bersih-bersih; kurir →
//     titik ambil, setelah diambil → tujuan antar.
//  6. Tamu: payload jobs guest tanpa chosenJobs/statistik & needsChoice mati.
import { Client } from "colyseus.js";
import { spawn } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 2582;
const HTTP = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), "kota-tahap10-"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = Date.now().toString(36);
const PASS = "rahasia123";
const userA = `pilih_${suffix}`;
const userB = `stat_${suffix}`;
const userC = `arah_${suffix}`;

// Sama dengan CLEANUP_POINTS di server/src/economy/economy.ts.
const CLEANUP_POINTS = [
  { x: 10, z: 10 },
  { x: -10, z: 10 },
  { x: 10, z: -10 },
  { x: -10, z: -10 },
  { x: 0, z: 16 },
];

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

async function register(username) {
  const reg = await api("/auth/register", { username, password: PASS });
  if (reg.status !== 201 || !reg.data.token) fail(`Daftar ${username} gagal: ${reg.status}`);
  return reg.data.token;
}

function nextMessage(room, type, timeoutMs = 8000) {
  const p = new Promise((r) => room.onMessage(type, r));
  return Promise.race([p, wait(timeoutMs).then(() => null)]);
}

async function getJobs(room) {
  const p = nextMessage(room, "jobs");
  room.send("jobs_get", {});
  const payload = await p;
  if (!payload) fail("Tidak menerima payload jobs");
  return payload;
}

async function startJob(room, jobId) {
  const p = nextMessage(room, "job_result");
  room.send("job_start", { jobId });
  return p;
}

async function chooseJobs(room, jobIds) {
  const p = nextMessage(room, "job_choose_result");
  room.send("job_choose", { jobIds });
  return p;
}

async function balanceOf(token) {
  const me = await api("/auth/me", null, token);
  if (typeof me.data.balance !== "number") fail("Saldo tidak terbaca dari /auth/me");
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

/** Gerakkan pemain sendiri ke target lewat pesan input (lari), berhenti < stopDist m dari target. */
async function driveTo(room, target, timeoutMs = 60000, stopDist = 1.0) {
  const start = Date.now();
  for (;;) {
    const me = room.state.players.get(room.sessionId);
    if (!me) fail("Pemain sendiri tidak ada di state");
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d < stopDist) break;
    if (Date.now() - start > timeoutMs) {
      room.send("input", { x: 0, z: 0, sprint: false, jump: false });
      fail(`Tidak sampai ke titik (${target.x}, ${target.z}) — jarak tersisa ${d.toFixed(1)} m`);
    }
    room.send("input", { x: dx / d, z: dz / d, sprint: true, jump: false });
    await wait(120);
  }
  room.send("input", { x: 0, z: 0, sprint: false, jump: false });
}

async function joinRoom(name, token) {
  const client = new Client(WS);
  const room = await client.joinOrCreate("kota", token ? { name, token } : { name });
  await wait(300);
  return room;
}

// ================= FASE 1: validasi job_choose & gerbang job_start =================
startServer();
await waitServerUp();
const tokenA = await register(userA);
const tokenB = await register(userB);
const tokenC = await register(userC);

// Tamu: job_choose ditolak; payload jobs tanpa pilihan/statistik.
{
  const roomG = await joinRoom("TamuUji", null);
  const res = await chooseJobs(roomG, ["kebersihan", "kurir"]);
  if (!res || res.ok) fail("job_choose dari tamu harusnya ditolak");
  const jobsG = await getJobs(roomG);
  if (!jobsG.guest) fail("Payload tamu harusnya guest=true");
  if (!Array.isArray(jobsG.chosenJobs) || jobsG.chosenJobs.length !== 0) {
    fail(`Tamu tidak boleh punya chosenJobs, terbaca ${JSON.stringify(jobsG.chosenJobs)}`);
  }
  if (jobsG.needsChoice) fail("needsChoice tamu harusnya false (tamu tidak memilih pekerjaan)");
  if (!jobsG.jobStats || Object.keys(jobsG.jobStats).length !== 0) {
    fail(`Tamu tidak boleh punya jobStats, terbaca ${JSON.stringify(jobsG.jobStats)}`);
  }
  await roomG.leave();
  console.log("✅ Tamu: job_choose ditolak; payload tanpa chosenJobs/jobStats, needsChoice=false");
}

const roomA = await joinRoom("UjiPilih", tokenA);
{
  const jobs0 = await getJobs(roomA);
  if (!jobs0.needsChoice) fail("Akun baru harusnya needsChoice=true");
  if (jobs0.changeFee !== 500) fail(`changeFee harusnya 500, terbaca ${jobs0.changeFee}`);
  if (!Array.isArray(jobs0.chosenJobs) || jobs0.chosenJobs.length !== 0) fail("chosenJobs awal harusnya []");

  // job_start sebelum memilih → ditolak dengan pesan memilih dulu.
  const early = await startJob(roomA, "kebersihan");
  if (!early || early.ok) fail("job_start sebelum memilih harusnya ditolak");
  if (!String(early.message).includes("Pilih dulu 2 pekerjaanmu")) {
    fail(`Pesan penolakan harusnya menyuruh memilih dulu, terbaca: ${early.message}`);
  }

  // Bentuk pilihan yang salah semuanya ditolak.
  for (const [label, ids] of [
    ["1 pekerjaan", ["kebersihan"]],
    ["3 pekerjaan", ["kebersihan", "kurir", "taman"]],
    ["duplikat", ["kurir", "kurir"]],
    ["id tak dikenal", ["kurir", "ngawur"]],
  ]) {
    const res = await chooseJobs(roomA, ids);
    if (!res || res.ok) fail(`job_choose ${label} harusnya ditolak`);
  }
  if ((await balanceOf(tokenA)) !== 500) fail("Pilihan yang ditolak tidak boleh mengubah saldo");
  console.log("✅ job_choose: 1/3/duplikat/id tak dikenal ditolak; job_start sebelum memilih ditolak");

  // Pilihan pertama yang sah: GRATIS, saldo utuh.
  const first = await chooseJobs(roomA, ["kebersihan", "kurir"]);
  if (!first?.ok) fail(`Pilihan pertama harusnya diterima: ${JSON.stringify(first)}`);
  if (first.charged) fail(`Pilihan pertama harusnya gratis, terbaca charged=${first.charged}`);
  if ((await balanceOf(tokenA)) !== 500) fail("Saldo berubah setelah pilihan pertama (harusnya tetap 500)");
  const jobs1 = await getJobs(roomA);
  if (jobs1.needsChoice) fail("needsChoice harusnya false setelah memilih");
  if (!jobs1.chosenJobs.includes("kebersihan") || !jobs1.chosenJobs.includes("kurir")) {
    fail(`chosenJobs salah: ${JSON.stringify(jobs1.chosenJobs)}`);
  }
  console.log("✅ Pilihan pertama [kebersihan, kurir] GRATIS — saldo tetap 500, needsChoice=false");

  // Pekerjaan di luar pilihan ditolak; pekerjaan pilihan diterima.
  const outside = await startJob(roomA, "taman");
  if (!outside || outside.ok) fail("job_start di luar pilihan harusnya ditolak");
  if (!String(outside.message).includes("bukan pilihanmu")) {
    fail(`Pesan penolakan harusnya menyebut bukan pilihanmu, terbaca: ${outside.message}`);
  }
  const inside = await startJob(roomA, "kebersihan");
  if (!inside?.ok) fail(`job_start pekerjaan pilihan harusnya diterima: ${JSON.stringify(inside)}`);
  console.log("✅ Gerbang pilihan: taman (di luar pilihan) ditolak, kebersihan (pilihan) diterima");

  // Ganti pilihan saat sif berjalan ditolak.
  const during = await chooseJobs(roomA, ["kebersihan", "taman"]);
  if (!during || during.ok) fail("job_choose saat sif berjalan harusnya ditolak");
  roomA.send("job_cancel", { jobId: "kebersihan" });
  await wait(400);
  console.log("✅ job_choose saat sif berjalan ditolak; sif dibatalkan untuk fase berikut");
}

// ================= FASE 2: aturan ganti pilihan (sama / saldo kurang / sah −500) =================
{
  // Himpunan sama (urutan dibalik) → ditolak, TANPA biaya.
  const same = await chooseJobs(roomA, ["kurir", "kebersihan"]);
  if (!same || same.ok) fail("Ganti ke himpunan yang sama harusnya ditolak");
  if ((await balanceOf(tokenA)) !== 500) fail("Penolakan himpunan sama tidak boleh memotong saldo");
  console.log("✅ Ganti ke pilihan yang sama ditolak tanpa biaya (saldo tetap 500)");
}
// Fixture saldo 400 (server mati) → ganti pilihan harus ditolak saldo kurang.
stopServer();
await wait(400);
editAccount(userA, (eco) => {
  eco.balance = 400;
});
startServer();
await waitServerUp();
const roomA2 = await joinRoom("UjiPilih", tokenA);
{
  if ((await balanceOf(tokenA)) !== 400) fail("Fixture saldo 400 tidak termuat");
  const poor = await chooseJobs(roomA2, ["kebersihan", "taman"]);
  if (!poor || poor.ok) fail("Ganti pilihan dengan saldo 400 (< 500) harusnya ditolak");
  if ((await balanceOf(tokenA)) !== 400) fail("Saldo berubah setelah ganti pilihan yang ditolak");
  const jobs = await getJobs(roomA2);
  if (!jobs.chosenJobs.includes("kurir") || jobs.chosenJobs.includes("taman")) {
    fail(`Pilihan berubah padahal ditolak: ${JSON.stringify(jobs.chosenJobs)}`);
  }
  console.log("✅ Ganti pilihan saldo 400 ditolak — pilihan & saldo utuh");
  await roomA2.leave();
}
stopServer();
await wait(400);
editAccount(userA, (eco) => {
  eco.balance = 1000;
});
startServer();
await waitServerUp();
const roomA3 = await joinRoom("UjiPilih", tokenA);
{
  const change = await chooseJobs(roomA3, ["kebersihan", "taman"]);
  if (!change?.ok) fail(`Ganti pilihan yang sah harusnya diterima: ${JSON.stringify(change)}`);
  if (change.charged !== 500) fail(`Biaya ganti harusnya tepat 500, terbaca charged=${change.charged}`);
  if ((await balanceOf(tokenA)) !== 500) fail(`Saldo setelah ganti harusnya 500 (1000 − 500), terbaca ${await balanceOf(tokenA)}`);  const jobs = await getJobs(roomA3);
  if (!jobs.chosenJobs.includes("taman") || jobs.chosenJobs.includes("kurir")) {
    fail(`chosenJobs setelah ganti salah: ${JSON.stringify(jobs.chosenJobs)}`);
  }
  const oldJob = await startJob(roomA3, "kurir");
  if (!oldJob || oldJob.ok) fail("Pekerjaan lama (kurir) harusnya ditolak setelah ganti pilihan");
  console.log("✅ Ganti pilihan sah: TEPAT −500 KC terbakar (1000 → 500); kurir kini ditolak, taman pilihan baru");
}

// ================= FASE 3: cooldown menempel pada pekerjaan, bukan pilihan =================
{
  // Selesaikan kebersihan (pilihan A sekarang [kebersihan, taman]).
  const started = await startJob(roomA3, "kebersihan");
  if (!started?.ok) fail(`Mulai kebersihan fase 3 gagal: ${JSON.stringify(started)}`);
  const doneP = waitForEarned(roomA3, 180, 120000);
  for (const p of CLEANUP_POINTS) await driveTo(roomA3, p);
  const done = await doneP;
  if (!done) fail("Sif kebersihan fase 3 tidak selesai");
  // 500 + 180 gaji + 5 quest Kerja Keras (pertama hari ini untuk A) = 685.
  if ((await balanceOf(tokenA)) !== 685) fail(`Saldo setelah kebersihan harusnya 685, terbaca ${await balanceOf(tokenA)}`);
  let jobs = await getJobs(roomA3);
  const st = jobs.jobStats?.kebersihan;
  if (!st || st.done !== 1 || st.failed !== 0 || st.earned !== 180) {
    fail(`jobStats kebersihan salah: ${JSON.stringify(st)}`);
  }
  const cdBefore = jobs.jobs.find((j) => j.id === "kebersihan")?.cooldownRemainingMs ?? 0;
  if (!(cdBefore > 100 * 60000)) fail(`Cooldown kebersihan harusnya berjalan (±120 mnt), terbaca ${cdBefore}`);
  console.log("✅ Statistik tercatat: kebersihan done=1, earned=180 (gaji saja); cooldown berjalan");

  // Ganti pergi ke [taman, kurir] (−500 → 185), lalu fixture tambah saldo,
  // ganti kembali ke [kebersihan, taman] (−500). Cooldown TIDAK boleh reset.
  const away = await chooseJobs(roomA3, ["taman", "kurir"]);
  if (!away?.ok || away.charged !== 500) fail(`Ganti pergi gagal: ${JSON.stringify(away)}`);
  if ((await balanceOf(tokenA)) !== 185) fail(`Saldo setelah ganti pergi harusnya 185, terbaca ${await balanceOf(tokenA)}`);
  await roomA3.leave();
}
stopServer();
await wait(400);
editAccount(userA, (eco) => {
  eco.balance = 2000;
});
startServer();
await waitServerUp();
const roomA4 = await joinRoom("UjiPilih", tokenA);
{
  const back = await chooseJobs(roomA4, ["kebersihan", "taman"]);
  if (!back?.ok || back.charged !== 500) fail(`Ganti kembali gagal: ${JSON.stringify(back)}`);
  if ((await balanceOf(tokenA)) !== 1500) fail(`Saldo setelah ganti kembali harusnya 1500, terbaca ${await balanceOf(tokenA)}`);
  const jobs = await getJobs(roomA4);
  const cdAfter = jobs.jobs.find((j) => j.id === "kebersihan")?.cooldownRemainingMs ?? 0;
  if (!(cdAfter > 90 * 60000)) {
    fail(`Cooldown kebersihan RESET oleh ganti pilihan! Sisa terbaca ${(cdAfter / 60000).toFixed(1)} mnt`);
  }
  const cdStart = await startJob(roomA4, "kebersihan");
  if (!cdStart || cdStart.ok) fail("job_start kebersihan harusnya tetap ditolak cooldown setelah ganti-ganti pilihan");
  console.log(`✅ Cooldown menempel pada pekerjaan: setelah 2x ganti pilihan, cooldown kebersihan masih ${(cdAfter / 60000).toFixed(0)} mnt & start ditolak`);
  await roomA4.leave();
}

// ================= FASE 4: statistik selesai/gagal/batal + objective antar =================
const roomB = await joinRoom("UjiStat", tokenB);
{
  const choose = await chooseJobs(roomB, ["kurir", "kebersihan"]);
  if (!choose?.ok) fail(`Pilihan B gagal: ${JSON.stringify(choose)}`);
  const track = trackActives(roomB);

  // Objective kurir fase ambil = titik ambil Balai Kota (0, −27).
  const startK = await startJob(roomB, "kurir");
  if (!startK?.ok) fail(`Mulai kurir gagal: ${JSON.stringify(startK)}`);
  let jobs = await getJobs(roomB);
  let active = jobs.actives.find((a) => a.jobId === "kurir");
  if (!active?.objective) fail("Payload sif kurir tidak memuat objective");
  if (active.objective.x !== 0 || active.objective.z !== -27) {
    fail(`Objective ambil kurir harusnya (0, −27), terbaca (${active.objective.x}, ${active.objective.z})`);
  }
  if (!String(active.objective.label).startsWith("Ambil:")) {
    fail(`Label objective ambil salah: ${active.objective.label}`);
  }
  console.log("✅ Objective kurir (fase ambil): titik ambil Teras Balai Kota (0, −27)");

  // Ambil paket → objective berubah menjadi tujuan antar.
  const snap = await waitForActive(track, (a) => a.jobId === "kurir" && a.phase === "pickup");
  if (!snap) fail("Snapshot kurir fase ambil tidak datang");
  await driveTo(roomB, { x: snap.pickupX, z: snap.pickupZ });
  const delivering = await waitForActive(track, (a) => a.jobId === "kurir" && a.phase === "deliver");
  if (!delivering) fail("Fase antar kurir tidak pernah dimulai");
  jobs = await getJobs(roomB);
  active = jobs.actives.find((a) => a.jobId === "kurir");
  if (!active?.objective) fail("Payload sif kurir (antar) tidak memuat objective");
  if (active.objective.x !== delivering.targetX || active.objective.z !== delivering.targetZ) {
    fail(`Objective antar harusnya tujuan (${delivering.targetX}, ${delivering.targetZ}), terbaca (${active.objective.x}, ${active.objective.z})`);
  }
  if (!String(active.objective.label).startsWith("Antar:")) {
    fail(`Label objective antar salah: ${active.objective.label}`);
  }
  console.log(`✅ Objective kurir (fase antar): tujuan ${active.objective.label}`);

  // Biarkan kelewat waktu (batas antar kurir 150 detik) → GAGAL tercatat.
  const failedP = nextMessage(roomB, "job_failed", 180000);
  const failed = await failedP;
  if (!failed) fail("Pesan job_failed tidak datang setelah batas antar lewat");
  if (failed.jobId !== "kurir" || !String(failed.reason ?? "").includes("habis")) {
    fail(`Isi job_failed salah: ${JSON.stringify(failed)}`);
  }
  jobs = await getJobs(roomB);
  let st = jobs.jobStats?.kurir;
  if (!st || st.done !== 0 || st.failed !== 1 || st.earned !== 0) {
    fail(`jobStats kurir setelah gagal salah: ${JSON.stringify(st)}`);
  }
  console.log("✅ Antar kelewat waktu: job_failed diterima & statistik kurir failed=1");

  // Mulai lagi lalu BATALKAN → statistik tidak berubah sama sekali.
  const startK2 = await startJob(roomB, "kurir");
  if (!startK2?.ok) fail(`Mulai kurir kedua gagal (gagal antar tidak boleh ber-cooldown): ${JSON.stringify(startK2)}`);
  roomB.send("job_cancel", { jobId: "kurir" });
  await wait(500);
  jobs = await getJobs(roomB);
  st = jobs.jobStats?.kurir;
  if (!st || st.done !== 0 || st.failed !== 1 || st.earned !== 0) {
    fail(`Statistik berubah oleh sif yang DIBATALKAN: ${JSON.stringify(st)}`);
  }
  console.log("✅ Sif dibatalkan: statistik kurir tidak berubah (done=0, failed=1, earned=0)");

  // Selesaikan kebersihan → done=1, earned=180 (statistik B terpisah dari A).
  const startB = await startJob(roomB, "kebersihan");
  if (!startB?.ok) fail(`Mulai kebersihan B gagal: ${JSON.stringify(startB)}`);
  const doneP = waitForEarned(roomB, 180, 120000);
  for (const p of CLEANUP_POINTS) await driveTo(roomB, p);
  if (!(await doneP)) fail("Sif kebersihan B tidak selesai");
  jobs = await getJobs(roomB);
  st = jobs.jobStats?.kebersihan;
  if (!st || st.done !== 1 || st.failed !== 0 || st.earned !== 180) {
    fail(`jobStats kebersihan B salah: ${JSON.stringify(st)}`);
  }
  console.log("✅ Statistik B: kebersihan done=1, earned=180 — terpisah per akun");
  await roomB.leave();
}

// ================= FASE 5: objective titik kunjungan (kebersihan) =================
const roomC = await joinRoom("UjiArah", tokenC);
{
  const choose = await chooseJobs(roomC, ["kebersihan", "taman"]);
  if (!choose?.ok) fail(`Pilihan C gagal: ${JSON.stringify(choose)}`);
  const started = await startJob(roomC, "kebersihan");
  if (!started?.ok) fail(`Mulai kebersihan C gagal: ${JSON.stringify(started)}`);
  const jobs = await getJobs(roomC);
  const active = jobs.actives.find((a) => a.jobId === "kebersihan");
  if (!active?.objective) fail("Payload sif kebersihan tidak memuat objective");
  const isCleanupPoint = CLEANUP_POINTS.some((p) => p.x === active.objective.x && p.z === active.objective.z);
  if (!isCleanupPoint) {
    fail(`Objective kebersihan harusnya salah satu titik bersih-bersih, terbaca (${active.objective.x}, ${active.objective.z})`);
  }
  if (!String(active.objective.label).includes("Titik bersih-bersih")) {
    fail(`Label objective kebersihan salah: ${active.objective.label}`);
  }
  console.log(`✅ Objective kebersihan: ${active.objective.label} di (${active.objective.x}, ${active.objective.z}) — salah satu titik resmi`);
  roomC.send("job_cancel", { jobId: "kebersihan" });
  await wait(300);
  await roomC.leave();
}

stopServer();
console.log("🎉 SEMUA UJI TAHAP 10 LULUS — pilihan 2 pekerjaan (pertama gratis, ganti 500 KC terbakar), cooldown menempel pada pekerjaan, statistik per akun, objective sif, anti-tamu.");
process.exit(0);
