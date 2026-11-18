# Kota Hidup: Statistik, Kabar & Voting (Tahap 8)

Kota terasa hidup: warga bisa melihat denyut kotanya (statistik), membaca
peristiwa terbaru (Kabar Kota), dan ikut memutuskan fasilitas umum apa
yang dibangun berikutnya lewat **voting**. Fasilitas yang lolos voting
benar-benar **muncul di dunia** — terlihat semua pemain (termasuk yang
sedang online saat itu juga) dan punya tabrakan fisik seperti bangunan
lain. Semua data kota disimpan server di `data/city.json`
(`server/src/city/city.ts`) dan terbukti oleh uji otomatis
`server/test/city.mjs` (`npm run test:city` di folder `server/`).

Semua angka KC di tahap ini hanya **mengikuti** aliran KC yang sudah ada
— kas kota adalah *penghitung statistik*, bukan saldo yang bisa dibelanjakan
atau sumber KC baru. Tidak ada angka tahap sebelumnya yang berubah.

## Panel Kota (📊 / 📰 / 🗳️)

Satu panel "🏙️ Kota Kita" di HUD berisi tiga bagian: **Statistik Kota**,
**Voting Fasilitas**, dan **Kabar Kota**. Panel dibuka lewat tiga tombol
di bar atas (📊 statistik, 📰 kabar, 🗳️ voting — ketiganya membuka panel
yang sama) atau dengan berinteraksi ke **Papan Pengumuman** di plaza.
Data selalu diminta segar dari server saat panel dibuka (pesan
`city_get` → balasan `city`), dan selama panel terbuka, kabar baru yang
masuk menyegarkannya otomatis (siaran `news_update`).

## Statistik Kota

| Statistik | Definisi | Sumber |
|---|---|---|
| Penduduk | Total akun terdaftar | `AccountStore.userCount()` |
| Warga online | Pemain yang sedang berada di room | `state.players.size` |
| Rumah berdiri | Rumah yang sudah dibangun warga | penghitung `housesBuilt` (Tahap 6) |
| Lapak aktif | Lapak pasar yang sudah diklaim | penghitung `lapaksActive` (Tahap 7) |
| Kas Kota | Total KC yang pernah masuk dari biaya pembangunan kota (lihat bawah) | `city.json → kasKota` |

### Kas Kota — apa yang mengisinya

Kas kota bertambah **tepat saat** salah satu pembelian berikut berhasil
(dipotong server lewat jalur akun yang sama seperti sebelumnya):

- Klaim kavling: harga kavling (2.500 / 5.000 KC)
- Bangun rumah / upgrade rumah: biaya bangun, termasuk selisih upgrade
  (2.000 / 5.000 / 7.500 KC atau selisihnya)
- Klaim lapak pasar: 10.000 KC

Yang **tidak** masuk kas kota: biaya skip cooldown pekerjaan (KC itu
*terbakar*, keputusan Tahap 6B), harga jual-beli antar-pemain di lapak
(KC berpindah ke kas usaha pemilik, bukan ke kota), gaji, dan bonus.

**Catatan jujur:** pencatatan kas kota **baru dimulai sejak Tahap 8** —
kas mulai dari 0 dan hanya menghitung pembelian yang terjadi setelah
tahap ini berjalan. Tidak ada riwayat pembelian lama yang bisa (atau
boleh) direkonstruksi mundur, jadi angka awal kas kota memang belum
mencerminkan pembangunan kota sebelum Tahap 8.

## Kabar Kota

Umpan peristiwa otomatis server, disimpan **50 entri terakhir** di
`city.json` (tertua terbuang), ditampilkan terbaru-di-depan (panel
menampilkan ±15 entri terakhir). Peristiwa yang tercatat:

| Peristiwa | Contoh bunyi |
|---|---|
| Warga baru mendaftar | "👋 Warga baru bergabung: @nama! Selamat datang di Kota Kita." |
| Rumah pertama dibangun di kavling | "🏠 @nama membangun Rumah Bambu baru di Kavling 1 No. 3!" |
| Rumah di-upgrade | "⬆️ @nama meningkatkan rumahnya menjadi Rumah Tingkat di Kavling 2 No. 1!" |
| Lapak diklaim | "🏪 @nama membuka Lapak No. 4 di Pasar!" |
| Voting dibuka | "🗳️ Voting dibuka: usulan pembangunan Taman Bunga! …" |
| Voting ditutup — lolos | "✅ Voting selesai: Taman Bunga LOLOS (setuju 5 · tolak 2)!" |
| Voting ditutup — gagal | "❌ Voting selesai: Lapangan Futsal belum lolos (setuju 1 · tolak 2 — syarat: setuju ≥ 3 dan lebih banyak dari menolak)." |
| Fasilitas selesai dibangun | "🎉 Taman Bunga selesai dibangun dan kini bisa dikunjungi warga!" |

Entri registrasi sengaja **tanpa toast** (bisa sangat sering). Toast
hanya untuk peristiwa besar — hasil voting & fasilitas selesai
(siaran `city_event`). Entri kabar ditulis dari server pada saat
peristiwanya terjadi; registrasi ditulis dari API HTTP
`POST /auth/register` (store kota adalah singleton satu proses, sama
seperti store akun).

## Voting Usulan Fasilitas

Warga memutuskan fasilitas umum berikutnya:

