/**
 * Dunia bersama — batas peta, sistem ketinggian lantai, dan kotak
 * tabrakan kawasan baru (Tahap 9).
 *
 * File ini adalah SATU-SATUNYA sumber kebenaran server untuk:
 * - Batas dunia (plaza ±42, Kampung Kita ke timur, Pasar ke selatan,
 *   dan sejak Tahap 9 Pantai ke barat sampai x -112).
 * - Zona ketinggian lantai (denah datar + ramp tangga) yang dipakai
 *   "Teras Atas Balai Kota": dek pandang setinggi 3 m di muka Balai
 *   Kota dengan tangga besar di depannya.
 * - Kotak tabrakan statis kawasan Tahap 9 (garis pantai, gubuk pantai,
 *   tiang dek, pagar dek & muka gedung untuk pemain di atas dek).
 *
 * SEMUA angka di sini HARUS sama dengan cerminnya di client
 * (client/src/world/Heights.ts) — server & prediksi client memakai
 * fungsi yang sama persis agar tidak bertengkar.
 *
 * Kotak tabrakan berbentuk larik angka:
 *   [minX, maxX, minZ, maxZ]                       → berlaku di semua ketinggian kaki
 *   [minX, maxX, minZ, maxZ, minFeetY, maxFeetY]   → hanya berlaku bila
 *   tinggi kaki pemain (player.y) berada di rentang [minFeetY, maxFeetY).
 * Pagar dek memakai gerbang minFeetY 1.5: pemain di tanah (kaki 0)
 * TIDAK tertahan pagar (mereka berjalan DI BAWAH dek), pemain di atas
 * dek (kaki ±3) tertahan pagar seperti mestinya.
 */

// ---------- Batas dunia ----------

export const BOUND_MIN_X = -112; // Tahap 9: Pantai membentang ke barat
export const BOUND_MAX_X = 136; // Kampung Kita (Tahap 6)
export const BOUND_MIN_Z = -42;
export const BOUND_MAX_Z = 70; // Pasar (Tahap 7)

// ---------- Zona ketinggian lantai ----------

export interface FlatZone {
  kind: "flat";
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Tinggi lantai (meter di atas tanah dasar 0). */
  h: number;
}

export interface RampZone {
  kind: "ramp";
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Sumbu sepanjang ramp menanjak. */
  axis: "x" | "z";
  /** Koordinat sumbu tempat tinggi = hFrom, dan tempat tinggi = hTo. */
  from: number;
  to: number;
  hFrom: number;
  hTo: number;
}

export type HeightZone = FlatZone | RampZone;

/** Tinggi dek Teras Atas Balai Kota. */
export const DECK_HEIGHT = 3;

/**
 * Zona ketinggian satu-satunya kawasan bertingkat saat ini: Teras Atas
 * Balai Kota. Balai Kota berdiri di (0, -33), muka gedungnya di z -28.5;
 * dek menempel di muka gedung (z -28.5..-23.5, x -7..7) setinggi 3 m,
 * dan tangga besar (lebar 4 m, x -2..2) turun ke selatan dari tepi dek
 * (z -23.5) sampai tanah plaza (z -17.5).
 */
export const HEIGHT_ZONES: ReadonlyArray<HeightZone> = [
  { kind: "flat", minX: -7, maxX: 7, minZ: -28.5, maxZ: -23.5, h: DECK_HEIGHT },
  { kind: "ramp", minX: -2, maxX: 2, minZ: -23.5, maxZ: -17.5, axis: "z", from: -17.5, to: -23.5, hFrom: 0, hTo: DECK_HEIGHT },
];

function zoneHeightAt(zone: HeightZone, x: number, z: number): number | null {
  if (x < zone.minX || x > zone.maxX || z < zone.minZ || z > zone.maxZ) return null;
  if (zone.kind === "flat") return zone.h;
  const coord = zone.axis === "z" ? z : x;
  const t = (coord - zone.from) / (zone.to - zone.from);
  return zone.hFrom + (zone.hTo - zone.hFrom) * Math.min(1, Math.max(0, t));
}

