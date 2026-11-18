/**
 * Ekonomi & aturan main KOTA KITA — Koin Kota (KC), pekerjaan, kebutuhan
 * hidup, dan waktu dunia (Tahap 5 + 6B).
 *
 * Semua aturan hidup di SERVER: saldo hanya berubah lewat AccountStore
 * (accounts/store.ts), kemajuan pekerjaan & kebutuhan divalidasi dari
 * posisi otoritatif pemain di room — client tidak pernah menghitung
 * saldo, kemajuan, atau meter sendiri; client hanya menampilkan pesan
 * server. File ini adalah SATU-SATUNYA sumber kebenaran angka permainan.
 */

export const KC_START_BALANCE = 500;

// ---------- Check-in streak (Tahap 6B, menggantikan bonus rata Tahap 5) ----------

/**
 * Tangga hadiah check-in beruntun per hari kalender Asia/Jakarta:
 * Hari 1..7 = 10/20/30/40/50/60/150 KC (total 360 KC/minggu), lalu siklus
 * 7 hari berulang (hari ke-8 = Hari 1 lagi). Kelewat 1 hari → streak reset.
 * Keputusan user 18 Nov 2026 — menggantikan bonus rata +100 KC Tahap 5.
 */
export const STREAK_REWARDS: ReadonlyArray<number> = [10, 20, 30, 40, 50, 60, 150];

/** Hari siklus (1..7) untuk hitungan streak beruntun tertentu (streak >= 1). */
export function streakCycleDay(streak: number): number {
  return ((Math.max(1, streak) - 1) % STREAK_REWARDS.length) + 1;
}

/** Hadiah KC untuk hitungan streak beruntun tertentu (streak >= 1). */
export function streakReward(streak: number): number {
  return STREAK_REWARDS[streakCycleDay(streak) - 1];
}

// ---------- Pekerjaan (Tahap 5 + 6B) ----------

export type JobKind = "stay" | "visit" | "deliver";

export interface WorldPoint {
  x: number;
  z: number;
}
export interface NamedPoint extends WorldPoint {
  name: string;
}

export interface JobDef {
  id: string;
  name: string;
  pay: number;
  kind: JobKind;
  desc: string;
  /** Cooldown sejak sif selesai (keputusan user Tahap 6B — per pekerjaan, bukan rata). */
  cooldownMs: number;
  /** Biaya skip cooldown (KC terbakar dari peredaran). */
  skipFee: number;
  /** Hanya bisa dimulai saat malam server (Satpam Malam). */
  nightOnly?: boolean;
  /** kind "stay": total ms terakumulasi di dalam radius pos jaga. */
  stayMs?: number;
  /** kind "stay": pos jaga. */
  post?: WorldPoint & { radius: number };
  /** kind "visit": titik-titik yang harus dikunjungi (tiap titik sekali). */
  points?: ReadonlyArray<WorldPoint>;
  /** kind "visit": radius kunjungan titik. */
  pointRadius?: number;
  /** kind "deliver": titik ambil yang dipilih server secara acak. */
  pickups?: ReadonlyArray<NamedPoint>;
  /** kind "deliver": radius titik ambil. */
  pickupRadius?: number;
  /** kind "deliver": titik antar yang dipilih server secara acak. */
  targets?: ReadonlyArray<NamedPoint>;
  /** kind "deliver": batas waktu antar sejak paket diambil (ms). */
  deliverMs?: number;
}

const MIN = 60 * 1000;

/** Pos jaga Penjaga Warung Kopi — depan toko WARUNG KOPI (-12,-31), sama seperti titik interaksinya di client. */
export const WARKOP_POST = { x: -12, z: -25.2, radius: 3 };
export const WARKOP_STAY_MS = 45_000;

/**
 * Titik bersih-bersih plaza — tersebar di empat sudut plaza + tepi selatan.
 * Dipakai juga oleh uji otomatis (server/test/economy.mjs); jangan diubah sepihak.
 */
