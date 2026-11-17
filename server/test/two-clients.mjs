// Uji multiplayer otomatis dengan DUA klien (syarat fondasi multiplayer).
// Cara pakai: server harus sudah jalan (npm start), lalu: npm run test:2clients
// Yang dibuktikan:
//  1. Dua klien bisa masuk room "kota" yang sama.
//  2. Klien B melihat Klien A di state.
//  3. Saat A mengirim input jalan, posisi A berubah DI MATA B (sinkronisasi bekerja).
//  4. Chat dari A diterima B lewat server.
import { Client } from "colyseus.js";

const ENDPOINT = process.env.KOTA_SERVER || "ws://localhost:2567";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error("❌ GAGAL:", msg);
  process.exit(1);
}

const clientA = new Client(ENDPOINT);
const clientB = new Client(ENDPOINT);

const roomA = await clientA.joinOrCreate("kota", { name: "PengujiA", shirt: "#2e8c83" });
const roomB = await clientB.joinOrCreate("kota", { name: "PengujiB", shirt: "#e3b23c" });
console.log("✅ Kedua klien masuk room:", roomA.roomId);

await wait(600);
const playersInB = roomB.state.players.size;
if (playersInB < 2) fail(`Klien B hanya melihat ${playersInB} pemain, harusnya >= 2`);
console.log("✅ Klien B melihat", playersInB, "pemain (termasuk A)");

const aInB = roomB.state.players.get(roomA.sessionId);
if (!aInB) fail("Klien A tidak ditemukan di state Klien B");
const startPos = { x: aInB.x, z: aInB.z };

// A jalan ke utara (z negatif) selama ±1 detik lewat input — bukan teleport.
const inputTimer = setInterval(() => roomA.send("input", { x: 0, z: -1, sprint: false, jump: false }), 66);
await wait(1100);
clearInterval(inputTimer);
roomA.send("input", { x: 0, z: 0, sprint: false, jump: false });
await wait(400);

const endPos = { x: aInB.x, z: aInB.z };
const moved = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);
if (moved < 1) fail(`Posisi A di mata B hanya bergerak ${moved.toFixed(2)} m (harusnya > 1 m)`);
console.log(`✅ Posisi A bergerak ${moved.toFixed(2)} m di mata B — sinkronisasi gerak bekerja`);

// Chat: B menunggu pesan dari A.
const chatPromise = new Promise((resolve) => roomB.onMessage("chat", resolve));
roomA.send("chat", { text: "Halo dari Penguji A!" });
const chat = await Promise.race([chatPromise, wait(3000).then(() => null)]);
if (!chat || chat.text !== "Halo dari Penguji A!") fail("Chat dari A tidak diterima B");
console.log("✅ Chat A diterima B:", JSON.stringify(chat.text));

// --- Uji Tahap 2a: emote pack tersinkron ---
roomA.send("emote", { emote: "dance" });
await wait(500);
if (aInB.anim !== "dance") fail(`Emote A di mata B = "${aInB.anim}", harusnya "dance"`);
console.log("✅ Emote 'dance' A terlihat di mata B — emote pack tersinkron");
await wait(4000); // tunggu emote selesai (4 detik)

// --- Uji Tahap 2b: tabrakan bangunan (AABB) ---
// A lari ke ruko selatan "TOKO BATIK" di (22, 31) — tidak boleh menembus kotak [17..27]x[27..35].
const fromPos = { x: aInB.x, z: aInB.z };
const target = { x: 22, z: 31 };
const dirX = target.x - fromPos.x;
const dirZ = target.z - fromPos.z;
const len = Math.hypot(dirX, dirZ);
const runTimer = setInterval(
  () => roomA.send("input", { x: dirX / len, z: dirZ / len, sprint: true, jump: false }),
  66
);
await wait(6000);
clearInterval(runTimer);
roomA.send("input", { x: 0, z: 0, sprint: false, jump: false });
await wait(400);
const finalPos = { x: aInB.x, z: aInB.z };
const travelled = Math.hypot(finalPos.x - fromPos.x, finalPos.z - fromPos.z);
const insideShop = finalPos.x > 17 && finalPos.x < 27 && finalPos.z > 27 && finalPos.z < 35;
if (travelled < 8) fail(`A hanya bergerak ${travelled.toFixed(1)} m menuju ruko (harusnya > 8 m)`);
if (insideShop) fail(`A menembus ruko! Posisi akhir (${finalPos.x.toFixed(1)}, ${finalPos.z.toFixed(1)}) ada di dalam kotak bangunan`);
console.log(
  `✅ Tabrakan bangunan bekerja — A berlari ${travelled.toFixed(1)} m dan berhenti di luar ruko (${finalPos.x.toFixed(1)}, ${finalPos.z.toFixed(1)})`
);

await roomA.leave();
await roomB.leave();
console.log("🎉 SEMUA UJI LULUS — fondasi multiplayer KOTA KITA bekerja dengan 2 klien.");
process.exit(0);
