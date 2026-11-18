# Roadmap — KOTA KITA

Prinsip: setiap tahap harus **bisa dijalankan & diuji** sebelum tahap berikutnya dimulai. Tidak ada tahap yang "sekalian banyak".

**Arah produk (diputuskan 18 Nov 2026):** KOTA KITA berkembang dari plaza sosial menjadi **kota virtual yang hidup** — warga punya saldo, pekerjaan, rumah pribadi, dan suara dalam pembangunan kota — sambil **mempertahankan keunggulan inti kita: multiplayer 3D real-time** (pemain saling melihat secara langsung). Inspirasi sistem datang dari pengamatan game kota virtual Indonesia lain (Republik Netizenia), tetapi **semua implementasi, aset, nama, dan angka adalah orisinal milik KOTA KITA** — tidak menjiplak desain, aset, atau data mereka. Perbedaan mendasar yang disadari: kota mereka persisten-asinkron sehingga cukup hosting statis; kota kita real-time sehingga tetap membutuhkan server game.

## Tahap 1 — Prototype Plaza ✅ (SELESAI 18 Nov 2026)

- [x] Dokumen: GDD, art style & peta, arsitektur, desain avatar, roadmap
- [x] Struktur folder client/server sesuai rencana
- [x] Plaza 3D pertama: tanah, plaza melingkar, air mancur, ruko, balai kota mini, pohon, lampu, bangku
- [x] Avatar primitif + kustomisasi warna dasar + label nama
- [x] Kontrol Android: joystick, tombol lompat/lari/interaksi/emote/chat/foto, kamera geser
- [x] Fondasi multiplayer Colyseus: room "kota", gerak otoritatif server, chat, emote
- [x] Uji: build lolos + uji otomatis 2 klien LULUS (sinkronisasi posisi 4,02 m & chat terbukti)
- [x] Toggle siang/malam sederhana

## Tahap 2 — Kota Terasa Hidup ✅ (SELESAI 18 Nov 2026)

- [x] Variasi avatar: gaya rambut & penutup kepala (pendek, panjang, hijab, peci, botak), warna rambut, model baju polos/batik
- [x] Emote pack: melambai, menari, duduk, tertawa, tepuk tangan (tersinkron via server)
- [x] Audio: ambience kota (angin + kicau burung), langkah kaki, efek UI — semua synth WebAudio buatan kode, tanpa file berlisensi
- [x] Objek interaktif bertambah: Warung Kopi (menu), Papan Pengumuman (agenda komunitas)
- [x] Penyesuaian performa otomatis (pixel ratio adaptif bila FPS rendah)
- [x] Tabrakan bangunan sederhana (AABB) di server & prediksi client — terbukti di uji otomatis
- [ ] Tangga balai kota bisa dinaiki — ditunda: butuh sistem ketinggian lantai; kini dijadwalkan di Tahap 9

## Tahap 3 — Akun & Data Persisten ✅ (SELESAI 18 Nov 2026)

- [x] Daftar/masuk dengan nama pengguna + kata sandi (hash scrypt + token sesi) di server game sendiri — *penyimpangan sadar dari rencana Supabase; skema SQL + jalur migrasi Supabase siap di `docs/accounts.md`*
- [x] Profil tersimpan: nama, warna & gaya avatar, terakhir online — dimuat otomatis saat masuk lagi
- [x] Sistem teman (berbasis nama pengguna akun) & status online di room yang sama
- [x] Moderasi: lapor pemain (tersimpan di server + konteks chat), blokir pemain (lokal perangkat), log chat di server

## Tahap 4 — Siap Publik ✅ (SELESAI di sisi kode 18 Nov 2026)

