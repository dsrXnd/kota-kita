# Ekonomi — Koin Kota (KC) · Tahap 5 + 6B

Sistem ekonomi KOTA KITA. Prinsip utamanya sama seperti akun di Tahap 3:
**server adalah satu-satunya otoritas**. Client tidak pernah menghitung,
menyimpan, atau mengubah saldo — client hanya menampilkan angka yang
dikirim server lewat pesan privat.

Kode terkait:

- `server/src/economy/economy.ts` — semua konstanta & definisi (saldo awal,
  tangga check-in, gaji, cooldown, biaya skip, titik-titik lokasi pekerjaan).
- `server/src/accounts/store.ts` — data ekonomi per akun + satu-satunya
  fungsi yang boleh mengubah saldo.
- `server/src/rooms/KotaRoom.ts` — penilaian kemajuan sif dari posisi
  otoritatif pemain di loop simulasi.
- Uji otomatis: `server/test/economy.mjs` (`npm run test:economy`) dan
  `server/test/tahap6b.mjs` (`npm run test:6b`).
- Kebutuhan hidup & waktu dunia didokumenkan terpisah di `docs/needs.md`.

## Aturan KC

| Hal | Nilai |
| --- | --- |
| Saldo awal akun baru | **500 KC** |
| Check-in harian | **Streak** (lihat tangga di bawah), sekali per hari kalender **Asia/Jakarta** |
| Cooldown pekerjaan | **Per pekerjaan** (lihat tabel), sejak sif selesai, tetap berjalan saat offline |
| Sif aktif bersamaan | Maks. **2**; dua-duanya tidak boleh sama-sama pekerjaan antar |
| Skip cooldown | Maks. **3x per hari** (jatah bersama), biaya per pekerjaan, **terbakar** |
| Tamu (tanpa akun) | Tidak punya saldo; check-in, pekerjaan & skip ditolak server |

- Setiap perubahan saldo tercatat di **ledger** akun (maks. 50 entri
  terakhir: waktu, ±KC, alasan, saldo sesudahnya).

## Check-in streak (Tahap 6B — menggantikan bonus rata +100 KC)

Bonus harian rata Tahap 5 **digantikan** sistem streak (keputusan user):
klaim beruntun per hari kalender Asia/Jakarta menaiki tangga —

| Hari beruntun | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hadiah | 10 | 20 | 30 | 40 | 50 | 60 | **150 KC** |

- Total satu siklus penuh = **360 KC/minggu**; siklus 7 hari berulang
  (hari ke-8 dihitung sebagai Hari 1 lagi = 10 KC).
- **Kelewat 1 hari → streak kembali ke Hari 1.** Klaim kedua di hari yang
  sama ditolak berdasarkan kunci hari `YYYY-MM-DD` Asia/Jakarta yang
  tersimpan di akun (`lastBonusDay` + `streakCount`) — bukan jam perangkat.
- Diklaim lewat pesan `bonus_claim`; server membalas privat `bonus_result`
  berisi hadiah, hari siklus, dan streak saat ini. Panel pekerjaan client
  menampilkan hadiah klaim berikutnya ("Check-in Hari ke-N: +X KC").

## Enam pekerjaan sesi

Pemain boleh memegang **maksimal 2 sif aktif sekaligus** (Tahap 6B), dan
dua-duanya **tidak boleh sama-sama pekerjaan antar** (Kurir + Ojek ditolak
server). Memulai sif lewat `job_start {jobId}`; membatalkan lewat
`job_cancel {jobId}` (tanpa gaji, **tanpa cooldown**). Keluar dari room di
tengah sif = sif hangus (tanpa gaji, tanpa cooldown). Timeout antar juga
gagal tanpa gaji & tanpa cooldown.

| Pekerjaan | Cara menyelesaikan | Gaji | Cooldown | Skip |
| --- | --- | --- | --- | --- |
| **Penjaga Warung Kopi** (`penjaga_warung`) | Berada dalam radius 3 m dari depan Warung Kopi (−12, −25,2) sampai terakumulasi **45 detik**. Keluar radius = hitungan **berhenti**, bukan mengulang dari nol. | 150 KC | 90 mnt | 60 KC |
| **Petugas Kebersihan Plaza** (`kebersihan`) | Kunjungi **5 titik** (radius 2,5 m): (10,10), (−10,10), (10,−10), (−10,−10), (0,16). Urutan bebas; tiap titik sekali. | 180 KC | 120 mnt | 80 KC |
| **Kurir Paket Balai Kota** (`kurir`) | Ambil paket di teras Balai Kota (0, −27; radius 3 m), antar ke **toko tujuan pilihan server** (9 ruko, radius 3,5 m) dalam **150 detik**. | 200 KC | 120 mnt | 90 KC |
| **Petugas Taman** (`taman`) | Kunjungi & siram **6 titik tanaman** (radius 2,5 m) di pohon & palem plaza: (−19,−18), (19,−18), (−13,12), (13,−13), (−8,20), (9,21). | 170 KC | 120 mnt | 70 KC |
| **Ojek Makanan** (`ojek`) | Ambil makanan di **toko pilihan server** (Warung Kopi / Bakso & Mie / Soto & Sate / Es Teh Segar / Kedai Roti), antar ke **alamat pilihan server** (depan toko atau depan kavling Kampung Kita) dalam **120 detik**. | 220 KC | 145 mnt | 110 KC |
| **Satpam Malam** (`satpam`) | Berada di area Balai Kota (0, −27; radius 6 m) sampai terakumulasi **60 detik**. Hanya bisa **dimulai saat malam server**; siang di tengah sif tidak membatalkan sif. | 250 KC | 150 mnt | 125 KC |

