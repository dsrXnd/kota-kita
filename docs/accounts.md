# Akun & Data Persisten — KOTA KITA (Tahap 3)

## Keputusan penting (jujur, sesuai aturan proyek)

Rencana awal (master prompt & `architecture.md`) menyebut **Supabase** untuk autentikasi.
Tahap 3 ini **belum** memakai Supabase, dengan alasan yang disengaja:

1. Proyek Supabase harus dibuat atas nama pemilik game (email & kepemilikan milik user) — Lea tidak bisa membuatnya sendiri tanpa akun user.
2. Kode integrasi yang ditulis tanpa proyek & kunci nyata **tidak bisa diuji** — dan aturan proyek melarang kode yang tidak terbukti jalan.

Sebagai gantinya, Tahap 3 menyediakan **sistem akun di server game sendiri** dengan fitur yang sama persis seperti rencana — daftar/masuk, profil tersimpan, teman, moderasi — dan semuanya **terbukti oleh uji otomatis** (`server/test/accounts.mjs`). Saat user siap membuat proyek Supabase, migrasi mengikuti jalur di bagian bawah dokumen ini; desain datanya sudah disiapkan agar pindah itu lurus.

## Cara kerja akun server

- **Daftar/Masuk**: endpoint HTTP `POST /auth/register` & `POST /auth/login` (server yang sama dengan game). Nama pengguna 3–16 karakter (huruf/angka/garis bawah), kata sandi min. 6 karakter.
- **Kata sandi**: tidak pernah disimpan mentah — hash **scrypt** + salt acak per pengguna (`server/src/accounts/store.ts`), verifikasi dengan perbandingan waktu-konstan.
- **Sesi**: token acak 32 byte, berlaku 30 hari, disimpan client di `localStorage`. Client mengirim token saat `joinOrCreate` room; server memverifikasi, memuat profil akun sebagai dasar tampilan, dan menyimpan kembali pilihan tampilan terbaru pemain ke profilnya.
- **Tamu**: tetap bisa main tanpa akun (profil tidak tersimpan, tidak bisa punya daftar teman).
- **Penyimpanan**: `server/data/accounts.json` (ditulis atomik via file sementara + rename). Folder `data/` tidak masuk repo (`.gitignore`) dan berisi juga:
  - `chat.log.jsonl` — log semua chat (untuk moderasi),
  - `reports.jsonl` — laporan pemain, lengkap dengan 10 chat terakhir sebagai konteks.
- **Rate limit**: endpoint akun dibatasi 30 percobaan / 5 menit / IP.
- **API lain**: `GET /auth/me` (profil + teman + terakhir online), `POST /auth/profile` (simpan profil; semua nilai divalidasi server: format warna hex, daftar gaya rambut/model baju yang sah, nama dibersihkan).

## Teman

- Daftar teman tersimpan per akun (berdasarkan **nama pengguna akun**, bukan nama tampilan).
- State room memuat kolom publik `account` (nama pengguna / "" untuk tamu) agar pemain bisa menambahkan teman langsung dari panel **Teman & Pemain** (tombol 👥).
- Status online dihitung dari siapa yang sedang berada di room yang sama. Data daftar teman bersifat privat: dikirim server hanya ke pemiliknya lewat pesan `friends`, tidak masuk state publik.

## Moderasi

- **Lapor**: tombol ⚠️ di panel pemain → server mencatat laporan + konteks chat ke `reports.jsonl` dan membalas pengakuan ke pelapor.
- **Blokir**: tombol 🚫 menyembunyikan chat & avatar pemain tersebut **di perangkat pemblokir** (disimpan di `localStorage`). Ini fitur kenyamanan lokal; penindakan akun (peringatan/ban) adalah pekerjaan admin membaca `reports.jsonl` — panel admin masuk roadmap berikutnya.
- Chat tetap melewati filter kata kasar + rate limit server dari Tahap 1.

## Jalur migrasi ke Supabase (saat user siap)

1. User membuat proyek di supabase.com (akun milik user sendiri), lalu menjalankan SQL ini di SQL Editor:

```sql
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  display_name text not null default 'Pemain',
  shirt text not null default '#d64545',
  skin text not null default '#f1c27d',
  pants text not null default '#3b4a6b',
  hair text not null default 'pendek',
  hair_color text not null default '#3a2a1c',
  shirt_style text not null default 'polos',
  last_online timestamptz not null default now()
);

create table public.friendships (
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;

-- Profil bisa dibaca publik (nama & tampilan memang publik di dalam game),
-- tapi hanya pemilik yang bisa mengubah miliknya.
create policy "profiles readable" on public.profiles for select using (true);
create policy "profiles owner update" on public.profiles for update using (auth.uid() = id);
create policy "profiles owner insert" on public.profiles for insert with check (auth.uid() = id);

create policy "friends owner read" on public.friendships for select using (auth.uid() = user_id);
create policy "friends owner insert" on public.friendships for insert with check (auth.uid() = user_id);
create policy "friends owner delete" on public.friendships for delete using (auth.uid() = user_id);
```

2. Client diberi `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (**anon key bersifat publik** — aman di client; yang tidak boleh bocor adalah *service role key*, dan itu tidak dipakai sama sekali di desain ini).
3. Lapisan `client/src/multiplayer/Account.ts` diganti implementasinya ke Supabase Auth (`signUp`/`signInWithPassword`) dengan antarmuka fungsi yang sama; room Colyseus menerima JWT Supabase dan memverifikasinya memakai JWKS proyek sebelum memuat profil.
4. Data akun server lama (`accounts.json`) tidak dimigrasikan otomatis — pengguna mendaftar ulang di Supabase. Karena itu migrasi paling enak dilakukan **sebelum** game dirilis publik (Tahap 4).