export const CLEANUP_POINTS: ReadonlyArray<WorldPoint> = [
  { x: 10, z: 10 },
  { x: -10, z: 10 },
  { x: 10, z: -10 },
  { x: -10, z: -10 },
  { x: 0, z: 16 },
];
export const CLEANUP_RADIUS = 2.5;

/**
 * Titik tanaman Petugas Taman — di pohon & palem yang benar-benar ada di
 * dunia client (Plaza.buildVegetation): 4 pohon sudut plaza + 2 palem selatan.
 */
export const TAMAN_POINTS: ReadonlyArray<WorldPoint> = [
  { x: -19, z: -18 },
  { x: 19, z: -18 },
  { x: -13, z: 12 },
  { x: 13, z: -13 },
  { x: -8, z: 20 },
  { x: 9, z: 21 },
];
export const TAMAN_RADIUS = 2.5;

/** Teras Balai Kota — titik ambil paket kurir (sama seperti titik interaksi "balai" di client). */
export const BALAI_PICKUP = { x: 0, z: -27, radius: 3 };
export const DELIVER_RADIUS = 3.5;
export const DELIVER_TIME_MS = 150_000;

/** Pos jaga Satpam Malam — area teras Balai Kota (titik interaksi "balai" di client, radius 6). */
export const SATPAM_POST = { x: 0, z: -27, radius: 6 };
export const SATPAM_STAY_MS = 60_000;

