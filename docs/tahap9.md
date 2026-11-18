# Tahap 9 — Ekspansi & Komunitas

Tahap terakhir roadmap v2: distrik **Pantai** di barat, **sistem ketinggian
lantai** yang akhirnya membuat tangga Balai Kota bisa dinaiki (**Teras Atas
Balai Kota**), **event komunitas terjadwal**, **quest sosial harian**,
**galeri foto dalam game**, dan **kosmetik musiman** bertema Indonesia.

Semua angka bersama (batas dunia, zona ketinggian, collider) hidup di satu
modul server `server/src/world/world.ts` dan cermin client
`client/src/world/Heights.ts` — keduanya HARUS selalu sama, seperti pola
collider tahap-tahap sebelumnya. Uji otomatis: `server/test/tahap9.mjs`
(`npm run test:9`, mengelola server sendiri di port 2581 + folder data
sementara + konfigurasi lingkungan).

---

## 1. Pantai (distrik rekreasi barat)

Batas dunia barat diperluas: `BOUND_MIN_X` **−42 → −112** (server & client).
Fasilitas barat yang sudah ada (Taman Bunga −36,−32; Lapangan Futsal −36,32;
Perpustakaan Mini −24,−39) tidak berubah tempat maupun collider-nya.

| Elemen | Denah |
|---|---|
| Jalan masuk | Celah pagar barat plaza di x −45, z −4..4 (pagar lama dipecah dua ruas) → jalan setapak batu z −2..2 ke barat |
| Hamparan pasir | x −82..−44, z −34..34, tinggi tanah 0 — bebas dijelajahi |
| Garis pantai | x = −80; pemain tertahan di **x −79.65** oleh collider air `[-112, -80, -70, 90]` |
| Air | Bidang visual x −114..−80 (naik-turun halus ±0.03 m + buih ombak menyapu tepi) — **tidak ada sistem berenang** |
| Gubuk pantai | 2 buah di (−50, −12) & (−50, 14), jejak 3 × 2.5 m (collider di `WORLD_BOXES`) |
| Lainnya | 6 palem, 4 payung pantai + handuk, dermaga kayu VISUAL menjorok ke air (pemain tidak berjalan di atasnya) |
| Interaksi | Titik info "Pantai Kota Kita" di (−58, 0), radius 7 |

Performa: geometri & material dipakai ulang antar objek sejenis; total mesh
kawasan ±60 tanpa cahaya tambahan; kamera bayangan matahari diperluas ke
barat (left −125).

## 2. Sistem ketinggian lantai & Teras Atas Balai Kota

### Denah zona (satu-satunya kawasan bertingkat saat ini)

| Zona | Jenis | Rect (x, z) | Tinggi |
|---|---|---|---|
| Dek Teras Atas | datar | x −7..7, z −28.5..−23.5 | 3 m |
| Tangga besar | ramp (sumbu z) | x −2..2, z −23.5..−17.5 | 0 m di z −17.5 → 3 m di z −23.5 (lereng 0.5) |

Dek menempel di muka Balai Kota (gedung di (0, −33), muka z −28.5). Visual
client: pelat dek (atas tepat 3.0 m), 10 anak tangga (turun 0.3 m & maju
0.6 m per anak), pagar kayu di semua tepi dek kecuali bukaan tangga
(x −2..2), dan 4 tiang penyangga 0.5 × 0.5 m di (±6.75, −28.25) &
(±6.75, −23.75).

### Semantik `groundHeight` vs `floorHeight`

- `groundHeight(x, z)` — fungsi MURNI denah: tinggi zona tertinggi yang
  memuat titik itu (ramp diinterpolasi), bawaan 0.
- Gerak pemain memakai `floorHeight(x, z, feetY)` — lantai EFEKTIF: zona
  tertinggi yang tingginya ≤ `feetY + STEP_UP` (`STEP_UP = 0.55` m). Inilah
  kuncinya:
  - Pemain tanah (kaki 0) berjalan **di bawah dek** — lantai dek (3 m)
    bukan lantainya, melainkan langit-langit.
  - Pendaki ramp mengikuti lereng karena selisih tinggi per tick kecil.
  - Pemain di dek yang melangkah keluar tepi: lantai efektifnya jatuh ke
    tanah (selisih 3 m > STEP_UP) → **gravitasi menjatuhkannya**, tidak
    pernah melayang.
- Lompat & gravitasi bekerja RELATIF ke lantai setempat; animasi
  "di udara" juga diukur relatif ke lantai (pemain di dek bisa beremote
  normal).
