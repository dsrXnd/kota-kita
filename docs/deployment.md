# Panduan Go-Live — KOTA KITA (Tahap 4)

Tujuan: game bisa dibuka dari HP mana pun lewat satu alamat internet, misalnya
`https://kota-kita.onrender.com`. Website, akun, dan server multiplayernya
**satu paket di satu tempat** — tidak ada pengaturan alamat terpisah.

Yang sudah disiapkan Lea (selesai & teruji lokal):
- Server game sekarang juga menyajikan websitenya (mode produksi satu alamat).
- `Dockerfile` — resep kemasan resmi proyek (dipakai semua hosting modern).
- `render.yaml` — cetak biru agar Render membuat layanan otomatis.
- Pengamanan diperketat: batas ukuran pesan WebSocket 64 KB, jeda emote anti-spam,
  rate-limit chat & endpoint akun (dari tahap sebelumnya).
- Uji beban 50 pemain serentak: lulus di mesin pengembangan.

Yang hanya bisa dilakukan pemilik (kamu), karena akun hosting harus atas namamu:
membuat akun GitHub + Render dan menekan tombol deploy. Perkiraan total ±15 menit dari HP.

---

## Langkah 1 — Buat akun GitHub (tempat menyimpan kode)

1. Buka Chrome → `github.com/signup`
2. Isi email aktifmu, buat kata sandi, pilih nama pengguna → verifikasi email (kode dikirim ke emailmu).
3. Setelah masuk, buat tempat kode baru: tombol **+** (kanan atas) → **New repository**
   → nama: `kota-kita` → pilih **Public** → **Create repository**.
4. Di halaman repo kosong itu, pencet tautan **uploading an existing file**.
5. Unggah isi proyek dari file zip terbaru yang Lea berikan (ekstrak dulu zip-nya di HP,
   lalu unggah semua file & foldernya — termasuk `Dockerfile` dan `render.yaml`).
   > Ini langkah paling makan waktu dari HP. Lakukan per folder bila perlu.
   > Yang TIDAK perlu diunggah: folder `node_modules`, `dist`, dan `server/data` (memang tidak ada di zip).

## Langkah 2 — Deploy di Render (tempat game menyala)

1. Buka `render.com` → **Get Started** → daftar **pakai akun GitHub** tadi (paling gampang).
2. Di dashboard Render: **New +** → **Blueprint** → pilih repo `kota-kita` → **Apply**.
   Render membaca `render.yaml` + `Dockerfile` dan membangun game-mu sendiri (±5–10 menit).
3. Setelah statusnya **Live**, alamat gamemu muncul di halaman layanan, bentuknya
   `https://kota-kita.onrender.com` — **itulah alamat gamenya.** Buka dari Chrome HP:
   layar mulai muncul = berhasil. Masuk sebagai Tamu dulu untuk tes cepat, jalan-jalan,
   lalu coba Daftar akun.

## Yang perlu diketahui tentang paket GRATIS Render (jujur)

- Layanan **tidur setelah ±15 menit tidak ada pengunjung**; pengunjung berikutnya
  menunggu **±1 menit** sampai layanan bangun. Normal untuk uji coba & main bareng teman.
- **Data akun bisa ter-reset saat deploy ulang** di paket gratis (folder data tidak persisten).
  Untuk serius: naikkan paket berbayar termurah + tambahkan **Persistent Disk** yang
  dipasang ke `/app/data` di pengaturan layanan Render — setelah itu akun pemain aman permanen.
- Satu room menampung **maks. 50 pemain**; pemain ke-51 otomatis masuk Plaza kedua
  (room baru) — perilaku bawaan Colyseus, tidak perlu diatur.

## Alternatif lain (file proyek sudah siap untuk semuanya)

- **Railway** (railway.app): New Project → Deploy from GitHub repo → otomatis memakai `Dockerfile`.
- **Fly.io**: butuh aplikasi/komputer untuk perintah `fly launch` — kurang cocok dari HP.
- **Cloudflare Pages**: hanya untuk website statis. Bila suatu hari website dipisah ke sana,
  buka game dengan tambahan `?server=wss://alamat-servermu` di URL, atau simpan sekali
  lewat pengaturan di browser. Untuk sekarang **tidak perlu** — satu alamat Render sudah cukup.

## Kalau ada yang gagal

- Render gagal build → buka tab **Logs** di Render, screenshot baris merah terakhir, kirim ke Lea.
- Website terbuka tapi status "Offline" terus → berarti WebSocket tidak tersambung;
  pastikan alamat yang dibuka persis alamat layanan Render (https), lalu screenshot & kirim ke Lea.
- Lupa kata sandi GitHub/Render → pakai fitur lupa kata sandi di situs masing-masing;
  Lea tidak pernah memegang kata sandimu.