/** Toko tujuan antar kurir — posisi depan toko (pintu), dipilih server secara acak. */
export const DELIVERY_TARGETS: ReadonlyArray<NamedPoint> = [
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

/** Titik ambil Ojek Makanan — depan toko makanan (dipilih server secara acak). */
export const OJEK_PICKUPS: ReadonlyArray<NamedPoint> = [
  { name: "WARUNG KOPI", x: -12, z: -25.2 },
  { name: "BAKSO & MIE", x: 12, z: -25.2 },
  { name: "SOTO & SATE", x: -25.2, z: -12 },
  { name: "ES TEH SEGAR", x: -25.2, z: 12 },
  { name: "KEDAI ROTI", x: -22, z: 25.2 },
];

/**
 * Tujuan antar Ojek Makanan — semua depan toko kurir + alamat depan
 * beberapa kavling Kampung Kita (posisi papan kavling). Mengantar ke
 * alamat kavling tidak butuh kepemilikan — itu alamat, bukan akses masuk.
 */
export const OJEK_TARGETS: ReadonlyArray<NamedPoint> = [
  ...DELIVERY_TARGETS,
  { name: "KAVLING 1 NO. 1", x: 50, z: -22.6 },
  { name: "KAVLING 2 NO. 1", x: 53, z: -6.6 },
  { name: "KAVLING 1 NO. 9", x: 50, z: 22.6 },
  { name: "KAVLING 2 NO. 5", x: 53, z: 6.6 },
];
export const OJEK_DELIVER_MS = 120_000;

/** Definisi pekerjaan — satu-satunya sumber kebenaran ada di server. */
export const JOBS: Record<string, JobDef> = {
  penjaga_warung: {
    id: "penjaga_warung",
    name: "Penjaga Warung Kopi",
    pay: 150,
    kind: "stay",
    desc: "Berjaga di depan Warung Kopi sampai total 45 detik (boleh keluar-masuk pos, hitungan berhenti saat di luar).",
    cooldownMs: 90 * MIN,
    skipFee: 60,
    stayMs: WARKOP_STAY_MS,
    post: WARKOP_POST,
  },
  kebersihan: {
    id: "kebersihan",
    name: "Petugas Kebersihan Plaza",
    pay: 180,
    kind: "visit",
    desc: "Kunjungi 5 titik bersih-bersih yang tersebar di sekitar plaza.",
    cooldownMs: 120 * MIN,
    skipFee: 80,
    points: CLEANUP_POINTS,
    pointRadius: CLEANUP_RADIUS,
  },
  kurir: {
    id: "kurir",
    name: "Kurir Paket Balai Kota",
    pay: 200,
    kind: "deliver",
    desc: "Ambil paket di teras Balai Kota, lalu antar ke toko tujuan dalam 150 detik.",
    cooldownMs: 120 * MIN,
    skipFee: 90,
    pickups: [{ name: "Teras Balai Kota", x: BALAI_PICKUP.x, z: BALAI_PICKUP.z }],
    pickupRadius: BALAI_PICKUP.radius,
    targets: DELIVERY_TARGETS,
    deliverMs: DELIVER_TIME_MS,
  },
  taman: {
    id: "taman",
    name: "Petugas Taman",
    pay: 170,
    kind: "visit",
    desc: "Datangi & siram 6 titik tanaman (pohon & palem) di sekitar plaza.",
    cooldownMs: 120 * MIN,
    skipFee: 70,
    points: TAMAN_POINTS,
    pointRadius: TAMAN_RADIUS,
  },
  ojek: {
    id: "ojek",
    name: "Ojek Makanan",
    pay: 220,
    kind: "deliver",
    desc: "Ambil makanan dari toko yang ditunjuk server, antar ke alamat tujuan dalam 120 detik.",
    cooldownMs: 145 * MIN,
    skipFee: 110,
    pickups: OJEK_PICKUPS,
    pickupRadius: 3,
    targets: OJEK_TARGETS,
    deliverMs: OJEK_DELIVER_MS,
  },
  satpam: {
    id: "satpam",
    name: "Satpam Malam",
    pay: 250,
    kind: "stay",
    desc: "Jaga area Balai Kota total 60 detik. Hanya bisa diambil saat MALAM server.",
    cooldownMs: 150 * MIN,
    skipFee: 125,
    nightOnly: true,
    stayMs: SATPAM_STAY_MS,
    post: SATPAM_POST,
  },
};

/** Maksimal sif aktif bersamaan per pemain (Tahap 6B). Dua-duanya tidak boleh sama-sama "deliver". */
export const MAX_ACTIVE_SHIFTS = 2;
/** Jatah skip cooldown berbayar per akun per hari kalender Asia/Jakarta (jatah bersama). */
export const MAX_SKIP_PER_DAY = 3;

// ---------- Pilihan pekerjaan (Tahap 10) ----------

/**
 * Tiap akun memilih TEPAT 2 pekerjaan sebagai "pekerjaannya" — hanya dua
 * itu yang bisa diambil sifnya (keputusan user dari tes main 18 Nov 2026:
 * satu warga tidak boleh mengerjakan semua pekerjaan). Pilihan pertama
 * GRATIS; mengganti pilihan dikenakan biaya yang TERBAKAR (keluar dari
 * peredaran, sama seperti biaya skip — TIDAK masuk Kas Kota).
 */
export const JOB_CHOOSE_COUNT = 2;
/** Biaya ganti pilihan pekerjaan dalam KC (angka keputusan user: 500 KC). */
export const JOB_CHANGE_FEE = 500;

// ---------- Kebutuhan hidup (Tahap 6B) ----------

export interface NeedsState {
  /** 🍗 Lapar 0..100 */
  hunger: number;
  /** 💧 Haus 0..100 */
  thirst: number;
  /** 🚽 Kebelet 0..100 */
  toilet: number;
}

export function fullNeeds(): NeedsState {
  return { hunger: 100, thirst: 100, toilet: 100 };
}

/**
 * Laju berkurang meter per DETIK bermain (hanya saat pemain ada di room;
 * tidak berkurang saat offline). Haus paling cepat, kebelet paling lambat:
 * haus kosong ±45 menit, lapar ±50 menit, kebelet ±55 menit dari penuh.
 */
export const NEEDS_DECAY_PER_SEC: Readonly<NeedsState> = {
  hunger: 100 / (50 * 60),
  thirst: 100 / (45 * 60),
  toilet: 100 / (55 * 60),
};

/** Ambang peringatan (meter <= nilai ini → client memperingatkan pemain). */
export const NEEDS_WARN_AT = 25;

/** Aksi isi ulang kebutuhan yang dikenal server (pesan "need_refill"). */
export type RefillAction =
  | "drink_fountain"
  | "drink_bottle"
  | "eat_snack"
  | "eat_meal"
  | "cook_home"
  | "wc_public"
  | "wc_paid"
  | "wc_home";

/** Titik air mancur plaza — minum GRATIS (pemain berdiri di tepi air mancur). */
export const FOUNTAIN_POINT = { x: 0, z: 0, radius: 5 };
/** Depan Warung Kopi — beli air mineral & makanan. */
export const WARKOP_FRONT = { x: -12, z: -25.2 };
/** Depan Bakso & Mie — beli makanan. */
export const BAKSO_FRONT = { x: 12, z: -25.2 };
/** Radius jangkauan titik jual/isi ulang makanan & minuman. */
export const SHOP_REFILL_RADIUS = 4.5;
/** WC umum GRATIS di Balai Kota (area teras, sama dengan pos Satpam). */
export const WC_PUBLIC_POINT = { x: 0, z: -27, radius: 6 };
/** Kios WC bersih berbayar dekat plaza (tenggara papan info, visual di Plaza client). */
export const WC_PAID_POINT = { x: 6, z: 16, radius: 4.5 };

/** Harga KC aksi isi ulang berbayar (yang gratis tidak tercantum = 0). */
export const REFILL_PRICE: Partial<Record<RefillAction, number>> = {
  drink_bottle: 10,
  eat_snack: 20,
  eat_meal: 45,
  wc_paid: 5,
};
/** Jajanan mengembalikan lapar sebesar ini (makan besar & masak = penuh 100). */
export const SNACK_HUNGER_RESTORE = 60;

// ---------- Waktu dunia (Tahap 6B) ----------

/**
 * Siklus siang-malam diatur SERVER dan sama untuk semua pemain
 * (menggantikan toggle manual per-client): 1 hari game = 24 menit asli
 * = 16 menit siang + 8 menit malam. Fraksi hari 0..1: 0 = awal siang,
 * 2/3 = matahari terbenam (awal malam), 1 = kembali ke awal siang.
 */
export const WORLD_DAY_MS = 24 * 60 * 1000;
export const WORLD_DAY_FRACTION = 16 / 24; // fraksi < ini = siang

/**
 * Geser jam dunia untuk pengujian/penyetelan, dalam menit, lewat variabel
 * lingkungan KOTA_TIME_OFFSET_MIN (boleh negatif/desimal). HANYA konfigurasi
 * saat server menyala — bukan pesan/endpoint curang saat permainan berjalan.
 */
const TIME_OFFSET_MS = (Number(process.env.KOTA_TIME_OFFSET_MIN) || 0) * 60 * 1000;

/** Fraksi hari dunia 0..1 pada waktu epoch tertentu. */
export function worldTimeFraction(now: number = Date.now()): number {
  const t = (((now + TIME_OFFSET_MS) % WORLD_DAY_MS) + WORLD_DAY_MS) % WORLD_DAY_MS;
  return t / WORLD_DAY_MS;
}

/** Apakah waktu dunia sedang malam (fraksi >= 2/3). */
export function isWorldNight(now: number = Date.now()): boolean {
  return worldTimeFraction(now) >= WORLD_DAY_FRACTION;
}

// ---------- Utilitas hari kalender Asia/Jakarta ----------

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Kunci hari kalender Asia/Jakarta, format "YYYY-MM-DD" (untuk check-in & jatah skip). */
export function jakartaDayKey(ts: number): string {
  const parts = dayFmt.formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
