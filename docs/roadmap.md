# Roadmap — KOTA KITA

Prinsip: setiap tahap harus **bisa dijalankan & diuji** sebelum tahap berikutnya dimulai. Tidak ada tahap yang "sekalian banyak".

## Tahap 1 — Prototype Plaza (SAAT INI)

- [x] Dokumen: GDD, art style & peta, arsitektur, desain avatar, roadmap
- [x] Struktur folder client/server sesuai rencana
- [x] Plaza 3D pertama: tanah, plaza melingkar, air mancur, ruko, balai kota mini, pohon, lampu, bangku
- [x] Avatar primitif + kustomisasi warna dasar + label nama
- [x] Kontrol Android: joystick, tombol lompat/lari/interaksi/emote/chat/foto, kamera geser
- [x] Fondasi multiplayer Colyseus: room "kota", gerak otoritatif server, chat, emote
- [x] Uji: build lolos + uji otomatis 2 klien + uji manual di HP *(uji manual di HP menunggu hosting publik — lihat Tahap 4; uji otomatis 2 klien LULUS 18 Nov 2026: sinkronisasi posisi 4,02 m & chat terbukti)*
- [x] Toggle siang/malam sederhana

**Selesai bila:** dua HP/PC di room yang sama bisa saling melihat, bergerak, chat, dan berfoto di plaza.

## Tahap 2 — Kota Terasa Hidup ✅ (SELESAI 18 Nov 2026)

- [x] Variasi avatar: gaya rambut & penutup kepala (pendek, panjang, hijab, peci, botak), warna rambut, model baju polos/batik
- [x] Emote pack: melambai, menari, duduk, tertawa, tepuk tangan (tersinkron via server)
- [x] Audio: ambience kota (angin + kicau burung), langkah kaki, efek UI — semua synth WebAudio buatan kode, tanpa file berlisensi
- [x] Objek interaktif bertambah: Warung Kopi (menu), Papan Pengumuman (agenda komunitas)
- [x] Penyesuaian performa otomatis (pixel ratio adaptif bila FPS rendah)
- [x] Tabrakan bangunan sederhana (AABB) di server & prediksi client — terbukti di uji otomatis (pemain tidak bisa menembus ruko)
- [ ] Tangga balai kota bisa dinaiki — ditunda: teras balai bisa dimasuki (AABB berhenti sebelum tangga), menaiki anak tangga butuh sistem ketinggian lantai; masuk Tahap 3

## Tahap 3 — Akun & Data Persisten ✅ (SELESAI 18 Nov 2026 — akun server sendiri, lihat docs/accounts.md)

- [x] Daftar/masuk dengan nama pengguna + kata sandi (hash scrypt + token sesi) — *penyimpangan sadar dari rencana Supabase: proyek Supabase harus milik user & belum ada; akun server sendiri memberi fitur yang sama dan TERUJI. Skema SQL + jalur migrasi Supabase siap di `docs/accounts.md`*
- [x] Profil tersimpan: nama, warna & gaya avatar, terakhir online — dimuat otomatis saat masuk lagi
- [x] Sistem teman (berbasis nama pengguna akun) & status online di room yang sama
- [x] Moderasi: lapor pemain (tersimpan di server + konteks chat), blokir pemain (lokal perangkat), log chat di server
- [ ] Menaiki tangga balai kota (sistem ketinggian lantai) — diwariskan dari Tahap 2, belum dikerjakan

## Tahap 4 — Siap Publik (SEBAGIAN BESAR SELESAI 18 Nov 2026 — go-live menunggu akun hosting user)

- [x] Paket deploy lengkap: server menyajikan website+game+akun dalam SATU alamat (mode produksi teruji lokal), `Dockerfile`, `render.yaml`, panduan go-live `docs/deployment.md` — *deploy awan sebenarnya menunggu user membuat akun GitHub + Render atas namanya (±15 menit, dipandu Lea)*
- [x] Rate-limit & proteksi diperketat: batas pesan WebSocket 64 KB, jeda emote 600 ms, rate-limit chat 800 ms, rate-limit endpoint akun, room maks. 50 klien
- [x] Multi-room: pemain ke-51 otomatis masuk Plaza berikutnya (perilaku matchmaking Colyseus, terverifikasi konsepnya lewat uji beban 50 klien tepat memenuhi satu room)
- [ ] Kawasan baru: Pasar & Pantai (satu per sub-tahap, masing-masing wajib lolos uji) — sub-tahap berikutnya
- [x] Uji beban 50 klien/room LULUS (50 klien masuk 569 ms, sinkronisasi mengalir, server sehat) — uji HP rendah (RAM 3 GB) dilakukan setelah go-live dari HP user

## Tahap 5 — Komunitas

- Event terjadwal (kumpul komunitas, foto bersama, parade avatar)
- Quest sosial ringan (kunjungi 3 tempat, sapa 5 pemain) — tanpa grind
- Galeri foto dalam game dari mode foto pemain
- Kosmetik musiman bertema Indonesia (HUT RI, Ramadan, tahun baru) — tetap tanpa pay-to-win

## Di Luar Roadmap (keputusan sadar)

- Tidak ada combat/PvP, tidak ada mata uang berbayar di tahap awal, tidak ada NFT/kripto, tidak ada iklan di dalam dunia untuk anak.
