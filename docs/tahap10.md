# Tahap 10 — Polesan Hasil Tes Main

Tahap ini lahir dari **tes main pertama oleh pemilik game** (18 Nov 2026).
Masalah utamanya: panel pekerjaan membingungkan — semua 6 pekerjaan bisa
diambil siapa saja, cooldown tidak terlihat jelas, tidak ada penunjuk arah
ke tujuan sif, dan tidak ada pemberitahuan hasil yang tegas. Tahap 10
memperbaikinya tanpa mengubah aturan ekonomi yang sudah dikunci.

## 1. Pilihan 2 pekerjaan (keputusan pemilik game)

Setiap akun kini **memilih tepat 2 pekerjaan** sebagai "pekerjaan saya" —
hanya dua itu yang bisa diambil siftnya.

- Pesan baru: `job_choose { jobIds }` → `job_choose_result { ok, charged, message }`.
- Validasi server: harus akun (tamu ditolak), tepat 2 id berbeda dan sah,
  dan **tidak boleh ada sif yang sedang berjalan**.
- **Pilihan pertama GRATIS.** Ganti pilihan sesudahnya: **500 KC**
  (konstanta `JOB_CHANGE_FEE` di `server/src/economy/economy.ts`), dipotong
  lewat jalur belanja resmi `AccountStore.spendKC` dan **TERBAKAR** — tidak
  masuk Kas Kota (perlakuan sama seperti biaya skip cooldown).
- Ganti ke himpunan yang sama ditolak tanpa biaya; saldo < 500 ditolak dan
  tidak ada yang berubah.
- `job_start` menolak pekerjaan di luar pilihan dengan pesan yang jelas
  ("Pilih dulu 2 pekerjaanmu di panel Pekerjaan" bila belum memilih;
  "Pekerjaan ini bukan pilihanmu" bila sudah memilih pekerjaan lain).
- **Cooldown menempel pada pekerjaan, bukan pada pilihan**: mengganti
  pilihan tidak pernah mereset cooldown pekerjaan mana pun (anti-celah —
  dibuktikan di `test:10`). Aturan lama tetap berlaku: maks 2 sif serentak,
  pasangan Kurir+Ojek tetap dilarang, cooldown per-pekerjaan tetap.
- Payload `jobs` kini memuat `chosenJobs`, `needsChoice` (true bila akun
  belum memilih), dan `changeFee: 500`.

Di klien, panel 💼 membuka **mode memilih** bila `needsChoice`: penjelasan
singkat, 6 baris pekerjaan yang bisa diketuk (maks 2), tombol "Simpan
Pilihan" (aktif hanya bila tepat 2). Di daftar normal, pekerjaan pilihan
bertanda 📌 "Pekerjaanmu", sisanya "Bukan pilihanmu" tanpa tombol mulai.
Tombol "Ganti Pilihan (500 KC)" membuka mode memilih lagi dengan pilihan
saat ini tercentang + peringatan biaya (dan konfirmasi sebelum mengirim).

## 2. Statistik pekerjaan per akun

Rekor ekonomi akun memuat `jobStats: { [jobId]: { done, failed, earned } }`:

- Sif **selesai** → `done + 1`, `earned += gaji pekerjaan itu saja`
  (KC quest tidak ikut dihitung di sini).
- Sif **gagal** (antar kelewat batas waktu) → `failed + 1`.
- Sif **dibatalkan** pemain → tidak mengubah statistik sama sekali.
- Statistik tampil di panel pekerjaan ("📊 Statistik Pekerjaan") untuk
  ke-6 pekerjaan + baris total, dan ikut di payload `jobs` sebagai `jobStats`.
- **Kejujuran data:** penghitungan dimulai sejak Tahap 10 — sif dari tahap
  sebelumnya tidak tercatat mundur (tidak ada riwayat yang bisa direka).

## 3. Tujuan sif (objective) & panah penunjuk

Setiap sif aktif di payload kini memuat `objective: { x, z, label }`,
dihitung server dari state otoritatif:

- Pekerjaan titik (Kebersihan, Taman): titik yang **belum dikunjungi
  terdekat** dari posisi pemain, label "Titik bersih-bersih n/N" /
  "Titik tanaman n/N".
