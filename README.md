# 🏙️ KOTA KITA

Dunia virtual sosial 3D multiplayer berbasis browser, bertema kota Indonesia modern.
Sudah berjalan: satu Plaza Utama, avatar bisa dikustomisasi (warna, gaya rambut/penutup kepala, baju batik), kontrol sentuh Android, multiplayer real-time, chat, emote, mode foto, akun persisten + teman + moderasi (Tahap 3), paket deploy satu alamat (Tahap 4), **ekonomi Koin Kota (KC)** — saldo akun, bonus harian, dan 3 pekerjaan dalam dunia (Tahap 5), **Kampung Kita** — 24 kavling yang bisa diklaim dengan KC serta katalog 3 rumah pribadi yang tersinkron ke semua pemain (Tahap 6), **kehidupan warga (Tahap 6B)** — check-in streak beruntun (10–150 KC), 3 meter kebutuhan hidup (lapar/haus/kebelet) dengan jalur isi ulang gratis & berbayar, 3 pekerjaan baru (Petugas Taman, Ojek Makanan, Satpam Malam), cooldown per-pekerjaan, skip cooldown berbayar dengan maks. 2 sif bersamaan, dan siklus siang-malam 24 menit yang diatur server untuk semua pemain, dan **Pasar (Tahap 7)** — 10 lapak usaha yang bisa diklaim seharga 10.000 KC, dijual-belikan antar-pemain secara atomik (es teh, kopi, bakso, batik suvenir) dengan harga dalam rentang sistem, dan kas usaha privat yang diambil pemilik saat berkunjung.

Dokumen desain ada di folder `docs/`:
- `game-design.md` — Game Design Document
- `art-style.md` — konsep visual & peta area
- `architecture.md` — arsitektur teknis & keputusan
- `avatar-design.md` — desain avatar
- `accounts.md` — sistem akun, teman & moderasi (Tahap 3)
- `economy.md` — ekonomi Koin Kota: aturan KC, check-in streak, 6 pekerjaan, cooldown & skip berbayar (Tahap 5 + 6B)
- `needs.md` — kebutuhan hidup (meter, laju, efek kritis, titik isi ulang) & waktu dunia server (Tahap 6B)
- `housing.md` — Kampung Kita: denah kavling, harga, aturan klaim/bangun/upgrade, model data & collider dinamis (Tahap 6)
- `market.md` — Pasar: denah lapak, katalog & rentang harga, aturan klaim/jual-beli atomik/kas usaha privat, model data & collider dinamis (Tahap 7)
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
  Membuktikan saldo awal 500 KC, check-in streak Hari 1 +10 KC (klaim kedua di hari yang sama ditolak), tamu ditolak bonus & pekerjaan, gaji 180 KC dari pekerjaan kebersihan dibayar tepat sekali, cooldown per-pekerjaan ditegakkan server, dan saldo persisten setelah masuk lagi. Detail ekonomi: `docs/economy.md`.
- **Otomatis (Tahap 6B — streak, kebutuhan, pekerjaan baru, skip, waktu dunia):**
  ```bash
  cd server
  npm run test:6b
  ```
  Uji ini mengelola servernya sendiri (port 2578 + folder data sementara + konfigurasi jam `KOTA_TIME_OFFSET_MIN`), jadi tidak perlu server lain menyala. Membuktikan tangga streak (Hari 2 +20, reset +10, Hari 7 +150), meter kebutuhan berkurang hanya saat bermain & semua jalur isi ulang (gratis: air mancur/WC balai kota/masak di rumah; berbayar terpotong tepat), efek kritis server (lari dibatasi & job_start ditolak), 3 pekerjaan baru dibayar tepat (170/220/250 KC), cooldown per-pekerjaan (90/120/150 menit), skip berbayar (biaya terbakar & hangus saat batal, attempt ke-4 ditolak), maks. 2 sif & larangan Kurir+Ojek bersamaan, dan Satpam hanya saat malam server. Detail: `docs/needs.md` & `docs/economy.md`.
- **Otomatis (perumahan Tahap 6):**
  ```bash
  cd server
  npm run test:plots
  ```
  Uji ini mengelola servernya sendiri (port 2577 + folder data sementara), jadi tidak perlu server lain menyala. Membuktikan klaim kavling ditolak saat saldo kurang, saldo terpotong tepat (klaim 2.500 KC, bangun 2.000 KC, upgrade hanya selisih 3.000 KC), klaim ganda ditolak dua arah, Rumah Tingkat ditolak di Kavling 1, kepemilikan terlihat klien lain di state, collider rumah menahan pemain, teleport "Ke Rumahku" bekerja, dan semuanya persisten setelah server restart. Detail perumahan: `docs/housing.md`.
- **Otomatis (usaha pemain Tahap 7):**
  ```bash
  cd server
  npm run test:market
  ```
  Uji ini mengelola servernya sendiri (port 2579 + folder data sementara), jadi tidak perlu server lain menyala. Membuktikan klaim lapak terpotong tepat 10.000 KC & klaim ganda ditolak dua arah, kepemilikan lapak independen dari kavling, harga di luar rentang & perubahan oleh non-pemilik ditolak, pembelian memindahkan KC secara atomik (saldo pembeli −harga, kas pemilik +harga, meter terisi, tercatat di log & ledger), pembelian saldo kurang/lapak sendiri/barang tak tersedia/tamu ditolak tanpa perubahan, batik menambah suvenir persisten, kas usaha privat (tidak ada di state & non-pemilik tidak bisa mengambil; pemilik mengambil → saldo naik tepat sejumlah kas), collider meja lapak menahan pemain, dan semuanya persisten setelah server restart. Detail pasar: `docs/market.md`.
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