- Interaksi tanah Balai Kota (WC umum gratis, pos Satpam, titik ambil
  Kurir — semuanya cek jarak 2D) tetap bekerja dari tanah di bawah dek
  maupun dari atas dek.

### Collider tergating ketinggian

Kotak tabrakan boleh punya 2 angka tambahan `[minX, maxX, minZ, maxZ,
minFeetY, maxFeetY]`: kotak hanya berlaku bila tinggi kaki pemain di
rentang `[minFeetY, maxFeetY)`. Kotak 4 angka (semua kotak lama) berlaku
di semua ketinggian — perilaku lama tidak berubah.

Kotak Tahap 9 (`WORLD_BOXES`, server + cermin client):

| Kotak | Gating | Guna |
|---|---|---|
| `[-112, -80, -70, 90]` | semua | Air pantai (garis pantai) |
| 2 gubuk pantai | semua | Jejak gubuk |
| 4 tiang dek 0.5 × 0.5 | semua | Tiang penyangga (pemain tanah menabrak tiang, bukan pagar) |
| Pagar selatan dek: `[-7,-2,…]` & `[2,7,…]` z −23.9..−23.5 | kaki ≥ 1.5 | Menyisakan bukaan tangga x −2..2 |
| Pagar timur `[6.6,7,…]` & barat `[-7,-6.6,…]` z −28.5..−23.5 | kaki ≥ 1.5 | Tepi dek |
| Muka gedung `[-7.5, 7.5, -37.5, -28.5]` | kaki ≥ 1.5 | Pemain dek tidak masuk badan gedung (pemain tanah diatur collider balai lama) |

### Yang TIDAK berubah

- Balkon Rumah Tingkat tetap **visual saja** tahap ini (tidak ada zona
  ketinggian di Kampung Kita) — dinaiki/dijelajahi belum didukung.
- Semua collider & interaksi tahap sebelumnya utuh; pagar dek tidak
  pernah menahan pemain tanah (terbukti di uji).

## 3. Event Komunitas

Server-driven, berputar terus (modul `server/src/city/city.ts`):

| Aturan | Nilai |
|---|---|
| Panjang siklus | 30 menit asli (konfigurasi `KOTA_EVENT_MINUTES`, desimal boleh) |
| Jendela aktif | 1/6 awal siklus (bawaan 5 menit), minimum 3 detik |
| Siklus genap | 📸 **Kumpul & Foto Bersama** — air mancur plaza (0, 0), radius 8 |
| Siklus ganjil | 🎉 **Parade Avatar** — tengah plaza (0, 0), radius 15 |
| Hadiah | **Tidak ada KC** — jalur hadiah harian adalah quest sosial |

Alur: aktivasi siklus baru → state room mengisi `eventType`, `eventName`,
`eventEndsAt`; Kabar Kota mencatat pembukaan + broadcast `city_event`
(toast semua pemain); client menampilkan **banner HUD** berisi nama event
& hitung mundur. Selama aktif, kehadiran dicicipi dari loop kota (±1
detik): hanya pemain **berakun** unik di dalam zona yang dicatat (tamu
tidak dihitung). Saat jendela berakhir → Kabar Kota merangkum
"Event … selesai — dihadiri N warga". Event yang sudah berjalan saat
server menyala dimuat apa adanya tanpa pengumuman ulang.

## 4. Quest Sosial Harian

Khusus warga berakun; reset tiap hari kalender Asia/Jakarta; kemajuan
persisten per akun di `economy.quests` (diatur ulang otomatis saat kunci
hari berganti). Hadiah dibayar SEKETIKA saat target tercapai lewat jalur
kredit store yang sama seperti gaji (`applyDelta` + catatan ledger
"Quest harian: …"), paling banyak sekali per quest per hari. Client
menampilkan ketiganya di panel 💼 (seksi 📜 Quest Harian) dengan kemajuan
(2/3) & status selesai, dari payload `jobs_get` (ditambah balasan
`quests_get` dan pesan dorong `quest_update`).

**Hadiah di bawah ini adalah keputusan user (koreksi 18 Nov 2026)** —
menggantikan angka draf awal (30/50/40):

| Quest | Target | Hadiah |
|---|---|---|
| 🗺️ Jelajah Kota | Kunjungi 3 zona BERBEDA dalam sehari | **25 KC** |
| 👋 Sapa Warga | Emote wave dalam 6 m dari 5 warga BERAKUN berbeda (yang sama dihitung 1×/hari; tamu tidak dihitung sebagai pemberi maupun target) | **10 KC** |
| 💼 Kerja Keras | Selesaikan 1 sif pekerjaan apa pun | **5 KC** |

