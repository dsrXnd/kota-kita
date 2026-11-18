import { jakartaDayKey } from "./economy";

/**
 * Kosmetik Musiman (Tahap 9) — model baju bertema Indonesia yang hanya
 * bisa DIPILIH saat musimnya aktif. Gratis, tanpa pay-to-win: tidak ada
 * yang dijual; gaya ini hanya soal waktu (jendela tanggal Asia/Jakarta).
 *
 * SERVER adalah otoritasnya: state room mengumumkan musim aktif (atau
 * tidak ada), sanitasi profil (server/src/index.ts) menolak menyimpan
 * gaya musiman di luar jendelanya (kembali ke "polos"), dan room hanya
 * menerima gaya musiman saat aktif ATAU bila gaya itu memang sudah
 * terpasang di profil akun (yang sudah terpasang TETAP terpasang setelah
 * jendela tutup — yang diatur hanya tawaran editor & simpanan baru).
 *
 * Jendela (berdasarkan tanggal kalender Asia/Jakarta):
 * - 🇮🇩 "merahputih" (HUT RI): 14–20 Agustus, setiap tahun.
 * - 🎉 "pesta" (Tahun Baru): 29 Desember – 2 Januari, setiap tahun.
 * - 🌙 "koko" (Ramadan): tabel pendekatan Gregorian 2026–2028 di bawah.
 *   Tanggal Ramadan bergeser ±11 hari per tahun mengikuti kalender
 *   Hijriah; tabel ini adalah PENDEKATAN terdokumentasi (bukan penetapan
 *   resmi pemerintah) dan perlu diperbarui manual untuk tahun berikutnya.
 *
 * Untuk pengujian/penyetelan, tanggal "hari ini" bisa digeser lewat
 * variabel lingkungan KOTA_SEASON_DATE=YYYY-MM-DD — HANYA konfigurasi
 * saat server menyala, sama seperti KOTA_TIME_OFFSET_MIN; bukan pesan
 * atau endpoint curang saat permainan berjalan.
 */

export interface SeasonDef {
  /** Nilai shirtStyle di profil avatar. */
  style: string;
  /** Nama musim untuk panel & editor. */
  label: string;
  icon: string;
  /** Nama gaya baju untuk editor avatar. */
  styleName: string;
}

export const SEASONS: ReadonlyArray<SeasonDef> = [
  { style: "merahputih", label: "HUT RI", icon: "🇮🇩", styleName: "Merah Putih" },
  { style: "koko", label: "Ramadan", icon: "🌙", styleName: "Koko Ramadan" },
  { style: "pesta", label: "Tahun Baru", icon: "🎉", styleName: "Pesta Tahun Baru" },
];
export const SEASON_BY_STYLE: ReadonlyMap<string, SeasonDef> = new Map(SEASONS.map((s) => [s.style, s]));

/**
 * Jendela Ramadan — PENDEKATAN Gregorian (perkiraan awal–akhir bulan
 * Ramadan), bukan penetapan resmi. Perbarui manual tiap tahun.
 */
const RAMADAN_RANGES: ReadonlyArray<{ from: string; to: string }> = [
  { from: "2026-02-18", to: "2026-03-20" },
  { from: "2027-02-08", to: "2027-03-09" },
  { from: "2028-01-28", to: "2028-02-26" },
];

/** Kunci tanggal "hari ini" (YYYY-MM-DD) — digeser KOTA_SEASON_DATE bila diatur, selain itu tanggal Asia/Jakarta asli. */
export function seasonDateKey(): string {
  const env = process.env.KOTA_SEASON_DATE;
  if (env && /^\d{4}-\d{2}-\d{2}$/.test(env)) return env;
  return jakartaDayKey(Date.now());
}

/** Apakah nilai shirtStyle ini gaya musiman? */
export function isSeasonalStyle(style: unknown): style is string {
  return typeof style === "string" && SEASON_BY_STYLE.has(style);
}

/** Musim yang aktif pada tanggal kunci tertentu (bawaan: "hari ini" server). */
export function activeSeason(dateKey: string = seasonDateKey()): SeasonDef | null {
  const parts = dateKey.split("-").map(Number);
  const [, month, day] = parts;
  if (!month || !day) return null;
  // 🇮🇩 HUT RI: 14–20 Agustus setiap tahun.
  if (month === 8 && day >= 14 && day <= 20) return SEASON_BY_STYLE.get("merahputih")!;
  // 🎉 Tahun Baru: 29 Desember – 2 Januari setiap tahun.
  if ((month === 12 && day >= 29) || (month === 1 && day <= 2)) return SEASON_BY_STYLE.get("pesta")!;
  // 🌙 Ramadan: tabel pendekatan (perbandingan string sah untuk format ISO).
  for (const range of RAMADAN_RANGES) {
    if (dateKey >= range.from && dateKey <= range.to) return SEASON_BY_STYLE.get("koko")!;
  }
  return null;
}

/** Apakah gaya musiman tertentu sedang dalam jendela aktifnya? */
export function seasonalStyleActive(style: unknown): boolean {
  if (!isSeasonalStyle(style)) return false;
  return activeSeason()?.style === style;
}
