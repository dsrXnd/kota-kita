/**
 * Cermin client dari server/src/world/world.ts — batas dunia, zona
 * ketinggian lantai, dan kotak tabrakan kawasan Tahap 9.
 *
 * ANGKA-ANGKA DI FILE INI HARUS SELALU SAMA DENGAN SERVER. Prediksi
 * gerak lokal memakai fungsi yang sama persis dengan simulasi server
 * agar pemain tidak "ditarik kembali" oleh rekonsiliasi.
 *
 * Kotak: [minX, maxX, minZ, maxZ] berlaku di semua ketinggian kaki;
 * [minX, maxX, minZ, maxZ, minFeetY, maxFeetY] hanya berlaku bila tinggi
 * kaki pemain (pos.y) di rentang [minFeetY, maxFeetY) — pagar dek tidak
 * menahan pemain yang berjalan di tanah DI BAWAH dek.
 */

// ---------- Batas dunia ----------

export const BOUND_MIN_X = -112; // Pantai (Tahap 9)
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
  h: number;
}

export interface RampZone {
  kind: "ramp";
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  axis: "x" | "z";
  from: number;
  to: number;
  hFrom: number;
  hTo: number;
}

export type HeightZone = FlatZone | RampZone;

/** Tinggi dek Teras Atas Balai Kota. */
export const DECK_HEIGHT = 3;

/** Teras Atas Balai Kota: dek (z -28.5..-23.5) + tangga (z -23.5..-17.5). */
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

/** Tinggi lantai tertinggi menurut denah zona di titik (x, z); 0 = tanah dasar. */
export function groundHeight(x: number, z: number): number {
  let best = 0;
  for (const zone of HEIGHT_ZONES) {
    const h = zoneHeightAt(zone, x, z);
    if (h !== null && h > best) best = h;
  }
  return best;
}

/** Maksimum langkah naik yang masih dianggap lantai (bukan langit-langit). */
export const STEP_UP = 0.55;

/**
 * Lantai efektif untuk kaki setinggi feetY: zona tertinggi yang
 * tingginya <= feetY + STEP_UP. Inilah yang membuat pemain tanah bisa
 * berjalan di bawah dek dan pendaki ramp mengikuti tangganya.
 */
export function floorHeight(x: number, z: number, feetY: number): number {
  let best = 0;
  for (const zone of HEIGHT_ZONES) {
    const h = zoneHeightAt(zone, x, z);
    if (h !== null && h <= feetY + STEP_UP && h > best) best = h;
  }
  return best;
}

// ---------- Kotak tabrakan kawasan Tahap 9 (sama dengan server) ----------

type Box = ReadonlyArray<number>;

const INF = Number.POSITIVE_INFINITY;

export const WORLD_BOXES: ReadonlyArray<Box> = [
  // Air pantai: pemain tertahan di garis pantai x -79.65.
  [-112, -80, -70, 90],
  // Gubuk pantai.
  [-51.5, -48.5, -13.25, -10.75],
  [-51.5, -48.5, 12.75, 15.25],
  // Tiang penyangga dek Teras Atas.
  [6.5, 7, -28.5, -28],
  [-7, -6.5, -28.5, -28],
  [6.5, 7, -24, -23.5],
  [-7, -6.5, -24, -23.5],
  // Pagar dek & muka gedung dari sisi dek (kaki >= 1.5 m saja).
  [-7, -2, -23.9, -23.5, 1.5, INF],
  [2, 7, -23.9, -23.5, 1.5, INF],
  [6.6, 7, -28.5, -23.5, 1.5, INF],
  [-7, -6.6, -28.5, -23.5, 1.5, INF],
  [-7.5, 7.5, -37.5, -28.5, 1.5, INF],
];