- [x] Paket deploy lengkap: server menyajikan website+game+akun dalam SATU alamat (mode produksi teruji lokal), `Dockerfile`, `render.yaml`, panduan `docs/deployment.md`
- [x] Repository GitHub publik: **dsrXnd/kota-kita** (42 file, terverifikasi) — kode aman & bisa di-deploy ulang kapan pun
- [x] Rate-limit & proteksi: batas pesan WebSocket 64 KB, jeda emote 600 ms, rate-limit chat 800 ms, rate-limit endpoint akun, room maks. 50 klien
- [x] Uji beban 50 klien/room LULUS (50 klien masuk 569 ms, sinkronisasi mengalir, server sehat)
- [x] Tes main online dari HP TERBUKTI lewat GitHub Codespaces (sesi sementara, port publik, halaman game + `/health` OK)
- [ ] **Go-live permanen** — satu-satunya sisa Tahap 4: semua platform server utama (Render, Northflank, Koyeb, Hugging Face) kini mewajibkan verifikasi kartu untuk akun baru; konfigurasi Render & Northflank sudah siap 100%, tinggal keputusan user menambah kartu (tahan verifikasi $1 di Render, bukan tagihan; paket tetap gratis). Jalur sementaranya: sesi Codespaces sesuai permintaan.
- [ ] Kawasan Pasar & Pantai — dipindah ke Tahap 9 (digabung dengan ekspansi distrik)

---

# ARAH BARU — Kota yang Hidup

## Tahap 5 — Alamat Publik & Ekonomi Dasar

**Alamat publik rapi (client di Cloudflare Pages):**
- [ ] Client (folder `client/dist`) dipasang ke **Cloudflare Pages** memakai akun Cloudflare user → alamat publik ala `kota-kita.pages.dev`, gratis tanpa kartu
- [ ] Client di Pages diarahkan ke server game lewat pengaturan alamat server yang SUDAH didukung sejak Tahap 4 (`?server=` / penyimpanan lokal) — tidak perlu mengubah arsitektur
- [ ] Uji: buka alamat Pages dari HP → tersambung ke server uji (Codespaces) → bisa masuk & bermain

**Ekonomi dasar — Koin Kota (KC):**
- [x] Setiap akun punya **saldo KC** yang disimpan server (otoritatif: semua perubahan saldo terjadi & divalidasi di server, client hanya menampilkan) + catatan mutasi sederhana di data akun
- [x] Saldo awal untuk akun baru + **bonus masuk harian** (klaim sekali per hari saat login)
- [x] HUD menampilkan saldo; mode Tamu tidak punya saldo (harus daftar — mendorong registrasi, pola yang terbukti di game referensi)

**Pekerjaan sesi (disesuaikan untuk real-time, bukan sekadar timer pasif):**
- [x] 3 pekerjaan pertama yang terikat tempat: **Penjaga Warung Kopi**, **Petugas Kebersihan Plaza**, **Kurir Paket Balai Kota** — mulai sif di lokasi, selesaikan aktivitas singkat di dunia (berdiri di pos / jangkau titik-titik tugas), terima gaji KC dari server
- [x] Jeda antar-sif (cooldown) divalidasi server berdasarkan waktu & posisi — tidak bisa diakali dari client

**Selesai bila:** uji otomatis ekonomi LULUS — saldo bertambah dari gaji & bonus, saldo tetap ada setelah keluar-masuk lagi, sif ganda saat cooldown ditolak server, tamu tidak bisa menerima gaji — dan client dari alamat Pages bisa bermain melawan server uji.

## Tahap 6 — Kavling & Rumah Pribadi (Kampung Kita)

*Spek harga & keuntungan DIKUNCI user 18 Nov 2026 (dihitung terhadap ekonomi Tahap 5: saldo awal 500 KC, bonus harian 100 KC, gaji pekerjaan 150–250 KC).*

