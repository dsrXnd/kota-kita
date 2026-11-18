# Usaha Pemain — Pasar (Lapak) · Tahap 7

Kawasan perdagangan KOTA KITA di **selatan Plaza Utama**: 10 lapak yang
bisa dimiliki akun dan dipakai berjualan ke pemain lain. Pasar adalah
satu-satunya aset produktif di kota — pemiliknya menghasilkan KC dari
penjualan sungguhan ke pemain lain, bukan dari server. Inilah yang
menjawab kebutuhan hidup Tahap 6B: pemain yang lapar/haus bisa membeli
dari lapak warga (KC berpindah antar-akun), selain jalur NPC yang sudah ada.

Prinsipnya sama seperti tahap-tahap sebelumnya: **server adalah
satu-satunya otoritas** — harga, kepemilikan, kas, dan perpindahan saldo
semuanya diputuskan & diterapkan server; client hanya menggambar state
dan mengirim permintaan.

Kode terkait:

- `server/src/market/market.ts` — denah 10 lapak, katalog & rentang harga
  (sumber kebenaran server), penyimpanan `market.json` (pemilik, menu,
  kas usaha, log penjualan).
- `server/src/rooms/KotaRoom.ts` — handler `lapak_claim` /
  `lapak_set_name` / `lapak_set_item` / `lapak_buy` / `lapak_collect` /
  `lapak_mine_get`, state publik lapak, collider meja dinamis di simulasi.
- `server/src/accounts/store.ts` — metode `spendKC` (jalur potong saldo),
  `creditKC` (jalur kredit resmi, dipakai ambil kas), `addSouvenir`.
- `client/src/world/Pasar.ts` — gambar distrik di client; denah & jejak
  meja di file ini HARUS sama dengan server.
- Uji otomatis: `server/test/market.mjs` (`npm run test:market`) —
  mengelola server sendiri di port 2579 + folder data sementara agar bisa
  membuktikan persistensi lintas restart.

## Denah Pasar

Pasar menempel di selatan plaza (Kampung Kita tetap di timur). Jalan
pasar membentang barat–timur di z 49..55; gerbang pasar di (0, 44)
dihubungkan jalan batu dari plaza. Batas dunia meluas ke selatan:
x −42..136, z −42..**70** (konstanta sama di server `KotaRoom.ts` dan
client `main.ts`).

| Baris | Nomor | Jumlah | Petak | Posisi tengah (z) | Tengah x | Menghadap |
| --- | --- | --- | --- | --- | --- | --- |
| Utara (`lp_1`–`lp_5`) | 1–5 | 5 | 7×6 m | 46 | −32, −16, 0, 16, 32 | +z (ke jalan) |
| Selatan (`lp_6`–`lp_10`) | 6–10 | 5 | 7×6 m | 58 | −32, −16, 0, 16, 32 | −z (ke jalan) |

Setiap lapak punya papan di tepi depannya (posisi titik depan =
tengah petak digeser 2,4 m ke arah jalan): nomor lapak; bila dimiliki,
nama lapak + `@pemilik`. Lapak yang dimiliki mendapat visual gerobak
(tiang, meja, terpal berwarna per nomor, peti & barang) yang digambar
semua klien dari state room. Lapak kosong hanya alas petak + papan
"KOSONG".

## Harga lapak (keputusan user — jangan diubah sepihak)

| Hal | Harga |
| --- | --- |
| Klaim 1 lapak | **10.000 KC** |

## Katalog barang & rentang harga

Pemilik mengatur harga tiap barang **di dalam rentang yang diatur
sistem** dan boleh membuka/menutup stoknya. Di luar rentang = ditolak
server. Saat klaim, semua barang tersedia pada harga bawaan.

| Barang | Efek ke pembeli | Rentang harga | Bawaan |
| --- | --- | --- | --- |
| Es Teh (`es_teh`) | 💧 Haus +60 | 5–25 KC | 10 KC |
| Kopi (`kopi`) | 💧 Haus +40 | 5–30 KC | 15 KC |
| Bakso (`bakso`) | 🍗 Lapar +80 | 15–60 KC | 35 KC |
| Batik (`batik`) | 🎁 Suvenir koleksi (tanpa efek meter) | 50–250 KC | 100 KC |

Membeli batik menambah **penghitung suvenir persisten** di akun pembeli
(tersimpan di data ekonomi akun, tampil di panel lapak & `GET /auth/me`).

## Aturan klaim

1. **Satu akun satu lapak.** Server memeriksa dua arah sebelum klaim:
   lapak harus kosong DAN akun belum memiliki lapak mana pun.
2. **Independen dari kavling** — punya lapak tidak menghalangi klaim
   kavling, dan sebaliknya (dibuktikan uji otomatis).
