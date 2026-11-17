// Uji beban: 50 klien dalam SATU room (batas maksimum room prototype).
// Cara pakai: server harus sudah jalan, lalu: npm run test:load
// Yang dibuktikan:
//  1. 50 klien bisa masuk room yang sama (atau terbagi rapi — dilaporkan apa adanya).
//  2. Selama 5 detik semua bergerak; sinkronisasi tetap mengalir di bawah beban.
//  3. Server tetap menjawab /health dengan cepat setelah beban.
import { Client } from "colyseus.js";

const WS = process.env.KOTA_SERVER || "ws://localhost:2567";
const HTTP = process.env.KOTA_HTTP || "http://localhost:2567";
const N = 50;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error("❌ GAGAL:", msg);
  process.exit(1);
}

const clients = [];
const rooms = [];
const joinStart = Date.now();
for (let i = 0; i < N; i++) {
  const c = new Client(WS);
  const room = await c.joinOrCreate("kota", { name: `Beban${i}` });
  clients.push(c);
  rooms.push(room);
  if (i % 10 === 9) console.log(`   …${i + 1}/${N} klien masuk (${Date.now() - joinStart} ms)`);
}
const joinMs = Date.now() - joinStart;
console.log(`✅ ${N} klien masuk dalam ${joinMs} ms (rata-rata ${(joinMs / N).toFixed(0)} ms/klien)`);

await wait(800);
const viewSizes = rooms.map((r) => r.state.players.size);
const mainRoomSize = Math.max(...viewSizes);
console.log(`ℹ️  Ukuran room terbesar yang terlihat klien: ${mainRoomSize} pemain`);
if (mainRoomSize < 40) fail(`Room utama hanya berisi ${mainRoomSize} pemain — pembagian room tidak sehat`);

// Semua bergerak acak selama 5 detik.
const timers = rooms.map((room, i) =>
  setInterval(() => {
    const a = (i * 1.7 + Date.now() / 900) % (Math.PI * 2);
    room.send("input", { x: Math.cos(a), z: Math.sin(a), sprint: i % 3 === 0, jump: false });
  }, 200)
);
const watcher = rooms[0];
const sampleId = rooms[10].sessionId;
const before = watcher.state.players.get(sampleId);
if (!before) fail("Pemain contoh tidak terlihat oleh klien pengamat");
const startPos = { x: before.x, z: before.z };
await wait(5000);
timers.forEach(clearInterval);
rooms.forEach((r) => r.send("input", { x: 0, z: 0, sprint: false, jump: false }));
const after = watcher.state.players.get(sampleId);
const moved = Math.hypot(after.x - startPos.x, after.z - startPos.z);
if (moved < 0.5) fail(`Posisi pemain contoh hanya bergerak ${moved.toFixed(2)} m di bawah beban`);
console.log(`✅ Sinkronisasi tetap mengalir di bawah beban — pemain contoh bergerak ${moved.toFixed(1)} m dalam 5 detik`);

const healthStart = Date.now();
const health = await fetch(HTTP + "/health").then((r) => r.json());
if (!health.ok) fail("Server tidak sehat setelah uji beban");
console.log(`✅ Server tetap sehat setelah beban (/health menjawab dalam ${Date.now() - healthStart} ms)`);

for (const room of rooms) await room.leave();
console.log(`🎉 UJI BEBAN LULUS — ${N} klien serentak terlayani.`);
process.exit(0);
