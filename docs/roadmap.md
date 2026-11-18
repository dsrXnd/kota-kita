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
- [ ] Setiap akun punya **saldo KC** yang disimpan server (otoritatif: semua perubahan saldo terjadi & divalidasi di server, client hanya menampilkan) + catatan mutasi sederhana di data akun
- [ ] Saldo awal untuk akun baru + **bonus masuk harian** (klaim sekali per hari saat login)
- [ ] HUD menampilkan saldo; mode Tamu tidak punya saldo (harus daftar — mendorong registrasi, pola yang terbukti di game referensi)

**Pekerjaan sesi (disesuaikan untuk real-time, bukan sekadar timer pasif):**
- [ ] 3 pekerjaan pertama yang terikat tempat: **Penjaga Warung Kopi**, **Petugas Kebersihan Plaza**, **Kurir Paket Balai Kota** — mulai sif di lokasi, selesaikan aktivitas singkat di dunia (berdiri di pos / jangkau titik-titik tugas), terima gaji KC dari server
- [ ] Jeda antar-sif (cooldown) divalidasi server berdasarkan waktu & posisi — tidak bisa diakali dari client

**Selesai bila:** uji otomatis ekonomi LULUS — saldo bertambah dari gaji & bonus, saldo tetap ada setelah keluar-masuk lagi, sif ganda saat cooldown ditolak server, tamu tidak bisa menerima gaji — dan client dari alamat Pages bisa bermain melawan server uji.

## Tahap 6 — Kavling & Rumah Pribadi (Kampung Kita)

- [ ] Kawasan permukiman baru **Kampung Kita** menempel pada peta plaza: petak-petak kavling kosong bergrid (target awal ±24 kavling) dengan papan nomor
- [ ] Akun bisa **klaim 1 kavling** memakai KC; kepemilikan tersimpan persisten di server dan terlihat semua pemain (nama pemilik di papan rumah)
- [ ] Katalog rumah orisinal 3 tingkat (mis. Rumah Bambu, Rumah Batu, Rumah Tingkat) — dibangun seketika dari primitif bergaya art-style kita, lengkap dengan collider
- [ ] Tombol **"Ke Rumahku"** (teleport pulang) + pemain lain bisa berkunjung & melihat rumah dari luar
- [ ] Statistik awal: jumlah rumah berdiri terhitung di server (dipakai Tahap 8)

**Selesai bila:** uji otomatis LULUS — klaim kavling tersimpan & termuat lagi setelah server restart, klaim ganda atas petak yang sama ditolak, rumah pemain A terlihat benar oleh klien B, dan pemain tidak menembus rumah (collider aktif).

## Tahap 7 — Usaha Pemain (Pasar)

- [ ] Kawasan **Pasar** (dari daftar tunggu Tahap 4) berisi lapak-lapak yang bisa dimiliki akun memakai KC
- [ ] Pemilik lapak menjual barang sederhana (kopi, bakso, es teh, batik) dengan harga dalam rentang yang diatur sistem; pemain lain membeli lewat tombol interaksi → KC berpindah antar-akun secara atomik di server
- [ ] Penghasilan lapak terkumpul sebagai "kas usaha" yang diambil pemilik saat berkunjung (mendorong pemilik online & berinteraksi — kekuatan real-time kita)
- [ ] Peran sosial baru muncul alami: pedagang & pembeli bertemu langsung, bisa chat & tawar lewat chat

**Selesai bila:** uji otomatis LULUS — pembelian mengurangi saldo pembeli & menambah kas usaha pemilik dengan jumlah sama, pembelian saat saldo kurang ditolak, non-pemilik tidak bisa mengambil kas usaha, semua tercatat di mutasi.

## Tahap 8 — Kota Hidup: Statistik, Kabar & Voting

- [ ] **Panel Statistik Kota**: penduduk (total akun terdaftar), warga online sekarang, rumah berdiri, lapak aktif, kas kota (terisi dari biaya klaim & bangun)
- [ ] **Kabar Kota**: umpan pengumuman otomatis server di Papan Pengumuman & HUD — warga baru bergabung, rumah baru berdiri, hasil voting, fasilitas baru selesai
- [ ] **Voting usulan fasilitas**: usulan berkala (mis. Taman Bunga, Lapangan Futsal, Perpustakaan Mini) — 1 akun = 1 suara, jendela 24 jam, lolos bila suara setuju mencapai ambang minimal & lebih banyak dari menolak
- [ ] Fasilitas yang lolos **muncul di dunia** pada pemuatan berikutnya (aset disiapkan lebih dulu sebagai set fasilitas yang bisa diaktifkan server, lengkap dengan collider)

**Selesai bila:** uji otomatis LULUS — satu akun tidak bisa voting dua kali pada usulan yang sama, tally & penutupan 24 jam benar, fasilitas hasil voting aktif di state dan terlihat oleh klien lain, kabar kota tercatat untuk peristiwa-peristiwa kunci.

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