3. **Tamu tidak bisa klaim** — tidak punya akun & saldo.
4. Klaim memotong 10.000 KC lewat `spendKC`; saldo kurang = ditolak.
5. Pemilik boleh mengganti **nama lapak** (maks. 20 karakter; disanitasi
   server dengan sensor kata kasar yang sama seperti chat). Nama bawaan
   saat klaim: `Lapak <nama pengguna>`.

## Jual-beli — atomik di server

Pembeli berdiri di depan lapak (server memeriksa jarak ke titik depan
lapak ≤ 6 m) lalu membeli lewat panel. Satu pembelian divalidasi penuh
**sebelum** apa pun berubah:

- pembeli masuk dengan akun (tamu ditolak) dan **bukan pemilik** lapak
  (belanja di lapak sendiri ditolak);
- lapak sudah dimiliki & barang ada di katalog & stoknya terbuka;
- saldo pembeli cukup (dicek lagi oleh `spendKC` saat pemotongan).

Bila semua lolos, server menerapkan **sekaligus dalam satu langkah
sinkron** (tanpa jeda, jadi tidak ada keadaan setengah jadi):

1. saldo pembeli −harga (`spendKC`, tercatat di ledger pembeli:
   `Beli <barang> di <nama lapak>`);
2. **kas usaha lapak +harga** dan penjualan dicatat di log lapak
   (nama pembeli, barang, harga, waktu — 20 terakhir);
3. meter kebutuhan pembeli terisi sesuai efek barang (logika meter yang
   sama dengan Tahap 6B, disimpan ke akun pembeli); untuk batik:
   penghitung suvenir pembeli +1.

Bila satu validasi saja gagal → **tidak ada perubahan apa pun** (saldo,
kas, meter, log semua batal). Harga yang dipakai selalu harga tersimpan
di server — client tidak pernah mengirim angka harga saat membeli.
Pemilik yang sedang online menerima kabar penjualan + data kas terbarunya
secara privat.

## Kas usaha — privat, diambil saat berkunjung

- Hasil penjualan **tidak** langsung masuk saldo pemilik; ia menumpuk
  sebagai **kas usaha** di data lapak.
- **Privat:** kas & log penjualan TIDAK ada di state room dan tidak
  disiarkan. Keduanya hanya dikirim ke pemilik lewat pesan privat
  `lapak_mine` (balasan `lapak_mine_get`, dan didorong server setiap ada
  penjualan/perubahan). Klien lain hanya melihat pemilik, nama lapak, dan
  menu (harga + stok) di state — cukup untuk panel pembeli & papan.
- **Ambil Kas:** pemilik berdiri di depan lapaknya sendiri (≤ 6 m) lalu
  mengambil: kas berpindah utuh ke saldo pemilik lewat `creditKC`
  (tercatat di ledger: `Ambil kas <nama lapak>`) dan kas menjadi 0.
  Non-pemilik ditolak; mengambil saat kas kosong ditolak; keduanya tanpa
  perubahan apa pun.

## Model data

`server/data/market.json` (pola tulis atomik yang sama seperti akun &
kavling: tulis `.tmp` lalu rename):

```json
{ "lapaks": { "lp_1": {
  "owner": "budi", "ownerName": "Budi", "name": "Lapak Berkah",
  "kas": 270,
  "menu": { "es_teh": { "price": 20, "stocked": true }, "…": {} },
  "sales": [ { "buyer": "sari", "item": "es_teh", "price": 20, "ts": 1730000000000 } ],
  "claimedAt": 1730000000000
} } }
```

- `owner` = kunci akun (nama pengguna huruf kecil) — dasar aturan satu
  akun satu lapak dan pencarian "lapak saya".
- `kas` & `sales` = data privat pemilik (lihat bagian kas di atas).

State room (Colyseus) memuat `lapaks`: peta id lapak → `{ owner, name,
menu }` untuk **semua 10 lapak** sejak room dibuat, plus `lapaksActive`:
jumlah lapak yang sudah dimiliki (bahan statistik Tahap 8). Lapak yang
belum diklaim tampil dengan menu bawaan & stok tertutup.

## Collider meja lapak dinamis

Kotak tabrakan meja lapak (5×2,5 m di belakang petak, `stallBox`)
**diturunkan dari data lapak yang sama** di kedua sisi — rumus identik di
`server/src/market/market.ts` dan `client/src/world/Pasar.ts`. Hanya
lapak yang **sudah dimiliki** (gerobaknya berdiri) yang punya kotak.
Server membangun ulang daftar kotaknya setiap kepemilikan berubah dan
menegakkannya di loop simulasi bersama kotak rumah; client memakai
daftar yang sama untuk prediksi lokal. Dibuktikan uji otomatis: pemain
yang berlari lurus ke meja lapak tertahan di depannya — oleh server.
