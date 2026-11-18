/**
 * Ekonomi KOTA KITA (Tahap 5) — Koin Kota (KC).
 *
 * Semua aturan ekonomi hidup di SERVER: saldo hanya berubah lewat
 * AccountStore (accounts/store.ts), dan kemajuan pekerjaan divalidasi
 * dari posisi otoritatif pemain di room — client tidak pernah menghitung
 * saldo atau kemajuan sendiri, hanya menampilkan pesan server.
 */

export const KC_START_BALANCE = 500;
export const KC_DAILY_BONUS = 100;
/** Jeda sebelum pekerjaan yang sama boleh diambil lagi (sejak selesai). */
export const JOB_COOLDOWN_MS = 10 * 60 * 1000;

export type JobKind = "stay" | "visit" | "deliver";

export interface JobDef {
  id: string;
  name: string;
  pay: number;
  kind: JobKind;
  desc: string;
}

/** Definisi pekerjaan — satu-satunya sumber kebenaran ada di server. */
export const JOBS: Record<string, JobDef> = {
  penjaga_warung: {
    id: "penjaga_warung",
    name: "Penjaga Warung Kopi",
    pay: 150,
    kind: "stay",
    desc: "Berjaga di depan Warung Kopi sampai total 45 detik (boleh keluar-masuk pos, hitungan berhenti saat di luar).",
  },
  kebersihan: {
    id: "kebersihan",
    name: "Petugas Kebersihan Plaza",
    pay: 180,
    kind: "visit",
    desc: "Kunjungi 5 titik bersih-bersih yang tersebar di sekitar plaza.",
  },
  kurir: {
    id: "kurir",
    name: "Kurir Paket Balai Kota",
    pay: 200,
    kind: "deliver",
    desc: "Ambil paket di teras Balai Kota, lalu antar ke toko tujuan dalam 150 detik.",
  },
};

/** Pos jaga Penjaga Warung Kopi — depan toko WARUNG KOPI (-12,-31), sama seperti titik interaksinya di client. */
export const WARKOP_POST = { x: -12, z: -25.2, radius: 3 };
export const WARKOP_STAY_MS = 45_000;

/**
 * Titik bersih-bersih plaza — tersebar di empat sudut plaza + tepi selatan.
 * Dipakai juga oleh uji otomatis (server/test/economy.mjs); jangan diubah sepihak.
 */
export const CLEANUP_POINTS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 10, z: 10 },
  { x: -10, z: 10 },
  { x: 10, z: -10 },
  { x: -10, z: -10 },
  { x: 0, z: 16 },
];
export const CLEANUP_RADIUS = 2.5;

/** Teras Balai Kota — titik ambil paket kurir (sama seperti titik interaksi "balai" di client). */
export const BALAI_PICKUP = { x: 0, z: -27, radius: 3 };
export const DELIVER_RADIUS = 3.5;
export const DELIVER_TIME_MS = 150_000;

/** Toko tujuan antar kurir — posisi depan toko (pintu), dipilih server secara acak. */
export const DELIVERY_TARGETS: ReadonlyArray<{ name: string; x: number; z: number }> = [
  { name: "TOKO BUKU", x: -24, z: -25.2 },
  { name: "BAKSO & MIE", x: 12, z: -25.2 },
  { name: "TOKO BUNGA", x: 24, z: -25.2 },
  { name: "KEDAI ROTI", x: -22, z: 25.2 },
  { name: "TOKO BATIK", x: 22, z: 25.2 },
  { name: "SOTO & SATE", x: -25.2, z: -12 },
  { name: "ES TEH SEGAR", x: -25.2, z: 12 },
  { name: "TOKO MAINAN", x: 25.2, z: -12 },
  { name: "FOTOKOPI", x: 25.2, z: 12 },
];

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Kunci hari kalender Asia/Jakarta, format "YYYY-MM-DD" (untuk bonus harian). */
export function jakartaDayKey(ts: number): string {
  const parts = dayFmt.formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
