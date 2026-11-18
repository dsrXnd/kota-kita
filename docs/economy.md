# Ekonomi — Koin Kota (KC) · Tahap 5

Sistem ekonomi pertama KOTA KITA. Prinsip utamanya sama seperti akun di
Tahap 3: **server adalah satu-satunya otoritas**. Client tidak pernah
menghitung, menyimpan, atau mengubah saldo — client hanya menampilkan
angka yang dikirim server lewat pesan privat.

Kode terkait:

- `server/src/economy/economy.ts` — semua konstanta & definisi (saldo awal,
  bonus, gaji, cooldown, titik-titik lokasi pekerjaan).
- `server/src/accounts/store.ts` — data ekonomi per akun + satu-satunya
  fungsi yang boleh mengubah saldo.
- `server/src/rooms/KotaRoom.ts` — penilaian kemajuan sif dari posisi
  otoritatif pemain di loop simulasi.
- Uji otomatis: `server/test/economy.mjs` (`npm run test:economy`).

## Aturan KC

| Hal | Nilai |
| --- | --- |
| Saldo awal akun baru | **500 KC** |
| Bonus masuk harian | **+100 KC**, sekali per hari kalender **Asia/Jakarta** |
| Cooldown pekerjaan | **10 menit** sejak sif selesai, per jenis pekerjaan |
| Tamu (tanpa akun) | Tidak punya saldo; bonus & pekerjaan ditolak server |

- Bonus diklaim lewat pesan `bonus_claim`; server membalas privat
  (`bonus_result`) dan menolak klaim kedua di hari yang sama berdasarkan
  kunci hari `YYYY-MM-DD` Asia/Jakarta yang tersimpan di akun
  (`lastBonusDay`) — bukan berdasarkan jam perangkat pemain.
- Setiap perubahan saldo tercatat di **ledger** akun (maks. 50 entri
  terakhir: waktu, ±KC, alasan, saldo sesudahnya).

## Tiga pekerjaan sesi

Satu pemain hanya boleh punya **satu sif aktif**. Memulai sif lewat
`job_start {jobId}`; membatalkan lewat `job_cancel` (tanpa gaji, **tanpa
cooldown**). Keluar dari room di tengah sif = sif hangus (tanpa gaji,
tanpa cooldown). Timeout kurir juga gagal tanpa gaji & tanpa cooldown.

| Pekerjaan | Cara menyelesaikan | Gaji |
| --- | --- | --- |
| **Penjaga Warung Kopi** (`penjaga_warung`) | Berada dalam radius 3 m dari depan Warung Kopi (-12, -25.2) sampai terakumulasi **45 detik**. Keluar radius = hitungan **berhenti**, bukan mengulang dari nol. | 150 KC |
| **Petugas Kebersihan Plaza** (`kebersihan`) | Kunjungi **5 titik** bersih-bersih (radius 2,5 m): (10,10), (-10,10), (10,-10), (-10,-10), (0,16). Urutan bebas; tiap titik tercatat sekali. | 180 KC |
| **Kurir Paket Balai Kota** (`kurir`) | Ambil paket di teras Balai Kota (0, -27; radius 3 m), lalu antar ke **toko tujuan yang dipilih server** (salah satu dari 9 ruko, radius 3,5 m) dalam **150 detik**. Lewat batas waktu = sif gagal. | 200 KC |

Selama sif berjalan, server mengirim ringkasan kemajuan privat
(`job_update`) setiap ada perubahan dan berkala ±1 detik: detik jaga
terakumulasi, titik x/5, atau fase kurir + tujuan + batas waktunya.
Client menampilkannya apa adanya.

## Validasi anti-cheat di server

1. **Saldo tidak pernah dipercaya dari client.** Tidak ada pesan client
   yang membawa angka saldo/gaji; semua pembayaran dihitung server dari
   definisi di `economy.ts` dan diterapkan lewat `AccountStore`.
2. **Kemajuan dinilai dari posisi otoritatif.** Posisi pemain dihitung
   simulasi server (input client hanya arah, dinormalisasi); radius pos
   jaga, titik kebersihan, titik ambil & antar semuanya dicek server
   per tick (20×/detik).
3. **Cooldown persisten.** Waktu selesai sif tersimpan di data akun
   (`jobLastDone`), jadi keluar-masuk lagi tidak menghapus cooldown.
4. **Bayar tepat sekali.** Sif dihapus dari daftar aktif *sebelum*
   pembayaran diterapkan, dan pembayaran hanya terjadi di satu jalur
   kode (`finishShift` → `AccountStore.completeJob`).
5. **Akun wajib.** `job_start` & `bonus_claim` dari sesi tamu ditolak;
   satu sesi = maksimal satu sif (sif kedua ditolak selama yang pertama
   berjalan).
6. **Tujuan kurir dipilih server** secara acak dari daftar toko; client
   tidak bisa memilih atau mengubahnya.

## Data akun (kolom baru di `accounts.json`)

```ts
economy: {
  balance: number;                    // saldo KC saat ini
  lastBonusDay: string;               // "YYYY-MM-DD" (Asia/Jakarta), "" = belum pernah klaim
  jobLastDone: Record<string, number>; // jobId -> ms epoch sif terakhir selesai
  ledger: Array<{ ts: number; delta: number; reason: string; balanceAfter: number }>;
}
```

Akun lama (dibuat sebelum Tahap 5) otomatis dilengkapi kolom ini dengan
nilai bawaan (saldo 500 KC) saat server menyala — tidak ada migrasi manual.
`GET /auth/me` kini juga mengembalikan `balance` (baca saja; mengubah saldo
tetap hanya bisa lewat jalur permainan di atas).
