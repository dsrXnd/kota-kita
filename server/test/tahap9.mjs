// Uji Tahap 9: Ekspansi & Komunitas (Pantai, Teras Atas Balai Kota,
// Event Komunitas, Quest Sosial Harian, Kosmetik Musiman) end-to-end.
// Uji ini MENGELOLA SERVER SENDIRI (port 2581 + folder data sementara +
// konfigurasi KOTA_EVENT_MINUTES & KOTA_SEASON_DATE) — tanpa backdoor:
// keadaan diatur lewat berkas data sementara saat server mati & API publik.
//
// Hadiah quest memakai angka KEPUTUSAN USER (koreksi 18 Nov 2026):
// Jelajah Kota 25 KC, Sapa Warga 10 KC, Kerja Keras 5 KC.
//
// Yang dibuktikan:
//  1. Musim HUT RI (KOTA_SEASON_DATE=2026-08-17): season terekspos di
//     state & /season; simpan profil "merahputih" persisten.
//  2. Ketinggian: pemain tanah berjalan DI BAWAH dek tanpa tertahan
//     pagar; naik ramp ke dek y≈3; klien kedua melihat y itu; pagar
//     menahan di atas dek; turun ramp kembali y≈0; melangkah keluar
//     ramp di tengah = jatuh ke tanah.
//  3. Pantai: berjalan ke pasir (-62,0) di y≈0; tertahan di garis
//     pantai (tidak bisa masuk air x <= -80).
//  4. Quest Jelajah: 3 zona berbeda (plaza, balai, pantai) membayar
//     TEPAT +25 KC sekali; zona ke-4 tidak membayar lagi; ledger memuat
//     mutasi quest 25/10/5 KC.
//  5. Event: dengan siklus 1 menit, event aktif di state; akun di zona
//     tercatat sebagai peserta; tamu di zona TIDAK dihitung; Kabar Kota
//     merangkum "dihadiri 1 warga".
//  6. Quest Kerja Keras: menyelesaikan sif kebersihan membayar gaji
//     180 + quest 5 KC. Quest Sapa Warga: wave ke tamu = 0; wave ke
//     akun yang sama berulang = 1; wave ke 5 akun berbeda = +10 KC.
//     Tamu tidak punya kemajuan quest.
//  7. Reset harian: kunci hari quest diganti lewat berkas sementara →
//     kemajuan nol lagi & quest bisa dibayar lagi (+25 KC kedua).
//  8. Musim di luar jendela (2026-09-01): tidak ada season terekspos;
//     simpan "merahputih" disanitasi ke "polos". Ramadan pendekatan
//     (2026-02-20): season "koko" aktif & bisa disimpan.
import { Client } from "colyseus.js";
import { spawn } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 2581;
const HTTP = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), "kota-tahap9-"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = Date.now().toString(36);
const PASS = "rahasia123";
const users = ["a", "b", "c", "d", "e", "f"].map((c) => `w${c}${suffix}`);

