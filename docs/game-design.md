# Game Design Document — KOTA KITA

Versi: 0.1 (Prototype) · Terakhir diperbarui: 18 Nov 2026
Status: Tahap 1 — Prototype Plaza

## 1. Ringkasan

**KOTA KITA** adalah dunia virtual sosial 3D multiplayer berbasis browser. Pemain membuat avatar, memasuki kota virtual bertema Indonesia modern, berjalan-jalan, bertemu pemain lain secara real-time, mengobrol, memakai emote, berinteraksi dengan objek, mengambil foto, dan mengikuti kegiatan komunitas.

- **Genre:** Social World / Virtual Hangout (tanpa combat, tanpa game-over)
- **Platform:** Website — Android, tablet, PC (browser modern dengan WebGL2)
- **Pemain:** Multiplayer real-time, target 20–50 pemain per room pada tahap awal
- **Sesi bermain:** 5–30 menit, drop-in/drop-out bebas
- **Monetisasi (rencana, belum diimplementasikan):** kosmetik avatar & item dekorasi — tidak ada pay-to-win karena tidak ada kompetisi inti

## 2. Visi & Pilar Desain

1. **Hangat dan ramah** — kota terasa seperti tempat nongkrong, bukan arena. Semua sistem menghindari hukuman dan kompetisi agresif.
2. **Indonesia terasa nyata** — arsitektur, vegetasi, makanan, kendaraan, dan ornamen khas Indonesia hadir sebagai identitas, bukan tempelan.
3. **Ringan di HP rakyat** — harus nyaman di Android kelas menengah (RAM 4 GB). Performa adalah fitur desain, bukan urusan belakangan.
4. **Sosial dulu, fitur kemudian** — chat, emote, dan kebersamaan lebih penting daripada sistem kompleks.

## 3. Target Pemain

- Usia 13+ (chat difilter dan dimoderasi dasar sejak hari pertama).
- Pemain kasual yang ingin bersosialisasi, roleplay ringan, dan eksplorasi.
- Komunitas (sekolah, kampus, fandom, RT/RW digital) yang ingin punya "tempat kumpul" virtual.

## 4. Core Loop

```
Masuk kota → jalan-jalan & eksplorasi → bertemu pemain → ngobrol/emote →
interaksi objek & foto → ikut kegiatan → kustomisasi avatar → kembali lagi besok
```

Tidak ada skor. Retensi dibangun dari: (a) kehadiran teman, (b) event terjadwal, (c) konten area baru, (d) ekspresi diri lewat avatar.

## 5. Fitur Inti (MVP Prototype — Tahap 1)

| # | Fitur | Status Tahap 1 |
|---|-------|----------------|
| 1 | Avatar 3D stylized, bisa ganti warna pakaian | ✅ Prototype (primitif 3D, warna kulit/baju/celana/rambut dasar) |
| 2 | Satu area: Plaza Utama | ✅ Prototype |
| 3 | Gerak: jalan, lari, lompat | ✅ |
| 4 | Joystick virtual + tombol sentuh (Android) | ✅ |
| 5 | Kamera third-person (geser sentuh / drag mouse) | ✅ |
| 6 | Multiplayer real-time (posisi, rotasi, animasi dasar) | ✅ Fondasi — wajib lolos uji 2 klien |
| 7 | Chat teks dengan bubble di atas kepala + panel chat | ✅ Fondasi (filter kata kasar dasar di server) |
| 8 | Emote/gesture: Lambaian (wave) | ✅ 1 emote; sisanya roadmap |
| 9 | Interaksi objek (air mancur, bangku, papan info) | ✅ Titik interaksi + panel info |
| 10 | Mode foto (simpan tangkapan layar) | ✅ Unduh PNG dari canvas |
| 11 | Siklus siang/malam (toggle) | ✅ Versi sederhana (pencahayaan) |
| 12 | Nama tampilan di atas avatar | ✅ |

## 6. Fitur Roadmap (bukan Tahap 1)

Lihat `roadmap.md` untuk fase lengkap. Ringkas: kawasan tambahan (Pasar, Pantai, Kampus, Stasiun), kustomisasi avatar penuh (wajah, rambut, pakaian, aksesori), kendaraan sederhana, mini-event komunitas, sistem teman & party, profil persisten (Supabase), moderasi lanjutan, emote pack, quest sosial ringan (bukan grind).

## 7. Kontrol

### Mobile (sentuh)
- **Joystick virtual** kiri bawah — arah gerak relatif terhadap kamera.
- **Geser layar kanan** — putar kamera (yaw & pitch).
- **Tombol kanan bawah:** Lompat (besar), Lari (toggle), Interaksi (muncul konteks), Emote, Chat, Foto (di bar atas/kanan).
- Semua tombol ≥ 56 px, area sentuh aman dari tepi layar & notch.

### Desktop
- WASD/panah = gerak, Shift = lari, Spasi = lompat, E = interaksi, Enter = chat, drag mouse = kamera, roda mouse = zoom (rencana Tahap 2 — prototype: drag saja).

## 8. Dunia & Area

Prototype hanya membangun **Plaza Utama** (± 90 × 90 m): lapangan terbuka melingkar, air mancur di tengah, dikelilingi ruko & gedung rendah bergaya Indonesia modern, pepohonan tropis, lampu taman, bangku, dan papan info. Detail konsep visual & peta: `art-style.md`. Area lain dikunci sebagai gerbang visual (terlihat, belum bisa dimasuki) agar kota terasa lebih besar tanpa biaya performa.

## 9. Avatar

Ringkasan: proporsi chibi-friendly (kepala besar ± 1:3,5 tinggi total), wajah sederhana ekspresif, kustomisasi warna sejak prototype. Spesifikasi lengkap: `avatar-design.md`.

## 10. Multiplayer & Sosial

- Arsitektur: server otoritatif untuk posisi (Colyseus room) — klien mengirim *input*, server mensimulasikan gerak dan menyiarkan state. Ini mencegah teleport/speed-hack sederhana sejak fondasi.
- Chat: maksimal 120 karakter, rate-limit di server, filter kata dasar, tanpa link aktif.
- Keamanan dasar: nama dibatasi 16 karakter alfanumerik dasar, tidak ada data pribadi di state publik selain nama tampilan & warna avatar.
- Detail teknis: `architecture.md`.

## 11. Audio (rencana Tahap 2)

Prototype belum memuat audio (folder `client/public/sounds/` disiapkan). Rencana: ambience kota (burung, lalu lintas jauh), langkah kaki, efek UI lembut, musik lo-fi opsional dengan tombol mute. Semua audio harus berlisensi bebas/buatan sendiri.

## 12. Metrik Keberhasilan Prototype

1. Build client & server lolos tanpa error.
2. Dua klien di room yang sama saling melihat pergerakan secara real-time (uji otomatis tersedia: `server/test/two-clients.mjs`).
3. Di Android kelas menengah: ≥ 30 FPS stabil di plaza, draw calls < 300, tidak ada tombol mati — setiap tombol di HUD punya fungsi nyata.
4. Pemain baru bisa bergerak & chat dalam < 60 detik sejak halaman dibuka.

## 13. Batasan & Non-Tujuan Prototype

- Bukan kota penuh; satu plaza saja.
- Bukan final art: bangunan & avatar dari primitif 3D terprogram (bukan model .glb final). Folder `client/public/models/` disiapkan untuk aset final.
- Belum ada akun persisten; nama tampilan disimpan lokal (localStorage). Supabase masuk Tahap 3 sesuai roadmap.
- Belum ada pembayaran, iklan, atau analitik pihak ketiga.
