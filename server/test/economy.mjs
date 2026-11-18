// Uji Tahap 5: ekonomi Koin Kota (KC) end-to-end.
// Cara pakai: server harus sudah jalan (npm start), lalu: npm run test:economy
// Yang dibuktikan:
//  1. Akun baru mulai dengan saldo 500 KC (terbaca di /auth/me & payload jobs).
//  2. Klaim bonus harian: 500 -> 600; klaim kedua di hari yang sama ditolak.
//  3. Tamu ditolak untuk bonus_claim dan job_start.
//  4. Pekerjaan kebersihan diselesaikan dengan BERJALAN ke 5 titik (input gerak,
//     bukan teleport) -> gaji 180 KC dibayar TEPAT sekali (600 -> 780).
//  5. Mulai pekerjaan yang sama saat cooldown ditolak server.
//  6. Setelah putus & masuk lagi, saldo 780 tetap persisten.
import { Client } from "colyseus.js";

const HTTP = process.env.KOTA_HTTP || "http://localhost:2567";
const WS = process.env.KOTA_SERVER || "ws://localhost:2567";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = Date.now().toString(36);
const user = `uji_eko_${suffix}`;
const PASS = "rahasia123";

// Harus sama dengan CLEANUP_POINTS di server/src/economy/economy.ts.
const CLEANUP_POINTS = [
  { x: 10, z: 10 },
  { x: -10, z: 10 },
  { x: 10, z: -10 },
  { x: -10, z: -10 },
  { x: 0, z: 16 },
];

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

/** Tunggu satu pesan room bertipe tertentu (pola yang sama seperti uji lain). */
function nextMessage(room, type, timeoutMs = 6000) {
  const p = new Promise((r) => room.onMessage(type, r));
  return Promise.race([p, wait(timeoutMs).then(() => null)]);
}

/** Tunggu job_update yang menandakan sif SELESAI (membawa earned) — update kemajuan diabaikan. */
function waitForJobDone(room, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    room.onMessage("job_update", (data) => {
      if (data && typeof data.earned === "number") {
        clearTimeout(timer);
        resolve(data);
      }
    });
  });
}