Selama sif berjalan, server mengirim ringkasan kemajuan privat
(`job_update`, kini berisi daftar `actives` — sampai 2 sif) setiap ada
perubahan dan berkala ±1 detik: detik jaga terakumulasi, titik x/N, atau
fase antar + titik ambil + tujuan + batas waktu. Client menampilkannya
apa adanya.

## Skip cooldown berbayar (Tahap 6B)

- Pemain yang sedang cooldown boleh **membayar biaya skip** (pesan
  `job_skip {jobId}`) untuk menghapus cooldown satu pekerjaan seketika.
- Biaya per pekerjaan ada di tabel di atas (40–50% dari gaji). Biaya
  **terbakar** — keluar dari peredaran KC, tidak masuk ke siapa pun.
- Jatah bersama: **maks. 3 attempt per hari kalender Asia/Jakarta** per
  akun, reset harian (kunci hari yang sama dengan check-in; tersimpan
  sebagai `skipDay` + `skipUsed` di data akun).
- Attempt & biaya **terpakai saat dibayar** — **hangus bila sif sesudahnya
  dibatalkan atau gagal** (mis. antar kelewat waktu). Client WAJIB
  menampilkan peringatan ini sebelum pembayaran dikonfirmasi.
- Ditolak tanpa biaya & tanpa attempt terpakai bila: pekerjaan tidak
  sedang cooldown, jatah hari ini habis, atau saldo kurang.

## Validasi anti-cheat di server

1. **Saldo tidak pernah dipercaya dari client.** Tidak ada pesan client
   yang membawa angka saldo/gaji; semua pembayaran dihitung server dari
   definisi di `economy.ts` dan diterapkan lewat `AccountStore`.
2. **Kemajuan dinilai dari posisi otoritatif.** Posisi pemain dihitung
   simulasi server (input client hanya arah, dinormalisasi); radius pos
   jaga, titik kunjungan, titik ambil & antar semuanya dicek server
   per tick (20×/detik).
3. **Cooldown persisten.** Waktu selesai sif tersimpan di data akun
   (`jobLastDone`), jadi keluar-masuk lagi tidak menghapus cooldown.
4. **Bayar tepat sekali.** Sif dihapus dari daftar aktif *sebelum*
   pembayaran diterapkan, dan pembayaran hanya terjadi di satu jalur
   kode (`finishShift` → `AccountStore.completeJob`).
5. **Akun wajib.** `job_start`, `bonus_claim` & `job_skip` dari sesi
   tamu ditolak; satu sesi = maksimal 2 sif (sif ketiga ditolak), dan
   dua pekerjaan antar tidak boleh berjalan bersamaan.
6. **Titik antar dipilih server** secara acak dari daftar resmi; client
   tidak bisa memilih atau mengubahnya. Satpam hanya bisa dimulai saat
   malam menurut **jam server** (`docs/needs.md`).

## Data akun (kolom ekonomi di `accounts.json`)

```ts
economy: {
  balance: number;                    // saldo KC saat ini
  lastBonusDay: string;               // hari check-in terakhir "YYYY-MM-DD" (Asia/Jakarta)
  streakCount: number;                // hari check-in beruntun sampai klaim terakhir
  skipDay: string;                    // hari jatah skip berlaku ("YYYY-MM-DD")
  skipUsed: number;                   // attempt skip terpakai pada skipDay
  jobLastDone: Record<string, number>; // jobId -> ms epoch sif terakhir selesai
  needs: { hunger: number; thirst: number; toilet: number }; // meter 0..100 (docs/needs.md)
  ledger: Array<{ ts: number; delta: number; reason: string; balanceAfter: number }>;
}
```

Akun lama (dibuat sebelum Tahap 5/6B) otomatis dilengkapi kolom ini
dengan nilai bawaan saat server menyala — tidak ada migrasi manual.
`GET /auth/me` mengembalikan `balance` (baca saja; mengubah saldo tetap
hanya bisa lewat jalur permainan di atas).