- [x] Kawasan permukiman baru **Kampung Kita** menempel pada peta plaza: **24 kavling** bergrid dengan papan nomor — **16 Kavling 1** (barisan dalam) + **8 Kavling 2** (pinggir jalan utama dekat gerbang plaza, petak lebih luas)
- [x] Akun bisa **klaim 1 kavling** memakai KC; kepemilikan tersimpan persisten di server dan terlihat semua pemain (nama pemilik di papan rumah); klaim atas petak yang sudah dimiliki ditolak server
- [x] **Harga kavling (keputusan user):** Kavling 1 = **2.500 KC** (cukup untuk Rumah Bambu & Batu) · Kavling 2 = **5.000 KC** (lokasi strategis paling sering dilewati pemain; satu-satunya yang boleh dibangun Rumah Tingkat; muat halaman/taman depan)
- [x] Katalog rumah orisinal 3 tingkat — dibangun seketika dari primitif bergaya art-style kita, lengkap dengan collider; upgrade cukup membayar selisih harga:
  - **Rumah Bambu — 2.000 KC**: rumah pertama; mengaktifkan tombol "Ke Rumahku", titik istirahat/respawn pribadi
  - **Rumah Batu — 5.000 KC**: permanen & lebih lega, kapasitas tamu lebih banyak, bisa memasang taman kecil
  - **Rumah Tingkat — 7.500 KC** (khusus Kavling 2): 2 lantai + balkon, kapasitas tamu terbanyak, trofi prestise warga; kandidat fitur sewa kamar di tahap lanjutan (belum dijanjikan)
- [x] Tombol **"Ke Rumahku"** (teleport pulang) + pemain lain bisa berkunjung & melihat rumah dari luar
- [x] Statistik awal: jumlah rumah berdiri terhitung di server (dipakai Tahap 8)

**Selesai bila:** ✅ TERBUKTI `test:plots` (18 Nov 2026) — klaim kavling tersimpan & termuat lagi setelah server restart, klaim ganda atas petak yang sama ditolak, klaim dengan saldo kurang ditolak, Rumah Tingkat ditolak di Kavling 1, rumah pemain A terlihat benar oleh klien B, dan pemain tidak menembus rumah (collider aktif).

## Tahap 6B — Kebutuhan Hidup, Pekerjaan Baru & Waktu Dunia

*Spek DIKUNCI user 18 Nov 2026. Dibangun setelah Tahap 6 karena rumah adalah "markas gratis" untuk kebutuhan dasar.*

**Bonus check-in streak (mengubah bonus Tahap 5 — keputusan user 18 Nov 2026):**
- [x] Bonus harian rata 100 KC **DIGANTIKAN** sistem streak check-in (bukan tambahan): klaim beruntun per hari kalender Asia/Jakarta — Hari 1: **10 KC**, Hari 2: **20**, Hari 3: **30**, Hari 4: **40**, Hari 5: **50**, Hari 6: **60**, Hari 7: **150 KC** (jackpot mingguan; total 360 KC/minggu); kelewat 1 hari → hitungan **kembali ke Hari 1**; siklus 7 hari berulang

**Waktu dunia (menggantikan toggle siang/malam manual):**
- [x] Siklus siang-malam diatur **server** dan sama untuk semua pemain: **1 hari game = 24 menit asli (16 menit siang, 8 menit malam)** — keputusan user: siklus cepat

**Kebutuhan hidup (3 meter di HUD: 🍗 Lapar · 💧 Haus · 🚽 Kebelet):**
- [x] Meter berkurang perlahan **hanya selama bermain** (±50 menit dari penuh ke kosong); tidak berkurang saat offline; peringatan di 25%
- [x] Prinsip desain: **selalu ada jalur gratis** — yang berbayar adalah jalur instan/nyaman; pemain tidak boleh terkunci dari bermain karena miskin KC
  - 💧 Haus: air mineral **10 KC** di warung/lapak · **gratis** di air mancur plaza
  - 🍗 Lapar: jajanan **20 KC**, makan besar **45 KC** (penuh) · **gratis** masak di rumah sendiri
  - 🚽 Kebelet: WC umum Balai Kota **gratis** · WC bersih instan dekat plaza **5 KC** · gratis di rumah sendiri
