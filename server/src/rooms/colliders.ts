/**
 * Kotak tabrakan bangunan (AABB) — sumbu lurus, dalam meter dunia.
 * HARUS sama dengan daftar di client (client/src/world/Plaza.ts: COLLIDERS).
 * Urutan: [minX, maxX, minZ, maxZ]. Sesuai denah docs/art-style.md:
 * ruko 10x8 m (yang di barat/timur berputar 90° jadi 8x10 m), balai kota 15x9 m.
 *
 * Tahap 9: kotak boleh punya 2 angka tambahan [minFeetY, maxFeetY] —
 * kotak hanya berlaku bila tinggi kaki pemain (pos.y) berada di rentang
 * [minFeetY, maxFeetY). Kotak 4 angka berlaku di semua ketinggian
 * (perilaku lama, tidak berubah). Lihat server/src/world/world.ts.
 */
export const COLLIDERS: ReadonlyArray<ReadonlyArray<number>> = [
  // Ruko utara (z = -31)
  [-29, -19, -35, -27],
  [-17, -7, -35, -27],
  [7, 17, -35, -27],
  [19, 29, -35, -27],
  // Ruko selatan (z = 31)
  [-27, -17, 27, 35],
  [17, 27, 27, 35],
  // Ruko barat (x = -31)
  [-35, -27, -17, -7],
  [-35, -27, 7, 17],
  // Ruko timur (x = 31)
  [27, 35, -17, -7],
  [27, 35, 7, 17],
  // Balai Kota Mini (0, -33) — AABB berhenti sebelum tangga agar pemain bisa naik ke teras.
  [-7.5, 7.5, -37.5, -29],
];

const PLAYER_RADIUS = 0.35;

type Box = ReadonlyArray<number>;

function resolveAgainst(pos: { x: number; z: number; y?: number }, boxes: ReadonlyArray<Box>): void {
  const feetY = pos.y ?? 0;
  for (const box of boxes) {
    // Gerbang ketinggian kaki (Tahap 9): lewati kotak yang tidak berlaku
    // pada ketinggian kaki pemain saat ini.
    if (box.length > 4) {
      const minFeetY = box[4];
      const maxFeetY = box.length > 5 ? box[5] : Number.POSITIVE_INFINITY;
      if (feetY < minFeetY || feetY >= maxFeetY) continue;
    }
    const [minX, maxX, minZ, maxZ] = box;
    const nearX = Math.max(minX - PLAYER_RADIUS, Math.min(pos.x, maxX + PLAYER_RADIUS));
    const nearZ = Math.max(minZ - PLAYER_RADIUS, Math.min(pos.z, maxZ + PLAYER_RADIUS));
    const dx = pos.x - nearX;
    const dz = pos.z - nearZ;
    if (dx === 0 && dz === 0) {
      // Di dalam kotak: dorong keluar lewat sisi terdekat.
      const left = pos.x - (minX - PLAYER_RADIUS);
      const right = maxX + PLAYER_RADIUS - pos.x;
      const top = pos.z - (minZ - PLAYER_RADIUS);
      const bottom = maxZ + PLAYER_RADIUS - pos.z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) pos.x = minX - PLAYER_RADIUS;
      else if (m === right) pos.x = maxX + PLAYER_RADIUS;
      else if (m === top) pos.z = minZ - PLAYER_RADIUS;
      else pos.z = maxZ + PLAYER_RADIUS;
    }
  }
}

/** Dorong posisi keluar dari semua kotak bangunan statis (sumbu penetrasi terkecil). */
export function resolveCollisions(pos: { x: number; z: number; y?: number }, extra: ReadonlyArray<Box> = []): void {
  resolveAgainst(pos, COLLIDERS);
  if (extra.length > 0) resolveAgainst(pos, extra);
}
