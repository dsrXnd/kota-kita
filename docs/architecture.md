# Arsitektur Teknis — KOTA KITA

Versi: 0.1 (Prototype) · Pasangan: `game-design.md`

## 1. Gambaran Besar

```
[HP/PC pemain] --HTTPS--> [Cloudflare Pages: website game (client)]
[HP/PC pemain] --WebSocket--> [Server Node.js + Colyseus: room "kota"]
[Tahap 3] Client --HTTPS--> [Supabase: akun & data persisten]
```

Dua bagian terpisah total:
- **Client** (`client/`) — website statis: Three.js + TypeScript, dibangun Vite. Boleh di-host di mana saja (Cloudflare Pages).
- **Server** (`server/`) — Node.js + Colyseus: mengatur room, posisi pemain, chat. Harus berjalan di server yang mendukung WebSocket persisten (VPS / Railway / Render / Fly.io — BUKAN hosting statis).

## 2. Keputusan Teknis & Alasannya

| Keputusan | Pilihan | Alasan |
|-----------|---------|--------|
| Bahasa | TypeScript di client & server | Satu bahasa, tipe data pemain bisa dibagikan konsepnya, error ketahuan saat build |
| Rendering | Three.js | Standar web 3D, dokumentasi resmi lengkap, ringan |
| Build tool | Vite | Cepat, konfigurasi minimal, template resmi `vanilla-ts` |
| Multiplayer | Colyseus | Room + sinkronisasi state otomatis (delta), cocok untuk social world, open-source |
| Model gerak | **Server otoritatif**: klien kirim arah input, server yang menghitung posisi | Mencegah speed-hack/teleport sejak fondasi; klien cukup "memprediksi" gerak sendiri dengan rumus yang sama agar terasa responsif |
| Fisika | Rumus gerak sederhana bersama (kecepatan jalan 4 m/s, lari 7 m/s, gravitasi & lompat sederhana) | Tanpa engine fisika berat — cukup untuk plaza datar, ramah Android |
| Database | Belum ada di prototype; Supabase di Tahap 3 | Prototype fokus membuktikan dunia & multiplayer; akun persisten menyusul |
| Aset 3D | Primitif terprogram (builder functions) | Tanpa file model, ukuran unduhan kecil, gaya konsisten; diganti .glb nanti lewat kontrak builder yang sama |

## 3. Alur Data Multiplayer

1. Klien membuka website → memasukkan nama tampilan & warna baju → tombol "Masuk Kota".
2. Klien terhubung WebSocket ke server, `joinOrCreate("kota", { name, shirt, skin, pants })`.
3. Server membuat `Player` di state room pada posisi spawn (selatan plaza) dan menyiarkan state ke semua klien.
4. Klien mengirim pesan `input` ±15×/detik: `{ x, z, sprint, jump }` — hanya arah, bukan posisi.
5. Server mensimulasikan semua pemain pada interval tetap (50 ms): posisi, lompat/gravitasi, batas dunia (±42 m), dan tabrakan lingkaran air mancur.
6. Colyseus menyiarkan perubahan state (delta) ke semua klien; klien menginterpolasi avatar pemain lain agar gerakan halus.
7. Chat: klien mengirim `chat` → server memvalidasi (panjang ≤ 120, rate-limit, filter kata) → server menyiarkan `chat` ke semua.
8. Emote: klien mengirim `emote` → server menyetel state `anim = "wave"` selama 2 detik → semua klien memutar animasi lambaian.

## 4. Struktur State (dibagikan server → klien)

`KotaState { players: Map<sessionId, Player> }`
`Player { name, x, y, z, rotY, anim, shirt, skin, pants }` — hanya data tampilan publik. Tidak ada email, tidak ada data akun di state.

## 5. Keamanan Dasar (sejak prototype)

- Server tidak pernah memercayai posisi dari klien — hanya input arah, dan besarnya dinormalisasi (maks. 1).
- Nama tampilan: dipotong 16 karakter, karakter kontrol dibuang.
- Chat: maks. 120 karakter, minimal jeda 800 ms antar pesan per pemain, daftar kata kasar dasar disensor, link tidak dirender sebagai tautan aktif.
- Rate-limit join tidak diperlukan di prototype lokal; wajib ditambah sebelum publik (Tahap 4).
- **Aturan keras:** tidak ada secret key apa pun di kode client. Supabase nanti hanya memakai *anon key* publik di client; *service role key* hanya boleh ada di server (variabel lingkungan `.env`, tidak masuk repo — lihat `.gitignore`).

## 6. Performa (target Android kelas menengah)

- Client: pixelRatio ≤ 2, bayangan satu directional light, geometri/material dipakai ulang, draw calls < 300.
- Jaringan: input 15 Hz, state delta (bukan full snapshot), tanpa data per-frame selain transform & anim.
- Server: satu room menampung maks. 50 klien di prototype; penskalaan multi-room/instans di Tahap 4.

## 7. Cara Menjalankan (ringkas — detail di README.md proyek)

- Server: `cd server && npm install && npm run build && npm start` → mendengarkan di port 2567, cek kesehatan: `GET /health`.
- Client: `cd client && npm install && npm run dev` → buka alamat yang ditampilkan Vite.
- Uji multiplayer otomatis: server menyala, lalu `cd server && npm run test:2clients`.
