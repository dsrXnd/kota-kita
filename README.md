# 🏙️ KOTA KITA

Dunia virtual sosial 3D multiplayer berbasis browser, bertema kota Indonesia modern.
Sudah berjalan: satu Plaza Utama, avatar bisa dikustomisasi (warna, gaya rambut/penutup kepala, baju batik), kontrol sentuh Android, multiplayer real-time, chat, emote, mode foto, siang/malam, akun persisten + teman + moderasi (Tahap 3), paket deploy satu alamat (Tahap 4), dan **ekonomi Koin Kota (KC)** — saldo akun, bonus harian, dan 3 pekerjaan dalam dunia (Tahap 5).

Dokumen desain ada di folder `docs/`:
- `game-design.md` — Game Design Document
- `art-style.md` — konsep visual & peta area
- `architecture.md` — arsitektur teknis & keputusan
- `avatar-design.md` — desain avatar
- `accounts.md` — sistem akun, teman & moderasi (Tahap 3)
- `economy.md` — ekonomi Koin Kota: aturan KC, 3 pekerjaan, validasi anti-cheat server (Tahap 5)
- `roadmap.md` — rencana tahap berikutnya

## Struktur

```
client/   Website game (Three.js + TypeScript + Vite)
server/   Server multiplayer (Node.js + Colyseus, port 2567)
docs/     Dokumen desain & teknis
```

## Cara Menjalankan (di komputer/server pengembangan)

Butuh Node.js 20+.

**1. Server multiplayer (jalankan dulu):**
```bash
cd server
npm install
npm run build
npm start
```
Server jalan di port 2567. Cek: buka `http://localhost:2567/health` → harus menjawab `{"ok":true,...}`.

**2. Website game (terminal lain):**
```bash
cd client
npm install
npm run dev
```
Buka alamat yang ditampilkan Vite (biasanya `http://localhost:5173`).

**3. Main dari HP di jaringan yang sama:**
Buka `http://<IP-komputer>:5173/?server=ws://<IP-komputer>:2567` di Chrome HP.
Parameter `?server=` memberi tahu game alamat server multiplayernya.

## Mode Produksi (satu alamat, untuk hosting)

Setelah client & server di-build, server juga menyajikan website game:

```bash
cd client && npm run build
cd ../server && npm run build && npm start
```

Buka `http://localhost:2567` — website, akun, dan multiplayer semua dari satu alamat.
Untuk deploy ke internet (Render/Railway/VPS) proyek sudah punya `Dockerfile` +
`render.yaml`; panduan langkah-demi-langkah ada di `docs/deployment.md`.
Uji beban 50 pemain: server menyala, lalu `cd server && npm run test:load`.

## Cara Menguji

- **Otomatis (multiplayer 2 klien):** server menyala, lalu:
  ```bash
  cd server
  npm run test:2clients
  ```
  Uji ini membuktikan dua klien saling melihat, posisi tersinkron, dan chat terkirim.
- **Otomatis (akun Tahap 3):**
  ```bash
  cd server
  npm run test:accounts
  ```
  Membuktikan daftar/masuk (sandi salah ditolak), profil persisten, join bertoken, teman + status online, dan laporan moderasi tertulis di server. Detail sistem akun: `docs/accounts.md`.
  Data runtime server (akun, log, laporan) tersimpan di `server/data/` dan tidak masuk repo.
- **Otomatis (ekonomi Tahap 5):**
  ```bash
  cd server
  npm run test:economy
  ```
  Membuktikan saldo awal 500 KC, bonus harian +100 KC (klaim kedua di hari yang sama ditolak), tamu ditolak bonus & pekerjaan, gaji 180 KC dari pekerjaan kebersihan dibayar tepat sekali, cooldown 10 menit ditegakkan server, dan saldo persisten setelah masuk lagi. Detail ekonomi: `docs/economy.md`.
- **Manual:** buka game di dua perangkat/tab berbeda, masuk dengan nama berbeda, bergerak & chat — avatar harus terlihat bergerak di layar satu sama lain.
- **Build produksi:** `cd client && npm run build` dan `cd server && npm run build` harus selesai tanpa error.

## Memperbaiki Error Umum

| Gejala | Penyebab paling umum | Perbaikan |
|--------|----------------------|-----------|
| Status "Offline" terus | Server belum jalan / alamat server salah | Jalankan server; cek `/health`; pastikan `?server=` benar |
| Layar putih | Error JavaScript | Lihat pesan error merah di konsol browser / panel Problems di editor |
| Pemain lain tidak terlihat | Beda room/beda server | Pastikan kedua klien memakai alamat server & port yang sama |
| Game berat di HP | Pixel ratio tinggi | Game sudah membatasi pixelRatio ≤ 2; tutup tab lain di HP |

## Keamanan

Tidak ada secret key di kode client. Konfigurasi rahasia server hanya lewat variabel lingkungan (`.env`, tidak masuk repo).