- **Satu usulan aktif** pada satu waktu, berjalan mengikuti antrean
  katalog (lihat bawah). Usulan pertama dibuka otomatis saat room
  pertama dibuat setelah server menyala.
- **Jendela 24 jam asli** per usulan (`closesAt` tersimpan di
  `city.json`). Durasi bisa diatur lewat konfigurasi server
  `KOTA_VOTE_MINUTES` (bawaan `1440` = 24 jam) — konfigurasi biasa
  seperti `KOTA_TIME_OFFSET_MIN`, bukan celah curang; uji otomatis
  memakainya untuk menjalankan satu siklus voting penuh dengan cepat.
- **Siapa boleh memilih:** hanya akun terdaftar yang masuk dengan token.
  Tamu ditolak dengan penjelasan. **1 akun = 1 suara, final** — suara
  kedua (termasuk mengganti pilihan) pada usulan yang sama ditolak.
- **Syarat lolos:** suara setuju **≥ 3** (konstanta `MIN_YES = 3` di
  `server/src/city/city.ts`) **dan** setuju **lebih banyak** dari menolak.
- **Penutupan** dievaluasi dua jalan: (1) loop room memeriksa berkala
  (±tiap 1 detik) selama ada room berjalan; (2) saat room dibuat —
  penutupan yang terlewat selagi server mati langsung dibereskan
  (catch-up), lalu usulan berikutnya dibuka.
- **Bila lolos:** fasilitas langsung aktif (state room + model 3D +
  collider, tampil langsung di tengah sesi). **Bila gagal:** fasilitas
  pindah ke **belakang antrean** usulan yang belum terbangun, dan akan
  diusulkan lagi setelah usulan lain berjalan.
- **Bila semua fasilitas terbangun:** voting beristirahat (tidak ada
  usulan aktif; panel menjelaskan hal ini).
- Panel voting menampilkan: nama + deskripsi usulan, tally setuju/tolak
  langsung, sisa waktu jendela, tombol Setuju/Tolak (atau status
  "Kamu sudah memilih: …" / penjelasan untuk tamu), dan **hasil usulan
  terakhir yang ditutup**.

Pesan: `vote_cast {choice: "yes"|"no"}` → `vote_result {ok, message}`
(+ payload `city` segar untuk pemilih).

## Katalog Fasilitas & Denah

Semua fasilitas dibangun di **lahan rumput barat & barat laut plaza** —
jauh dari Kampung Kita (timur) dan Pasar (selatan), dan tidak menimpa
bangunan plaza yang sudah ada. Koordinat di bawah adalah pusat denah;
kotak collider adalah kotak fisik yang menahan pemain (server & klien
memakai daftar yang sama persis).

| ID | Nama | Pusat | Isi model | Collider |
|---|---|---|---|---|
| `taman_bunga` | Taman Bunga | (-36, -32) | alas taman, 4 bedeng bunga warna-warni, pohon, 2 bangku | 4 bedeng 3.6 × 1.4 m di (-39.2, -34.6), (-32.8, -34.6), (-39.2, -29.4), (-32.8, -29.4) |
| `lapangan_futsal` | Lapangan Futsal | (-36, 32) | lapangan hijau + garis putih, 2 gawang, bola, tiang sudut | 2 kotak gawang 5 × 0.8 m di (-36, 24.6) & (-36, 39.4) |
| `perpustakaan` | Perpustakaan Mini | (-24, -39) | gedung 8 × 4.5 m, atap perisai, pintu & jendela, papan nama, undakan, semak | badan gedung 8 × 4.5 m: x -28..-20, z -41.25..-36.75 |

Urutan antrean awal: Taman Bunga → Lapangan Futsal → Perpustakaan Mini.

Sebelum aktif, lokasi fasilitas **bebas dilewati** (tidak ada model dan
tidak ada collider hantu — dibuktikan uji). Setelah aktif, fasilitas
bergabung ke sistem kotak tabrakan dinamis yang sama dengan rumah &
lapak: server menolak gerakan menembusnya dan klien menahan pemainnya
dengan daftar kotak yang sama.

## Model Data

`data/city.json` (ditulis atomik: berkas sementara + rename):

```jsonc
{
  "kasKota": 14500,              // penghitung statistik (lihat aturan di atas)
  "news": [ { "ts": 0, "icon": "🏠", "text": "…" } ],   // maks. 50, urut lama → baru
  "queue": ["lapangan_futsal"],  // antrean fasilitas belum terbangun & belum diusulkan
  "active": {                    // usulan yang sedang berjalan (atau null)
    "facilityId": "taman_bunga",
    "openedAt": 0, "closesAt": 0,
    "votes": { "namaakun": "yes" }   // kunci = nama akun huruf kecil
  },
  "lastResult": {                // hasil penutupan terakhir (atau null)
    "facilityId": "taman_bunga", "passed": true, "yes": 3, "no": 1, "closedAt": 0
  },
  "built": ["taman_bunga"]       // fasilitas yang sudah aktif di dunia
}
```

State room membawa `facilities: string[]` (id fasilitas aktif) —
append-only selama sesi room berjalan; klien membangun/membongkar model
3D dari state ini (`client/src/world/Fasilitas.ts`). Statistik, tally,
dan kabar **tidak** masuk state; mereka dikirim lewat pesan `city`
sesuai permintaan agar selalu segar dan tidak membebani sinkronisasi.
