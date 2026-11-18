import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Kavling & Rumah Pribadi — "Kampung Kita" (Tahap 6).
 *
 * Semua aturan perumahan hidup di SERVER: harga, denah kavling, dan
 * kepemilikan. Saldo KC hanya berubah lewat AccountStore (metode spendKC);
 * modul ini hanya menyimpan SIAPA memiliki kavling apa dan rumah tingkat
 * berapa. Kepemilikan disinkronkan ke semua klien lewat state room
 * (KotaRoom) dan kotak tabrakan rumah diturunkan dari data yang sama di
 * server maupun client (client/src/world/Kampung.ts — HARUS sama).
 *
 * Denah (meter dunia; plaza lama menempati x -48..48, Kampung Kita ke timur):
 * - Jalan utama: z -4..4, dari gerbang plaza (x ±44) ke timur sampai x 134.
 * - Kavling 2 (premium, 14x13 m): baris depan menghadap jalan utama —
 *   utara tengah z -12.5, selatan tengah z 12.5.
 * - Jalan lingkungan: z 19..22 dan -22..-19.
 * - Kavling 1 (standar, 10x12 m): baris dalam — utara tengah z -28,
 *   selatan tengah z 28.
 * face = arah hadap depan kavling: +1 menghadap +z (baris utara, jalan ada
 * di sisi z lebih besar), -1 menghadap -z (baris selatan).
 */

export interface PlotDef {
  id: string;
  /** 1 = Kavling 1 (standar), 2 = Kavling 2 (premium). */
  tier: 1 | 2;
  /** Nomor tampil di papan (1.. dalam kelompoknya). */
  number: number;
  cx: number;
  cz: number;
  /** Lebar (x) & kedalaman (z) petak dalam meter. */
  w: number;
  d: number;
  face: 1 | -1;
}

function buildPlots(): PlotDef[] {
  const plots: PlotDef[] = [];
  // Kavling 2 — 8 petak premium di baris depan (4 utara + 4 selatan).
  const k2x = [53, 71, 89, 107];
  k2x.forEach((cx, i) => plots.push({ id: `k2_${i + 1}`, tier: 2, number: i + 1, cx, cz: -12.5, w: 14, d: 13, face: 1 }));
  k2x.forEach((cx, i) => plots.push({ id: `k2_${i + 5}`, tier: 2, number: i + 5, cx, cz: 12.5, w: 14, d: 13, face: -1 }));
  // Kavling 1 — 16 petak standar di baris dalam (8 utara + 8 selatan).
  const k1x = [50, 61, 72, 83, 94, 105, 116, 127];
  k1x.forEach((cx, i) => plots.push({ id: `k1_${i + 1}`, tier: 1, number: i + 1, cx, cz: -28, w: 10, d: 12, face: 1 }));
  k1x.forEach((cx, i) => plots.push({ id: `k1_${i + 9}`, tier: 1, number: i + 9, cx, cz: 28, w: 10, d: 12, face: -1 }));
  return plots;
}

/** Denah 24 kavling Kampung Kita — satu-satunya sumber kebenaran di server. */
export const PLOTS: ReadonlyArray<PlotDef> = buildPlots();
export const PLOT_BY_ID: ReadonlyMap<string, PlotDef> = new Map(PLOTS.map((p) => [p.id, p]));

/** Harga klaim kavling per tingkat (keputusan user, Tahap 6). */
export const PLOT_PRICE: Readonly<Record<number, number>> = { 1: 2500, 2: 5000 };

export interface HouseDef {
  tier: number;
  name: string;
  price: number;
  /** Jejak bangunan (meter) — dasar kotak tabrakan di server & client. */
  w: number;
  d: number;
}

/** Katalog rumah (keputusan user, Tahap 6). Tingkat 0 = belum ada rumah. */
export const HOUSES: Readonly<Record<number, HouseDef>> = {
  1: { tier: 1, name: "Rumah Bambu", price: 2000, w: 6, d: 5 },
  2: { tier: 2, name: "Rumah Batu", price: 5000, w: 8, d: 6.5 },
  3: { tier: 3, name: "Rumah Tingkat", price: 7500, w: 8, d: 7 },
};
export const HOUSE_PRICE: Readonly<Record<number, number>> = {
  0: 0,
  1: HOUSES[1].price,
  2: HOUSES[2].price,
  3: HOUSES[3].price,
};

