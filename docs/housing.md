# Perumahan — Kampung Kita (Kavling & Rumah Pribadi) · Tahap 6

Kawasan permukiman pertama KOTA KITA, menempel di timur Plaza Utama.
Prinsipnya sama seperti ekonomi Tahap 5: **server adalah satu-satunya
otoritas** — harga, kepemilikan, dan pemotongan saldo semuanya diputuskan
server; client hanya menggambar state yang dikirim server dan mengirim
permintaan (klaim/bangun/pulang).

Kode terkait:

- `server/src/housing/housing.ts` — denah 24 kavling, katalog & harga
  (sumber kebenaran server), penyimpanan kepemilikan `plots.json`.
- `server/src/rooms/KotaRoom.ts` — handler `plot_claim` / `plot_build` /
  `home`, state publik kavling, collider rumah dinamis di simulasi.
- `server/src/accounts/store.ts` — metode `spendKC`, satu-satunya jalur
  belanja saldo (menolak bila saldo kurang, saldo tak pernah negatif).
- `client/src/world/Kampung.ts` — gambar distrik di client; denah &
  jejak rumah di file ini HARUS sama dengan server.
- Uji otomatis: `server/test/plots.mjs` (`npm run test:plots`) — mengelola
  server sendiri di port 2577 + folder data sementara agar bisa membuktikan
  persistensi lintas restart.

## Denah Kampung Kita

Jalan utama membentang ke timur dari gerbang plaza (x ±44) sampai x 134
di z −4..4. Kavling premium menghadap jalan utama; kavling standar di
baris dalam di balik jalan lingkungan (z 19..22 dan −22..−19).

| Kelompok | Jumlah | Ukuran | Posisi tengah (z) | Tengah x |
| --- | --- | --- | --- | --- |
| Kavling 2 utara (`k2_1`–`k2_4`) | 4 | 14×13 m | −12,5 | 53, 71, 89, 107 |
| Kavling 2 selatan (`k2_5`–`k2_8`) | 4 | 14×13 m | 12,5 | 53, 71, 89, 107 |
| Kavling 1 utara (`k1_1`–`k1_8`) | 8 | 10×12 m | −28 | 50, 61, 72, 83, 94, 105, 116, 127 |
| Kavling 1 selatan (`k1_9`–`k1_16`) | 8 | 10×12 m | 28 | 50, 61, 72, 83, 94, 105, 116, 127 |

Batas dunia menjadi persegi panjang: x −42..136, z −42..42 (konstanta
sama di server `KotaRoom.ts` dan client `main.ts`). Setiap kavling punya
papan di tepi depannya: nomor kavling + nama pengguna pemilik (tekstur
canvas yang digambar ulang hanya saat pemilik berubah), atau "KOSONG".

## Harga (keputusan user — jangan diubah sepihak)

| Hal | Harga |
| --- | --- |
| Klaim Kavling 1 | **2.500 KC** |
| Klaim Kavling 2 | **5.000 KC** |
| Rumah Bambu (6×5 m) | **2.000 KC** — boleh di Kavling 1 & 2 |
| Rumah Batu (8×6,5 m) | **5.000 KC** — boleh di Kavling 1 & 2 |
| Rumah Tingkat (8×7 m, 2 lantai + balkon) | **7.500 KC** — **hanya Kavling 2** |

## Aturan klaim & bangun

1. **Satu akun satu kavling.** Server memeriksa dua arah sebelum klaim:
   kavling harus kosong DAN akun belum memiliki kavling mana pun.
2. **Tamu tidak bisa klaim/bangun** — tidak punya akun & saldo.
3. Klaim memotong harga penuh lewat `spendKC`; saldo kurang = ditolak,
   tidak ada utang.
4. Bangun rumah pertama memotong harga penuh. **Upgrade hanya memotong
   selisih** (mis. Bambu → Batu = 5.000 − 2.000 = 3.000 KC). Hanya boleh
   naik tingkat; turun tingkat / membangun yang sama ditolak.
5. Rumah Tingkat di Kavling 1 ditolak server (bukan cuma disembunyikan
   client) — client menampilkannya terkunci sebagai informasi.
6. **"Ke Rumahku"** (tombol 🏠): server memindah posisi resmi pemain ke
   halaman depan rumahnya (atau depan kavlingnya bila masih tanah
   kosong). Pemain tanpa kavling menerima penolakan yang jelas.
7. Semua hasil dikirim privat (`plot_result` / `home_result`) + pesan
   `balance` agar chip saldo client segar; kepemilikan sendiri adalah
   data publik lewat state.

## Model data

`server/data/plots.json` (pola tulis atomik yang sama seperti akun:
tulis `.tmp` lalu rename):

```json
{ "plots": { "k1_1": { "owner": "budi", "ownerName": "Budi", "house": 2, "claimedAt": 1730000000000 } } }
```

- `owner` = kunci akun (nama pengguna huruf kecil) — dasar aturan
  satu akun satu kavling dan pencarian "kavling saya".
- `ownerName` = nama pengguna tampilan untuk papan & state publik.
- `house` = 0 (tanah kosong) atau tingkat katalog 1..3.

State room (Colyseus) memuat `plots`: peta id kavling → `{ owner, house }`
untuk **semua 24 kavling** sejak room dibuat, plus `housesBuilt`:
jumlah rumah berdiri di kota (bahan statistik Tahap 8). Client menggambar
ulang papan/rumah hanya untuk kavling yang berubah.

## Collider rumah dinamis

Kotak tabrakan rumah **diturunkan dari data kavling yang sama** di kedua
sisi: jejak rumah (Bambu 6×5, Batu 8×6,5, Tingkat 8×7) ditempatkan di
tengah-belakang petak (`houseCenter`/`houseBox` — rumus identik di
`server/src/housing/housing.ts` dan `client/src/world/Kampung.ts`).
Server membangun ulang daftar kotaknya setiap kepemilikan berubah dan
menegakkannya di loop simulasi lewat `resolveCollisions(player, boxes)`;
client memakai daftar yang sama untuk prediksi lokal. Dibuktikan uji
otomatis: pemain yang berlari lurus ke rumah yang berdiri tertahan di
luar kotaknya — oleh server, bukan sekadar client.
