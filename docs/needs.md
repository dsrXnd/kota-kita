# Kebutuhan Hidup & Waktu Dunia · Tahap 6B

Dua sistem yang membuat kota terasa hidup: warga punya **kebutuhan dasar**
yang berkurang selama bermain, dan **waktu dunia diatur server** — siang
dan malam sama untuk semua pemain.

Kode terkait:

- `server/src/economy/economy.ts` — semua konstanta: laju meter, titik &
  harga isi ulang, definisi pekerjaan, dan jam dunia.
- `server/src/accounts/store.ts` — meter kebutuhan tersimpan per akun.
- `server/src/rooms/KotaRoom.ts` — pengurangan meter per tick, validasi
  isi ulang dari posisi otoritatif, efek kritis, dan sinkronisasi jam
  dunia ke state room.
- Uji otomatis: `server/test/tahap6b.mjs` (`npm run test:6b`).

## Tiga meter kebutuhan

| Meter | Laju berkurang | Penuh → kosong |
| --- | --- | --- |
| 🍗 Lapar (`hunger`) | 100 / 3.000 detik ≈ 0,0333/detik | ±50 menit bermain |
| 💧 Haus (`thirst`) | 100 / 2.700 detik ≈ 0,0370/detik | ±45 menit bermain |
| 🚽 Kebelet (`toilet`) | 100 / 3.300 detik ≈ 0,0303/detik | ±55 menit bermain |

Aturan mainnya:

- Meter mulai dari **100** dan **hanya berkurang saat pemain ada di dalam
  room** (sedang bermain). Tidak ada pengurangan saat offline — meter
  dimuat apa adanya saat pemain masuk lagi, dan disimpan berkala (±10
  detik) serta saat pemain keluar.
- Meter akun **persisten** (tersimpan di data akun). **Tamu** juga punya
  meter selama bermain, tetapi **hanya untuk sesi itu** — tidak disimpan
  dan mulai lagi dari 100 di sesi berikutnya.
- Server mengirim meter ke pemiliknya lewat pesan privat `needs` (dan
  atas permintaan `needs_get`); client menampilkannya sebagai strip
  ringkas di bawah bar atas + panel lengkap di panel 💼. Client tidak
  pernah menghitung meter sendiri.
- **Peringatan di ≤25%**: bilah berubah oranye dan client memberi tahu
  pemain (sekali setiap meter menembus ambang).
- **Efek kritis (ada meter yang 0) — ringan, tanpa kematian, tanpa denda:**
  1. **Lari dimatikan** — server membatasi kecepatan ke kecepatan jalan
     (4 m/detik) walaupun pemain menekan tombol lari.
  2. **`job_start` ditolak** sampai kebutuhan teratasi.
  Sif yang sedang berjalan **tidak** dibatalkan oleh meter kritis.

## Isi ulang — selalu ada jalur GRATIS

Prinsip desain (keputusan user): pemain tidak boleh terkunci dari bermain
karena miskin KC. Yang berbayar hanyalah jalur instan/nyaman. Semua aksi
dikirim lewat pesan `need_refill { action }` dan **divalidasi server dari
posisi otoritatif pemain** (dan saldo, lewat `spendKC`):

| Aksi | Meter | Efek | Harga | Tempat (validasi server) |
| --- | --- | --- | --- | --- |
| `drink_fountain` | 💧 Haus | → 100 | **Gratis** | Dalam 5 m dari Air Mancur Plaza (0, 0) |
| `drink_bottle` | 💧 Haus | → 100 | 10 KC | Depan Warung Kopi (−12, −25,2), radius 4,5 m |
| `eat_snack` | 🍗 Lapar | +60 (maks 100) | 20 KC | Depan Warung Kopi / Bakso & Mie (±, −25,2), radius 4,5 m |
| `eat_meal` | 🍗 Lapar | → 100 | 45 KC | Depan Warung Kopi / Bakso & Mie, radius 4,5 m |
| `cook_home` | 🍗 Lapar | → 100 | **Gratis** | Di dalam petak kavling sendiri **dan rumah sudah berdiri** |
| `wc_public` | 🚽 Kebelet | → 100 | **Gratis** | Area Balai Kota (0, −27), radius 6 m |
| `wc_paid` | 🚽 Kebelet | → 100 | 5 KC | Kios WC Bersih dekat plaza (6, 16), radius 4,5 m |
| `wc_home` | 🚽 Kebelet | → 100 | **Gratis** | Di dalam petak kavling sendiri **dan rumah sudah berdiri** |

Aksi berbayar dari sesi tamu ditolak (tamu tidak punya saldo) — jalur
gratis tetap terbuka untuk tamu.

## Waktu dunia (server)

- **1 hari game = 24 menit asli: 16 menit siang + 8 menit malam.**
  Menggantikan toggle siang/malam manual per-client dari tahap awal —
  tombol 🌙/☀️ di client sekarang hanya **indikator** jam server.
- Jam dihitung dari waktu epoch server: fraksi hari `worldTime` 0..1
  (0 = awal siang, 2/3 = awal malam) dan `isNight` disinkronkan ke
  **state room**, jadi semua klien menggambar langit yang sama. Client
  merender matahari/lampu dari kedua nilai itu.
- **Satpam Malam** hanya bisa *dimulai* saat `isNight` benar. Bila siang
  tiba di tengah sif Satpam, sif **dibiarkan selesai** (tidak dibatalkan).
- Konfigurasi pengujian: variabel lingkungan `KOTA_TIME_OFFSET_MIN`
  menggeser jam dunia (menit, boleh desimal/negatif) **saat server
  menyala** — hanya konfigurasi, bukan pesan/endpoint saat permainan
  berjalan. Uji `test:6b` memakainya untuk menempatkan jam di siang dan
  malam secara deterministik.

## Data akun (tambahan di `accounts.json`)

```ts
economy: {
  // …kolom Tahap 5…
  streakCount: number;   // hari check-in beruntun sampai klaim terakhir
  skipDay: string;       // hari jatah skip berlaku ("YYYY-MM-DD" Asia/Jakarta)
  skipUsed: number;      // attempt skip terpakai pada skipDay
  needs: { hunger: number; thirst: number; toilet: number }; // 0..100
}
```

Akun lama otomatis dilengkapi kolom ini dengan nilai bawaan (meter penuh,
streak 0) saat server menyala — tidak ada migrasi manual.