- [x] Efek kritis ringan (tanpa kematian): kecepatan lari turun & tidak bisa memulai sif kerja sampai kebutuhan teratasi
- [x] Di Tahap 7 kebutuhan ini menjadi permintaan bagi lapak pemain (makan di lapak pemain lain = KC berpindah ke pemilik) — *selesai di Tahap 7*

**Pekerjaan baru (melengkapi 3 pekerjaan Tahap 5):**
- [x] 🌷 **Petugas Taman — 170 KC**: datangi & siram 6 titik tanaman keliling plaza/taman
- [x] 🛵 **Ojek Makanan — 220 KC**: ambil makanan dari toko acak, antar ke titik tujuan acak dalam 120 detik
- [x] 🌙 **Satpam Malam — 250 KC**: jaga area Balai Kota 60 detik terakumulasi; sif hanya bisa diambil saat **malam server**

**Cooldown per pekerjaan (keputusan user, menggantikan rata 10 menit Tahap 5; tetap berjalan saat offline & tersimpan di server):**
- [x] Penjaga Warung Kopi **90 menit** · Petugas Taman **120 menit** · Petugas Kebersihan **120 menit** · Kurir Paket **120 menit** · Ojek Makanan **145 menit** · Satpam Malam **150 menit**

**Sistem skip cooldown berbayar (keputusan user):**
- [x] Pemain memegang maksimal **2 pekerjaan aktif** sekaligus, dan dua-duanya tidak boleh sama-sama pekerjaan antar (Kurir + Ojek ditolak server)
- [x] Dari 2 pekerjaan yang diambil, pemain punya **3 attempt skip cooldown per hari** (jatah bersama, reset harian bareng bonus harian, zona Asia/Jakarta): membayar biaya per pekerjaan untuk mengambil lagi pekerjaan yang sedang cooldown — Penjaga **60 KC**, Taman **70 KC**, Kebersihan **80 KC**, Kurir **90 KC**, Ojek **110 KC**, Satpam **125 KC** (40–50% dari gaji; biaya **terbakar** dari peredaran KC)
- [x] Biaya skip **hangus** bila sif dibatalkan atau gagal; peringatan ditampilkan jelas di client sebelum pembayaran dikonfirmasi

**Selesai bila:** ✅ TERBUKTI `test:6b` (18 Nov 2026) — meter hanya berkurang saat bermain & jalur gratis berfungsi, efek kritis diterapkan server, cooldown per pekerjaan sesuai tabel & bertahan setelah relogin, skip berbayar mengurangi saldo + jatah attempt dengan benar (attempt ke-4 ditolak, skip tanpa saldo ditolak), dua pekerjaan antar bersamaan ditolak, Satpam ditolak saat siang server — plus regresi penuh tetap hijau.

## Tahap 7 — Usaha Pemain (Pasar)

- [x] Kawasan **Pasar** (dari daftar tunggu Tahap 4) berisi lapak-lapak yang bisa dimiliki akun memakai KC — **harga lapak DIKUNCI user 18 Nov 2026: 10.000 KC** (satu-satunya aset produktif: menghasilkan KC dari penjualan ke pemain lain)
- [x] Pemilik lapak menjual barang sederhana (kopi, bakso, es teh, batik) dengan harga dalam rentang yang diatur sistem; pemain lain membeli lewat tombol interaksi → KC berpindah antar-akun secara atomik di server
- [x] Penghasilan lapak terkumpul sebagai "kas usaha" yang diambil pemilik saat berkunjung (mendorong pemilik online & berinteraksi — kekuatan real-time kita)
- [x] Peran sosial baru muncul alami: pedagang & pembeli bertemu langsung, bisa chat & tawar lewat chat

**Selesai bila:** ✅ TERBUKTI `test:market` (18 Nov 2026) — pembelian mengurangi saldo pembeli & menambah kas usaha pemilik dengan jumlah sama, pembelian saat saldo kurang ditolak, non-pemilik tidak bisa mengambil kas usaha, semua tercatat di mutasi (ledger pembeli & log penjualan pemilik), kas tetap privat di luar state, dan semuanya persisten setelah server restart.