// Titik bersih-bersih — sama dengan CLEANUP_POINTS server.
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
function startServer(seasonDate) {
  serverProc = spawn("node", ["dist/index.js"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      KOTA_DATA_DIR: DATA_DIR,
      KOTA_EVENT_MINUTES: "1",
      KOTA_SEASON_DATE: seasonDate,
    },
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
async function restartServer(seasonDate) {
  stopServer();
  await wait(400);
  startServer(seasonDate);
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

async function getJobs(room) {
  const p = nextMessage(room, "jobs");
  room.send("jobs_get", {});
  const payload = await p;
  if (!payload) fail("Tidak menerima payload jobs");
  return payload;
}

async function getCity(room) {
  const p = nextMessage(room, "city");
  room.send("city_get", {});
  const payload = await p;
  if (!payload) fail("Tidak menerima payload city");
  return payload;
}

async function balanceOf(token) {
  const me = await api("/auth/me", null, token);
  if (typeof me.data.balance !== "number") fail("Saldo tidak terbaca dari /auth/me");
  return me.data.balance;
}

function questOf(jobsPayload, id) {
  return (jobsPayload.quests ?? []).find((q) => q.id === id);
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

/** Dorong pemain ke satu arah selama ms sambil mencicipi y; kembalikan {start, end, maxY}. */
async function pushToward(room, input, ms) {
  const me = room.state.players.get(room.sessionId);
  const start = { x: me.x, z: me.z, y: me.y };
  let maxY = me.y;
  const timer = setInterval(() => {
    room.send("input", { ...input, sprint: true, jump: false });
    if (me.y > maxY) maxY = me.y;
  }, 66);
  await wait(ms);
  clearInterval(timer);
  room.send("input", { x: 0, z: 0, sprint: false, jump: false });
  await wait(400);
  return { start, end: { x: me.x, z: me.z, y: me.y }, maxY };
}

async function waitFor(condFn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condFn()) return;
    await wait(1200);
  }
  fail("Timeout menunggu: " + label);
}

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

// ---------- Fase 1: server musim HUT RI; daftar 6 akun ----------
startServer("2026-08-17");
await waitServerUp();

const tokens = {};
for (const u of users) {
  const reg = await api("/auth/register", { username: u, password: PASS });
  if (reg.status !== 201 || !reg.data.token) fail(`Daftar ${u} gagal: ${reg.status}`);
  tokens[u] = reg.data.token;
}
const [userA, userB] = users;
const tokenA = tokens[userA];
const tokenB = tokens[userB];
console.log("✅ 6 akun uji terdaftar di server musim HUT RI (2026-08-17)");

// Musim terekspos lewat endpoint publik /season.
const seasonRes = await api("/season", null);
if (seasonRes.data?.season?.style !== "merahputih") {
  fail(`/season harusnya merahputih, terbaca ${JSON.stringify(seasonRes.data)}`);
}
if (!String(seasonRes.data.season.label).includes("HUT RI")) fail("Label musim harusnya HUT RI");
console.log("✅ /season: musim aktif merahputih (HUT RI)");

// Simpan profil "merahputih" saat jendela aktif → persisten.
const saveMp = await api("/auth/profile", { profile: { shirtStyle: "merahputih" } }, tokenA);
if (saveMp.data?.profile?.shirtStyle !== "merahputih") {
  fail(`Simpan merahputih di dalam jendela harusnya diterima, terbaca ${saveMp.data?.profile?.shirtStyle}`);
}
const meA1 = await api("/auth/me", null, tokenA);
if (meA1.data?.profile?.shirtStyle !== "merahputih") fail("Profil merahputih A tidak persisten di /auth/me");
console.log("✅ Profil A: baju merahputih tersimpan & persisten selama jendela HUT RI");

// ---------- Fase 2: ketinggian Teras Atas + Pantai ----------
const clientA = new Client(WS);
const roomA = await clientA.joinOrCreate("kota", { name: "WargaA", token: tokenA });
await wait(400);
if (roomA.state.seasonStyle !== "merahputih") {
  fail(`State room seasonStyle harusnya merahputih, terbaca "${roomA.state.seasonStyle}"`);
}
const clientB = new Client(WS);
const roomB = await clientB.joinOrCreate("kota", { name: "WargaB", token: tokenB });
await wait(400);
// B parkir jauh dari zona event & quest A.
await driveTo(roomB, { x: 30, z: 30 });

const meA = () => roomA.state.players.get(roomA.sessionId);

// (a) Pemain tanah berjalan DI BAWAH dek: pagar dek tidak boleh menahan.
await driveTo(roomA, { x: -12, z: -26 });
const under = await pushToward(roomA, { x: 1, z: 0 }, 4200);
if (under.end.x < 10) fail(`Pemain tanah harusnya bisa melintas di bawah dek sampai x>10, berhenti di x=${under.end.x.toFixed(1)}`);
if (under.maxY > 0.5) fail(`Pemain tanah di bawah dek harusnya tetap y≈0, maxY=${under.maxY.toFixed(2)}`);
console.log("✅ Di bawah dek: pemain tanah melintas bebas (pagar tergating tidak menahan), y tetap ≈ 0");

// (b) Naik ramp ke dek: y mencapai ≈ 3 dan terlihat oleh klien kedua.
await driveTo(roomA, { x: 0, z: -14 });
await driveTo(roomA, { x: 0, z: -26 });
if (Math.abs(meA().y - 3) > 0.35) fail(`Di atas dek y harusnya ≈3, terbaca ${meA().y.toFixed(2)}`);
const seenByB = roomB.state.players.get(roomA.sessionId);
if (!seenByB || seenByB.y < 2.6) fail(`Klien kedua harusnya melihat A di ketinggian dek, terbaca y=${seenByB?.y}`);
console.log("✅ Ramp tangga: A naik ke dek (y ≈ 3) dan klien kedua melihat ketinggian yang sama di state");

// (c) Pagar dek menahan pemain yang berjalan menyamping di atas dek.
const rail = await pushToward(roomA, { x: -1, z: 0 }, 3000);
if (rail.end.x <= -6.6) fail(`Pagar barat dek harusnya menahan A (x > -6.6), terbaca x=${rail.end.x.toFixed(2)}`);
if (rail.end.y < 2.6) fail(`A harusnya tetap di atas dek saat tertahan pagar, y=${rail.end.y.toFixed(2)}`);
console.log("✅ Pagar dek menahan A di atas dek (tidak jatuh / tidak menembus)");

// (d) Turun ramp kembali ke tanah.
await driveTo(roomA, { x: 0, z: -26 });
await driveTo(roomA, { x: 0, z: -14 });
if (meA().y > 0.35 || meA().y < -0.05) fail(`Setelah turun ramp y harusnya ≈0, terbaca ${meA().y.toFixed(2)}`);
console.log("✅ Turun ramp: y kembali ≈ 0");

// (e) Melangkah keluar sisi ramp di tengah ketinggian = jatuh ke tanah.
await driveTo(roomA, { x: 0, z: -20.5 }, 60000, 0.3);
if (meA().y < 1.1 || meA().y > 1.9) fail(`Di tengah ramp y harusnya ≈1.5, terbaca ${meA().y.toFixed(2)}`);
const fell = await pushToward(roomA, { x: 1, z: 0 }, 2500);
if (fell.end.y > 0.4) fail(`Keluar sisi ramp harusnya JATUH ke tanah, y akhir=${fell.end.y.toFixed(2)}`);
if (fell.end.x < 3) fail(`A harusnya terus bergerak ke timur setelah jatuh, x=${fell.end.x.toFixed(1)}`);
console.log("✅ Keluar sisi ramp di y≈1.5: A jatuh oleh gravitasi ke tanah (tidak melayang)");

// (f) Zona plaza tercatat untuk quest (berhenti sebentar di dalam zona),
// lalu Pantai: pasir bisa dijelajahi & air menahan di garis pantai.
await driveTo(roomA, { x: 6, z: 0 });
await wait(1600); // beri tick kota mencicipi zona plaza
await driveTo(roomA, { x: -20, z: 0 });
await driveTo(roomA, { x: -40, z: 0 });
await driveTo(roomA, { x: -62, z: 0 });
if (Math.abs(meA().y) > 0.35) fail(`Di pasir pantai y harusnya ≈0, terbaca ${meA().y.toFixed(2)}`);
const shore = await pushToward(roomA, { x: -1, z: 0 }, 4000);
if (shore.end.x <= -80.3) fail(`A harusnya tertahan SEBELUM air (x > -80.3), terbaca x=${shore.end.x.toFixed(2)}`);
if (shore.end.x >= -75) fail(`A harusnya mencapai garis pantai (x ≈ -79.65), terbaca x=${shore.end.x.toFixed(2)}`);
console.log("✅ Pantai: pasir dijelajahi sampai garis pantai; air menahan A di x ≈ -79.65 (tidak bisa berenang masuk)");

// ---------- Fase 3: Quest Jelajah selesai dari 3 zona (plaza, balai, pantai) ----------
await wait(1600); // tick kota mencicipi zona pantai
let jobs = await getJobs(roomA);
let jelajah = questOf(jobs, "jelajah");
if (!jelajah?.done || jelajah.progress !== 3) {
  fail(`Quest Jelajah harusnya selesai (3/3) setelah plaza+balai+pantai, terbaca ${JSON.stringify(jelajah)}`);
}
if (jelajah.reward !== 25) fail(`Hadiah Jelajah harusnya 25 KC (keputusan user), terbaca ${jelajah.reward}`);
let bal = await balanceOf(tokenA);
if (bal !== 525) fail(`Saldo A harusnya 525 (500 + 25 quest Jelajah), terbaca ${bal}`);
console.log("✅ Quest Jelajah Kota: 3 zona berbeda membayar TEPAT +25 KC (saldo 500 → 525)");

// Zona ke-4 (pasar) tidak membayar apa-apa lagi.
await driveTo(roomA, { x: -40, z: 0 });
await driveTo(roomA, { x: 0, z: 6 });
await driveTo(roomA, { x: 0, z: 52 });
await wait(1600);
bal = await balanceOf(tokenA);
if (bal !== 525) fail(`Zona ke-4 tidak boleh membayar lagi, saldo terbaca ${bal}`);
console.log("✅ Zona ke-4 (Pasar) tercatat tapi tidak membayar ulang — hadiah quest sekali sehari");

// ---------- Fase 4: Event komunitas (akun tercatat, tamu tidak) ----------
const clientG = new Client(WS);
const roomG = await clientG.joinOrCreate("kota", { name: "TamuUji" });
await wait(400);
await driveTo(roomA, { x: 4, z: 4 });
await driveTo(roomG, { x: 5, z: 3 });
await waitFor(() => roomA.state.eventType !== "", 75000, "event komunitas aktif di state");
const evType = roomA.state.eventType;
if (!["foto", "parade"].includes(evType)) fail(`Tipe event tidak dikenal: ${evType}`);
if (!(roomA.state.eventEndsAt > Date.now())) fail("eventEndsAt harusnya di masa depan selama event aktif");
console.log(`✅ Event aktif di state: "${roomA.state.eventName}" (berakhir ${new Date(roomA.state.eventEndsAt).toISOString()})`);

// Tunggu ringkasan kehadiran di Kabar Kota: tepat 1 warga (A) — tamu tidak dihitung.
let summaryFound = false;
for (let i = 0; i < 75 && !summaryFound; i++) {
  const city = await getCity(roomA);
  summaryFound = city.news.some((e) => e.text.includes("dihadiri 1 warga"));
  if (!summaryFound) await wait(2000);
}
if (!summaryFound) fail("Kabar Kota tidak memuat ringkasan 'dihadiri 1 warga' setelah event berakhir");
console.log("✅ Event selesai: Kabar Kota merangkum 'dihadiri 1 warga' — akun di zona tercatat, tamu TIDAK dihitung");

// ---------- Fase 5: Quest Kerja Keras (+5) & Sapa Warga (+10) ----------
// Kerja Keras: selesaikan sif kebersihan (gaji 180) → quest +5 KC.
const jobStartP = nextMessage(roomA, "job_result");
roomA.send("job_start", { jobId: "kebersihan" });
const jobStart = await jobStartP;
if (!jobStart?.ok) fail(`Mulai sif kebersihan ditolak: ${JSON.stringify(jobStart)}`);
const doneP = waitForJobDone(roomA);
for (const p of CLEANUP_POINTS) await driveTo(roomA, p);
const done = await doneP;
if (!done || done.earned !== 180) fail(`Sif kebersihan harusnya membayar 180, terbaca ${JSON.stringify(done)}`);
await wait(600);
bal = await balanceOf(tokenA);
if (bal !== 710) fail(`Saldo A harusnya 710 (525 + 180 gaji + 5 quest Kerja), terbaca ${bal}`);
jobs = await getJobs(roomA);
if (!questOf(jobs, "kerja")?.done) fail("Quest Kerja Keras harusnya selesai setelah sif tuntas");
if (questOf(jobs, "kerja").reward !== 5) fail("Hadiah Kerja Keras harusnya 5 KC (keputusan user)");
console.log("✅ Quest Kerja Keras: sif selesai membayar gaji 180 + quest TEPAT +5 KC (saldo → 710)");

// Sapa Warga: wave ke tamu tidak dihitung; wave berulang ke akun sama = 1;
// melengkapi 5 akun berbeda membayar +10 KC.
await driveTo(roomG, { x: 2, z: 17 });
roomA.send("emote", { emote: "wave" });
await wait(1300);
jobs = await getJobs(roomA);
if (questOf(jobs, "sapa").progress !== 0) {
  fail(`Wave ke tamu tidak boleh dihitung, kemajuan sapa = ${questOf(jobs, "sapa").progress}`);
}
await driveTo(roomB, { x: -2, z: 17 });
roomA.send("emote", { emote: "wave" });
await wait(1300);
jobs = await getJobs(roomA);
if (questOf(jobs, "sapa").progress !== 1) {
  fail(`Wave pertama ke B harusnya kemajuan 1, terbaca ${questOf(jobs, "sapa").progress}`);
}
roomA.send("emote", { emote: "wave" });
await wait(1300);
jobs = await getJobs(roomA);
if (questOf(jobs, "sapa").progress !== 1) {
  fail(`Wave berulang ke akun yang sama tidak boleh menambah, terbaca ${questOf(jobs, "sapa").progress}`);
}
console.log("✅ Sapa Warga: tamu tidak dihitung; akun yang sama di-wave berulang tetap dihitung 1x");

const clusterSpots = [
  { x: 2, z: 19 },
  { x: -2, z: 19 },
  { x: 4, z: 16 },
  { x: -4, z: 16 },
];
for (let i = 2; i < users.length; i++) {
  const c = new Client(WS);
  const room = await c.joinOrCreate("kota", { name: `Warga${users[i][1].toUpperCase()}`, token: tokens[users[i]] });
  await wait(300);
  await driveTo(room, clusterSpots[i - 2]);
}
roomA.send("emote", { emote: "wave" });
await wait(1500);
jobs = await getJobs(roomA);
const sapa = questOf(jobs, "sapa");
if (!sapa?.done || sapa.progress !== 5) fail(`Quest Sapa harusnya selesai (5/5), terbaca ${JSON.stringify(sapa)}`);
if (sapa.reward !== 10) fail(`Hadiah Sapa Warga harusnya 10 KC (keputusan user), terbaca ${sapa.reward}`);
bal = await balanceOf(tokenA);
if (bal !== 720) fail(`Saldo A harusnya 720 (710 + 10 quest Sapa), terbaca ${bal}`);
console.log("✅ Quest Sapa Warga: 5 akun berbeda dalam satu wave membayar TEPAT +10 KC (saldo → 720)");

// Ledger memuat ketiga mutasi quest dengan angka keputusan user.
const dbFile = join(DATA_DIR, "accounts.json");
const dbNow = JSON.parse(readFileSync(dbFile, "utf8"));
const ledgerA = dbNow.users[userA.toLowerCase()].economy.ledger;
for (const [delta, reason] of [[25, "Jelajah Kota"], [10, "Sapa Warga"], [5, "Kerja Keras"]]) {
  if (!ledgerA.some((e) => e.delta === delta && e.reason.includes(reason))) {
    fail(`Ledger A tidak memuat mutasi quest +${delta} KC (${reason})`);
  }
}
console.log("✅ Ledger A memuat mutasi quest +25 (Jelajah), +10 (Sapa), +5 (Kerja) — angka keputusan user");

// Tamu tidak punya kemajuan quest.
const jobsG = await getJobs(roomG);
if (!jobsG.guest) fail("Payload jobs tamu harusnya guest=true");
if (!Array.isArray(jobsG.quests) || jobsG.quests.length !== 0) {
  fail(`Tamu tidak boleh punya quest, terbaca ${JSON.stringify(jobsG.quests)}`);
}
console.log("✅ Tamu: payload jobs tanpa quest apa pun");

// ---------- Fase 6: reset harian quest (kunci hari diganti di berkas) ----------
stopServer();
await wait(400);
const db = JSON.parse(readFileSync(dbFile, "utf8"));
db.users[userA.toLowerCase()].economy.quests.day = "2000-01-01";
writeFileSync(dbFile, JSON.stringify(db, null, 1));
startServer("2026-08-17");
await waitServerUp();

const clientA2 = new Client(WS);
const roomA2 = await clientA2.joinOrCreate("kota", { name: "WargaA", token: tokenA });
await wait(400);
let jobs2 = await getJobs(roomA2);
for (const q of jobs2.quests) {
  if (q.progress !== 0 || q.done) fail(`Setelah ganti hari, quest ${q.id} harusnya nol, terbaca ${JSON.stringify(q)}`);
}
console.log("✅ Hari baru: semua kemajuan quest A kembali nol");

await driveTo(roomA2, { x: 6, z: 0 });
await wait(1400);
await driveTo(roomA2, { x: 0, z: -24 });
await wait(1400);
await driveTo(roomA2, { x: 0, z: 6 });
await driveTo(roomA2, { x: 44, z: 0 });
await driveTo(roomA2, { x: 90, z: 0 }, 90000);
await wait(1600);
bal = await balanceOf(tokenA);
if (bal !== 745) fail(`Quest Jelajah hari baru harusnya membayar lagi +25 (saldo 745), terbaca ${bal}`);
jobs2 = await getJobs(roomA2);
if (!questOf(jobs2, "jelajah")?.done) fail("Quest Jelajah hari baru harusnya selesai lagi");
console.log("✅ Quest dapat dibayar lagi di hari baru: Jelajah +25 KC kedua (saldo → 745)");

// ---------- Fase 7: musim di luar jendela & Ramadan pendekatan ----------
await restartServer("2026-09-01");
const seasonOff = await api("/season", null);
if (seasonOff.data?.season !== null) fail(`/season di luar jendela harusnya null, terbaca ${JSON.stringify(seasonOff.data)}`);
const clientA3 = new Client(WS);
const roomA3 = await clientA3.joinOrCreate("kota", { name: "WargaA", token: tokenA });
await wait(400);
if (roomA3.state.seasonStyle !== "") fail(`State seasonStyle di luar jendela harusnya kosong, terbaca "${roomA3.state.seasonStyle}"`);
const saveOff = await api("/auth/profile", { profile: { shirtStyle: "merahputih" } }, tokenA);
if (saveOff.data?.profile?.shirtStyle !== "polos") {
  fail(`Simpan merahputih di luar jendela harusnya disanitasi ke polos, terbaca ${saveOff.data?.profile?.shirtStyle}`);
}
console.log("✅ Di luar jendela: tidak ada season terekspos & simpan merahputih disanitasi ke 'polos'");

await restartServer("2026-02-20");
const seasonKoko = await api("/season", null);
if (seasonKoko.data?.season?.style !== "koko") {
  fail(`/season 2026-02-20 harusnya koko (Ramadan pendekatan), terbaca ${JSON.stringify(seasonKoko.data)}`);
}
const saveKoko = await api("/auth/profile", { profile: { shirtStyle: "koko" } }, tokenA);
if (saveKoko.data?.profile?.shirtStyle !== "koko") {
  fail(`Simpan koko saat Ramadan harusnya diterima, terbaca ${saveKoko.data?.profile?.shirtStyle}`);
}
console.log("✅ Ramadan pendekatan 2026 (18 Feb–20 Mar): season koko aktif & baju koko bisa disimpan");

stopServer();
console.log("🎉 SEMUA UJI TAHAP 9 LULUS: Pantai, Teras Atas, event, quest 25/10/5 KC, reset harian, kosmetik musiman.");
process.exit(0);