Zona Jelajah Kota (pusat, radius): Plaza Utama (0, 0, r12) · Balai Kota
(0, −27, r8) · Kampung Kita (90, 0, r20) · Pasar (0, 52, r14) · Pantai
(−62, 0, r16). Hook server: pencicipan posisi di tick kota (jelajah),
handler emote (sapa), dan jalur penyelesaian sif `finishShift` (kerja).

## 5. Galeri Foto (perangkat-lokal)

Mode foto (📸) tetap mengunduh PNG seperti sebelumnya, dan SEKARANG juga
menyimpan salinannya ke **IndexedDB perangkat pemain**
(`client/src/interface/Gallery.ts`: database `kota-kita-gallery`, store
`photos`, rekaman `{id: cap waktu, ts, dataUrl}`).

Panel 🖼️ di bar atas: daftar thumbnail terbaru-di-depan; ketuk satu foto
→ tampilan layar penuh dengan tombol **Unduh** & **Hapus** (hapus =
terhapus dari IndexedDB). Semua operasi fail-soft: IndexedDB tidak
tersedia/gagal → galeri kosong tanpa error dan unduhan mode foto tetap
bekerja. **Foto hanya hidup di perangkat pemain — tidak ada unggahan ke
server sama sekali**; menghapus data situs di browser menghapus galeri.

## 6. Kosmetik Musiman

Tiga gaya baju baru (tekstur canvas prosedural seperti batik, di
`client/src/avatar/Avatar.ts`): 🇮🇩 `merahputih`, 🌙 `koko`, 🎉 `pesta`.
Gratis, tanpa pay-to-win — yang diatur hanya WAKTU pemilihannya. Server
adalah otoritasnya (`server/src/economy/seasons.ts`, satu tabel):

| Gaya | Musim | Jendela (tanggal Asia/Jakarta) |
|---|---|---|
| `merahputih` | HUT RI | 14–20 Agustus, setiap tahun |
| `pesta` | Tahun Baru | 29 Desember – 2 Januari, setiap tahun |
| `koko` | Ramadan | Tabel pendekatan Gregorian di bawah |

Jendela Ramadan adalah **PENDEKATAN** (bukan penetapan resmi pemerintah;
tanggal Hijriah bergeser ±11 hari/tahun dan perlu diperbarui manual):

| Tahun | Perkiraan Ramadan |
|---|---|
| 2026 | 18 Feb – 20 Mar |
| 2027 | 8 Feb – 9 Mar |
| 2028 | 28 Jan – 26 Feb |

Mekanisme gerbang:

- State room memuat `seasonStyle` + `seasonLabel`; endpoint publik
  baca-saja `GET /season` memberi tahu layar mulai (editor avatar tampil
  sebelum masuk room).
- Editor client hanya MENAWARKAN chip gaya musiman yang sedang aktif.
- Sanitasi profil server (`POST /auth/profile`): simpanan BARU gaya
  musiman di luar jendelanya jatuh ke **"polos"**; di dalam jendela
  diterima & persisten.
- Room saat join: gaya musiman diterima bila sedang musimnya ATAU memang
  sudah terpasang di profil akun — **yang sudah terpasang tetap terpasang
  setelah musim berakhir**; yang digerbang hanya tawaran editor & simpanan
  baru.
- Konfigurasi uji: `KOTA_SEASON_DATE=YYYY-MM-DD` menggeser "hari ini"
  server (hanya saat server menyala, seperti `KOTA_TIME_OFFSET_MIN`).

## 7. Bukti uji (server/test/tahap9.mjs)

Mengelola server sendiri (port 2581, data sementara,
`KOTA_EVENT_MINUTES=1`, `KOTA_SEASON_DATE` per fase) dan membuktikan:
lintasan tanah di bawah dek bebas pagar; naik ramp y≈3 terlihat klien
kedua; pagar menahan di atas dek; turun ramp y≈0; keluar sisi ramp =
jatuh; pasir Pantai dijelajahi & air menahan di x −79.65; Jelajah
membayar tepat +25 sekali (zona ke-4 gratis); event aktif di state,
akun tercatat & tamu tidak ("dihadiri 1 warga"); Kerja Keras +5 di atas
gaji 180; Sapa Warga: tamu 0, akun sama berulang 1, 5 akun berbeda +10;
ledger memuat mutasi 25/10/5; tamu tanpa quest; reset hari → quest nol &
bisa dibayar lagi; musim HUT RI terekspos & `merahputih` persisten; di
luar jendela simpanan disanitasi ke `polos`; Ramadan 2026 pendekatan
mengaktifkan `koko`. Galeri foto diverifikasi lewat build client bersih
+ peninjauan kode (IndexedDB tidak tersedia di lingkungan uji Node).