/** Rumah Tingkat hanya boleh berdiri di Kavling 2. */
export function houseAllowedOn(plot: PlotDef, houseTier: number): boolean {
  if (houseTier === 3) return plot.tier === 2;
  return houseTier === 1 || houseTier === 2;
}

/** Pusat bangunan rumah di sebuah kavling (digeser ke belakang petak, menyisakan halaman depan). */
export function houseCenter(plot: PlotDef, houseTier: number): { x: number; z: number } {
  const def = HOUSES[houseTier];
  const back = plot.d / 2 - def.d / 2 - 1;
  return { x: plot.cx, z: plot.cz - plot.face * back };
}

/** Kotak tabrakan (AABB) rumah yang berdiri: [minX, maxX, minZ, maxZ]. Null bila belum ada rumah. */
export function houseBox(plot: PlotDef, houseTier: number): readonly [number, number, number, number] | null {
  if (!HOUSES[houseTier]) return null;
  const def = HOUSES[houseTier];
  const c = houseCenter(plot, houseTier);
  return [c.x - def.w / 2, c.x + def.w / 2, c.z - def.d / 2, c.z + def.d / 2];
}

/** Titik kedatangan teleport "Ke Rumahku": halaman depan rumah (atau depan kavling kosong). */
export function homePoint(plot: PlotDef, houseTier: number): { x: number; z: number } {
  if (!HOUSES[houseTier]) {
    return { x: plot.cx, z: plot.cz + plot.face * (plot.d / 2 - 2.5) };
  }
  const def = HOUSES[houseTier];
  const c = houseCenter(plot, houseTier);
  return { x: c.x, z: c.z + plot.face * (def.d / 2 + 2) };
}

// ---------- Penyimpanan kepemilikan (persisten, pola sama seperti akun) ----------

export interface PlotRecord {
  /** Kunci akun pemilik (nama pengguna huruf kecil). */
  owner: string;
  /** Nama pengguna tampilan pemilik (untuk papan & state publik). */
  ownerName: string;
  /** Tingkat rumah yang berdiri: 0 = tanah kosong, 1..3 = katalog HOUSES. */
  house: number;
  claimedAt: number;
}

interface PlotDB {
  plots: Record<string, PlotRecord>;
}

const DATA_DIR = process.env.KOTA_DATA_DIR || join(process.cwd(), "data");
const PLOTS_FILE = join(DATA_DIR, "plots.json");

export class PlotStore {
  private db: PlotDB = { plots: {} };

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(PLOTS_FILE)) {
      try {
        this.db = JSON.parse(readFileSync(PLOTS_FILE, "utf8")) as PlotDB;
      } catch {
        this.db = { plots: {} };
      }
    }
    this.db.plots ??= {};
  }

  private save() {
    const tmp = PLOTS_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.db, null, 1));
    renameSync(tmp, PLOTS_FILE);
  }

  /** Catatan kepemilikan satu kavling (null = masih kosong). */
  get(plotId: string): PlotRecord | null {
    return this.db.plots[plotId] ?? null;
  }

  /** Id kavling milik satu akun (null = belum punya) — penegak aturan 1 akun 1 kavling. */
  plotOfAccount(accountKey: string): string | null {
    for (const [id, rec] of Object.entries(this.db.plots)) {
      if (rec.owner === accountKey) return id;
    }
    return null;
  }

  /** Jumlah rumah yang sudah berdiri di seluruh kota (statistik Tahap 8). */
  houseCount(): number {
    return Object.values(this.db.plots).filter((r) => r.house > 0).length;
  }

  /** Catat klaim. Pemanggil (room) WAJIB sudah memvalidasi: kavling kosong, akun belum punya, saldo sudah dipotong. */
  claim(plotId: string, accountKey: string, ownerName: string) {
    this.db.plots[plotId] = { owner: accountKey, ownerName, house: 0, claimedAt: Date.now() };
    this.save();
  }

  /** Catat pembangunan/peningkatan rumah. Pemanggil WAJIB sudah memvalidasi & memotong selisih harga. */
  setHouse(plotId: string, houseTier: number) {
    const rec = this.db.plots[plotId];
    if (!rec) return;
    rec.house = houseTier;
    this.save();
  }
}

/** Singleton yang dipakai room Colyseus. */
export const plots = new PlotStore();