## Tahap 8 — Kota Hidup: Statistik, Kabar & Voting

- [x] **Panel Statistik Kota**: penduduk (total akun terdaftar), warga online sekarang, rumah berdiri, lapak aktif, kas kota (terisi dari biaya klaim & bangun)
- [x] **Kabar Kota**: umpan pengumuman otomatis server di Papan Pengumuman & HUD — warga baru bergabung, rumah baru berdiri, hasil voting, fasilitas baru selesai
- [x] **Voting usulan fasilitas**: usulan berkala (mis. Taman Bunga, Lapangan Futsal, Perpustakaan Mini) — 1 akun = 1 suara, jendela 24 jam, lolos bila suara setuju mencapai ambang minimal & lebih banyak dari menolak
- [x] Fasilitas yang lolos **muncul di dunia** — ternyata bahkan lebih baik dari bunyi awal: tampil **langsung di tengah sesi** untuk semua klien yang sedang online (aset disiapkan lebih dulu sebagai set fasilitas yang bisa diaktifkan server, lengkap dengan collider)

**Selesai bila:** ✅ TERBUKTI `test:city` (18 Nov 2026) — statistik tepat (kas kota 14.500 = klaim kavling 2.500 + bangun rumah 2.000 + klaim lapak 10.000), kabar tercatat untuk registrasi/rumah/lapak & persisten setelah restart, satu akun tidak bisa voting dua kali pada usulan yang sama (suara final), tamu ditolak, tally 3 setuju/1 tolak menutup LOLOS & 1 setuju/2 tolak menutup GAGAL (fasilitas gagal ke belakang antrean), fasilitas hasil voting aktif di state dan terlihat oleh klien lain, collider fasilitas menahan pemain, dan lokasi fasilitas bebas dilewati sebelum aktif. Detail: `docs/city.md`.

## Tahap 9 — Ekspansi & Komunitas

- [ ] Kawasan **Pantai** (dari daftar tunggu Tahap 4) sebagai distrik rekreasi kedua
- [ ] Sistem ketinggian lantai → **tangga Balai Kota bisa dinaiki** (utang dari Tahap 2) dan atap/balkon bisa dikunjungi
- [ ] Event terjadwal komunitas (kumpul & foto bersama, parade avatar) memakai Kabar Kota Tahap 8
- [ ] Quest sosial ringan (kunjungi 3 tempat, sapa 5 pemain, kerja 1 sif) berhadiah KC kecil — tanpa grind
- [ ] Galeri foto dalam game dari mode foto pemain
- [ ] Kosmetik musiman bertema Indonesia (HUT RI, Ramadan, tahun baru) — tetap tanpa pay-to-win

**Selesai bila:** setiap sub-fitur di atas lolos uji otomatisnya masing-masing + regresi penuh (2 klien, akun, ekonomi, kavling, usaha, voting) tetap hijau.

## Jalur Lintas Tahap (berjalan paralel, bukan tahap tersendiri)

- **Hosting permanen:** keputusan kartu user (Render/Northflank siap) — begitu aktif, alamat Pages Tahap 5 diarahkan ke server permanen dan uji HP RAM 3 GB dilakukan dari HP user
- **Data jangka panjang:** bila jumlah akun & data ekonomi membesar, migrasi penyimpanan ke Supabase mengikuti skema siap pakai di `docs/accounts.md` (klien hanya memegang kunci publik anon, tidak ada kunci rahasia di frontend)
- **Performa Android:** anggaran tetap — draw call rendah, pixel ratio adaptif, uji berkala di kelas Galaxy M20

## Di Luar Roadmap (keputusan sadar)

- Tidak ada combat/PvP, tidak ada mata uang berbayar di tahap awal, tidak ada NFT/kripto, tidak ada iklan di dalam dunia untuk anak.
- Tidak menjiplak aset, desain, nama, teks, atau angka dari game referensi mana pun — yang diadopsi hanyalah *jenis sistem permainannya*, dengan rancangan orisinal.