- Pekerjaan jaga (Penjaga Warung Kopi, Satpam Malam): posisi pos jaga.
- Pekerjaan antar (Kurir, Ojek): titik ambil selama fase ambil
  ("Ambil: …"), lalu tujuan antar ("Antar: …").

Klien menampilkan **panah di tengah-bawah layar** selama ada sif aktif:
panah berputar mengikuti arah tujuan relatif terhadap kamera, disertai
label tujuan dan jarak dalam meter. Bila 2 sif aktif, yang ditunjuk adalah
tujuan **terdekat**. Panah sembunyi saat tidak ada sif.

## 4. Kartu hasil sif + reaksi avatar

Server mengirim pesan khusus `job_done { jobId, name, pay, cooldownMs, balance }`
saat sif selesai dan `job_failed { jobId, name, reason }` saat antar gagal.
Klien menampilkannya sebagai **kartu hasil** di tengah-atas (±6 detik atau
diketuk untuk menutup): berhasil = "+{gaji} KC 💪" + lama cooldown yang
dimulai; gagal = alasannya, dengan gaya warna berbeda. Bersamaan dengan
itu: suara synth berhasil/gagal diputar, dan avatar pemain bereaksi lewat
jalur emote biasa — berhasil → `clap` 👏, gagal → `sit` — sehingga pemain
lain ikut melihatnya.

## 5. Chip siang/malam

Chip kecil di kelompok HUD atas menampilkan fase dunia server —
"☀️ Siang · mm:ss" / "🌙 Malam · mm:ss" — hitung mundur ke pergantian fase
berikutnya (siklus penuh 24 menit nyata: 16 menit siang, 8 menit malam).
Chip diekstrapolasi lokal dari sinkronisasi `worldTime` berkala agar tetap
berdetak setiap detik tanpa membebani server.

## 6. Tutorial masuk kota

Overlay langkah-demi-langkah tampil **sekali per perangkat** (bendera
`localStorage` `kota-tutorial-done`) saat pemain pertama kali masuk dunia —
akun maupun tamu. Enam langkah singkat: gerak & kamera, interaksi,
pekerjaan (pilih 2 + ikuti panah), kebutuhan & jalur gratisnya, sosial &
quest sapa, foto & galeri. Bisa dilewati kapan saja ("Lewati"), ada
navigasi Lanjut/Kembali dan titik penanda langkah; dunia tetap terlihat di
baliknya. Tombol **❓** permanen di bar atas membuka tutorial lagi kapan pun.

## 7. Rapikan HUD

Kelompok kiri-atas disusun ulang menjadi tumpukan vertikal yang rapi
(status koneksi → chip pemain/saldo → chip jam dunia → strip kebutuhan),
memperbaiki tumpang-tindih teks status dengan strip kebutuhan yang terlihat
di tangkapan layar tes main. Bar ikon atas kini membungkus (wrap) dan
tombolnya sedikit lebih kecil di layar ≤480 px agar tidak bertabrakan di
layar HP ±360 px. Tidak ada tombol/panel yang berubah fungsi.

## Uji

- `npm run test:10` (`server/test/tahap10.mjs`, port 2582, folder data
  sementara sendiri): validasi `job_choose` (tamu/1/3/duplikat/id asing),
  pilihan pertama gratis, gerbang `job_start`, ganti pilihan (sama ditolak
  gratis; saldo 400 ditolak utuh; sah = tepat −500 & himpunan baru
  ditegakkan; ditolak saat sif berjalan), **cooldown tetap berjalan setelah
  ganti pergi & kembali**, statistik (selesai/gagal/batal), objective
  (titik kebersihan; kurir ambil → antar), payload tamu.
- Suite lama disesuaikan dengan gerbang pilihan (setiap akun pekerja memilih
  dulu; yang bekerja > 2 pekerjaan membayar ganti pilihan dan ekspektasi
  saldonya bergeser tepat −500 per ganti — dijelaskan di komentar tiap
  suite): `economy.mjs`, `tahap6b.mjs`, `tahap9.mjs`.
- Regresi penuh: build klien+server, 2 klien, akun, ekonomi, kavling, 6B,
  pasar, kota, tahap 9, tahap 10, beban 50.