/** Gerakkan pemain sendiri ke target murni lewat pesan input (lari). */
async function driveTo(room, target, timeoutMs = 40000) {
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

// 1. Daftar -> saldo awal 500 KC.
const reg = await api("/auth/register", { username: user, password: PASS });
if (reg.status !== 201 || !reg.data.token) fail(`Daftar gagal: ${reg.status} ${JSON.stringify(reg.data)}`);
const token = reg.data.token;
const me1 = await api("/auth/me", null, token);
if (me1.data.balance !== 500) fail(`Saldo awal harusnya 500 KC, terbaca ${me1.data.balance}`);
console.log("✅ Akun baru mulai dengan saldo 500 KC");

// Masuk room dengan token; payload jobs harus memuat saldo & bonus tersedia.
const client = new Client(WS);
const room = await client.joinOrCreate("kota", { name: "UjiEko", token });
const jobsPromise = nextMessage(room, "jobs");
room.send("jobs_get", {});
const jobs = await jobsPromise;
if (!jobs) fail("Server tidak menjawab jobs_get");
if (jobs.guest) fail("Payload jobs menandai akun sebagai tamu");
if (jobs.balance !== 500) fail(`Saldo di payload jobs = ${jobs.balance}, harusnya 500`);
if (!jobs.bonusAvailable) fail("Bonus harian harusnya tersedia untuk akun baru");
if (!Array.isArray(jobs.jobs) || jobs.jobs.length !== 3) fail("Daftar pekerjaan harusnya berisi 3 pekerjaan");
console.log("✅ Payload jobs: saldo 500 KC, bonus tersedia, 3 pekerjaan terdaftar");

// 2. Bonus harian: 500 -> 600, klaim kedua ditolak.
const bonus1Promise = nextMessage(room, "bonus_result");
room.send("bonus_claim", {});
const bonus1 = await bonus1Promise;
if (!bonus1?.ok || bonus1.balance !== 600) fail(`Klaim bonus pertama salah: ${JSON.stringify(bonus1)}`);
const bonus2Promise = nextMessage(room, "bonus_result");
room.send("bonus_claim", {});
const bonus2 = await bonus2Promise;
if (!bonus2 || bonus2.ok) fail("Klaim bonus kedua di hari yang sama harusnya ditolak");
const me2 = await api("/auth/me", null, token);
if (me2.data.balance !== 600) fail(`Saldo setelah bonus harusnya 600, terbaca ${me2.data.balance}`);
console.log("✅ Bonus harian +100 KC (500 → 600); klaim kedua di hari yang sama ditolak");

// 3. Tamu ditolak bonus & pekerjaan.
const guestClient = new Client(WS);
const guestRoom = await guestClient.joinOrCreate("kota", { name: "TamuUji" });
await wait(400);
const guestBonusPromise = nextMessage(guestRoom, "bonus_result");
guestRoom.send("bonus_claim", {});
const guestBonus = await guestBonusPromise;
if (!guestBonus || guestBonus.ok) fail("Tamu harusnya ditolak saat klaim bonus");
const guestJobPromise = nextMessage(guestRoom, "job_result");
guestRoom.send("job_start", { jobId: "kebersihan" });
const guestJob = await guestJobPromise;
if (!guestJob || guestJob.ok) fail("Tamu harusnya ditolak saat job_start");
await guestRoom.leave();
console.log("✅ Tamu ditolak untuk bonus_claim dan job_start");

// 4. Selesaikan pekerjaan kebersihan dengan berjalan ke 5 titik.
const startPromise = nextMessage(room, "job_result");
room.send("job_start", { jobId: "kebersihan" });
const started = await startPromise;
if (!started?.ok) fail(`job_start kebersihan ditolak: ${JSON.stringify(started)}`);
console.log("✅ Sif kebersihan dimulai — berjalan ke 5 titik bersih-bersih…");
const donePromise = waitForJobDone(room, 90000);
for (const point of CLEANUP_POINTS) {
  await driveTo(room, point);
}
const done = await donePromise;
if (!done || done.earned !== 180) fail(`Penyelesaian sif salah: ${JSON.stringify(done)}`);
const me3 = await api("/auth/me", null, token);
if (me3.data.balance !== 780) fail(`Saldo setelah gaji harusnya 780, terbaca ${me3.data.balance}`);
console.log("✅ 5 titik dikunjungi — gaji 180 KC dibayar (600 → 780)");

// Dibayar tepat sekali: tunggu sebentar, saldo tidak boleh berubah lagi.
await wait(2000);
const me4 = await api("/auth/me", null, token);
if (me4.data.balance !== 780) fail(`Saldo berubah lagi setelah sif selesai (${me4.data.balance}) — gaji dobel?`);
console.log("✅ Gaji dibayar tepat sekali (saldo stabil di 780 KC)");

// 5. Cooldown: mulai pekerjaan yang sama lagi harus ditolak.
const cdPromise = nextMessage(room, "job_result");
room.send("job_start", { jobId: "kebersihan" });
const cd = await cdPromise;
if (!cd || cd.ok) fail("job_start saat cooldown harusnya ditolak");
console.log("✅ job_start saat cooldown (10 menit) ditolak server");

// 6. Putus, masuk lagi — saldo persisten.
await room.leave();
const login = await api("/auth/login", { username: user, password: PASS });
if (!login.data.token) fail("Login ulang gagal");
const me5 = await api("/auth/me", null, login.data.token);
if (me5.data.balance !== 780) fail(`Saldo setelah login ulang harusnya 780, terbaca ${me5.data.balance}`);
const client2 = new Client(WS);
const room2 = await client2.joinOrCreate("kota", { name: "UjiEko", token: login.data.token });
const jobs2Promise = nextMessage(room2, "jobs");
room2.send("jobs_get", {});
const jobs2 = await jobs2Promise;
if (!jobs2 || jobs2.balance !== 780) fail(`Saldo di sesi baru = ${jobs2?.balance}, harusnya 780`);
if (jobs2.bonusAvailable) fail("Bonus harusnya sudah tidak tersedia (sudah diklaim hari ini)");
await room2.leave();
console.log("✅ Saldo 780 KC persisten setelah keluar & masuk lagi; status bonus ikut tersimpan");

console.log("🎉 SEMUA UJI TAHAP 5 LULUS — ekonomi KC: saldo awal, bonus harian, gaji pekerjaan, cooldown, anti-tamu, persistensi.");
process.exit(0);