/**
 * Tinggi lantai tertinggi di titik (x, z) menurut denah zona — fungsi
 * MURNI dari posisi (0 = tanah dasar). Inilah "groundHeight" yang
 * dirujuk desain sistem ketinggian.
 */
export function groundHeight(x: number, z: number): number {
  let best = 0;
  for (const zone of HEIGHT_ZONES) {
    const h = zoneHeightAt(zone, x, z);
    if (h !== null && h > best) best = h;
  }
  return best;
}

/**
 * Maksimum "langkah naik" yang dianggap lantai (bukan langit-langit):
 * zona yang lantainya lebih tinggi dari kaki + nilai ini DIABAIKAN
 * saat menentukan lantai efektif — itulah yang membuat pemain di tanah
 * bisa berjalan DI BAWAH dek (lantai dek 3 m adalah langit-langit bagi
 * mereka), sementara pemain yang menaiki ramp (selisih tinggi per tick
 * kecil) dan pemain yang jatuh dari dek tetap mendarat dengan benar.
 */
export const STEP_UP = 0.55;

/**
 * Lantai efektif untuk pemain yang kakinya setinggi feetY: zona
 * tertinggi yang tingginya <= feetY + STEP_UP (tanah dasar 0 selalu
 * menjadi calon). Gerak pemain mengikuti fungsi ini, BUKAN
 * groundHeight mentah — lihat STEP_UP di atas.
 */
export function floorHeight(x: number, z: number, feetY: number): number {
  let best = 0;
  for (const zone of HEIGHT_ZONES) {
    const h = zoneHeightAt(zone, x, z);
    if (h !== null && h <= feetY + STEP_UP && h > best) best = h;
  }
  return best;
}

// ---------- Kotak tabrakan kawasan Tahap 9 ----------

type Box = ReadonlyArray<number>;

const INF = Number.POSITIVE_INFINITY;

/**
 * Kotak statis Tahap 9 (digabungkan room ke daftar dinamis; client
 * menggabungkannya ke daftar prediksi — isinya HARUS sama):
 * - Garis pantai: air di barat x <= -80 tidak bisa dimasuki (tidak ada
 *   sistem berenang) — pemain tertahan di x -79.65 (tepi pasir).
 * - Dua gubuk pantai di tepi pasir.
 * - Empat tiang penyangga dek (kotak tanah biasa, semua ketinggian).
 * - Pagar dek & muka gedung Balai Kota (gerbang kaki >= 1.5 m).
 */
export const WORLD_BOXES: ReadonlyArray<Box> = [
  // Air pantai (penghalang garis pantai): x -112..-80, sepanjang pantai.
  [-112, -80, -70, 90],
  // Gubuk pantai (pusat -50,-12 dan -50,14; jejak 3 x 2.5 m).
  [-51.5, -48.5, -13.25, -10.75],
  [-51.5, -48.5, 12.75, 15.25],
  // Tiang penyangga dek Teras Atas (0.5 x 0.5 m di empat sudut dek).
  [6.5, 7, -28.5, -28],
  [-7, -6.5, -28.5, -28],
  [6.5, 7, -24, -23.5],
  [-7, -6.5, -24, -23.5],
  // Pagar dek — hanya untuk pemain yang kakinya di atas dek (>= 1.5 m).
  // Selatan: dua ruas menyisakan bukaan tangga (x -2..2).
  [-7, -2, -23.9, -23.5, 1.5, INF],
  [2, 7, -23.9, -23.5, 1.5, INF],
  // Timur & barat dek.
  [6.6, 7, -28.5, -23.5, 1.5, INF],
  [-7, -6.6, -28.5, -23.5, 1.5, INF],
  // Muka gedung Balai Kota dari sisi dek: pemain di dek tidak bisa
  // masuk ke badan gedung (pemain tanah diatur collider balai biasa).
  [-7.5, 7.5, -37.5, -28.5, 1.5, INF],
];
