import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Usaha Pemain — "Pasar" (Tahap 7).
 *
 * Semua aturan pasar hidup di SERVER: harga lapak, denah, katalog & rentang
 * harga, kepemilikan, kas usaha, dan log penjualan. Saldo KC pembeli/pemilik
 * hanya berubah lewat AccountStore (spendKC / creditKC); modul ini hanya
 * menyimpan SIAPA memiliki lapak apa, menu & harganya, kas usaha (PRIVAT —
 * tidak pernah masuk state room), dan 20 penjualan terakhir per lapak.
 * Kepemilikan + menu disinkronkan ke semua klien lewat state room (KotaRoom)
 * dan kotak tabrakan meja lapak diturunkan dari data yang sama di server
 * maupun client (client/src/world/Pasar.ts — HARUS sama).
 *
 * Denah (meter dunia; Pasar menempel di SELATAN plaza, Kampung Kita di timur):
 * - Jalan pasar membentang barat–timur di z 49..55, dari x -40 sampai x 40.
 * - Gerbang pasar di (0, 44); jalan batu dari plaza (z 35) ke gerbang.
 * - Lapak baris utara (No. 1–5): tengah z 46, menghadap +z (ke jalan).
 * - Lapak baris selatan (No. 6–10): tengah z 58, menghadap -z (ke jalan).
 * face = arah hadap depan lapak (ke jalan pasar): +1 menghadap +z, -1 ke -z.
 */

export interface LapakDef {
  id: string;
  /** Nomor tampil di papan (1..10). */
  number: number;
  cx: number;
  cz: number;
  /** Lebar (x) & kedalaman (z) petak lapak dalam meter. */
  w: number;
  d: number;
  face: 1 | -1;
}

function buildLapaks(): LapakDef[] {
  const lapaks: LapakDef[] = [];
  const xs = [-32, -16, 0, 16, 32];
  // Baris utara No. 1–5 (menghadap jalan di sisi +z).
  xs.forEach((cx, i) => lapaks.push({ id: `lp_${i + 1}`, number: i + 1, cx, cz: 46, w: 7, d: 6, face: 1 }));
  // Baris selatan No. 6–10 (menghadap jalan di sisi -z).
  xs.forEach((cx, i) => lapaks.push({ id: `lp_${i + 6}`, number: i + 6, cx, cz: 58, w: 7, d: 6, face: -1 }));
  return lapaks;
}

/** Denah 10 lapak Pasar — satu-satunya sumber kebenaran di server. */
export const LAPAKS: ReadonlyArray<LapakDef> = buildLapaks();
export const LAPAK_BY_ID: ReadonlyMap<string, LapakDef> = new Map(LAPAKS.map((l) => [l.id, l]));

/** Harga klaim lapak (keputusan user, Tahap 7 — satu-satunya aset produktif). */
export const LAPAK_PRICE = 10000;

/** Jejak meja/gerobak lapak (meter) — dasar kotak tabrakan di server & client. */
export const STALL_W = 5;
export const STALL_D = 2.5;

/** Pusat bangunan lapak di petaknya (digeser ke belakang, menyisakan ruang pembeli di depan). */
export function stallCenter(def: LapakDef): { x: number; z: number } {
  const back = def.d / 2 - STALL_D / 2 - 0.5;
  return { x: def.cx, z: def.cz - def.face * back };
}

/** Kotak tabrakan (AABB) meja lapak yang SUDAH dimiliki: [minX, maxX, minZ, maxZ]. */
export function stallBox(def: LapakDef): readonly [number, number, number, number] {
  const c = stallCenter(def);
  return [c.x - STALL_W / 2, c.x + STALL_W / 2, c.z - STALL_D / 2, c.z + STALL_D / 2];
}

/** Titik depan lapak (posisi papan & titik interaksi) — dasar validasi jarak beli/ambil kas. */
export function lapakFront(def: LapakDef): { x: number; z: number } {
  return { x: def.cx, z: def.cz + def.face * (def.d / 2 - 0.6) };
}

/** Radius maksimum (meter dari titik depan) untuk membeli & mengambil kas. */
export const LAPAK_NEAR_RADIUS = 6;

// ---------- Katalog barang (rentang harga diatur sistem) ----------

export interface CatalogItem {
  id: string;
  name: string;
  /** Meter kebutuhan yang diisi: "hunger" | "thirst" | null (suvenir, tanpa efek). */
  need: "hunger" | "thirst" | null;
  /** Besaran isi ulang meter (0 untuk suvenir). */
  restore: number;
  minPrice: number;
  maxPrice: number;
  defaultPrice: number;
}

/**
 * Katalog lapak (Tahap 7): pemilik bebas mengatur harga DI DALAM rentang &
 * stok per barang; di luar rentang ditolak server. Bawaan saat klaim:
 * semua barang tersedia pada harga bawaan.
 */
export const CATALOG: Readonly<Record<string, CatalogItem>> = {
  es_teh: { id: "es_teh", name: "Es Teh", need: "thirst", restore: 60, minPrice: 5, maxPrice: 25, defaultPrice: 10 },
  kopi: { id: "kopi", name: "Kopi", need: "thirst", restore: 40, minPrice: 5, maxPrice: 30, defaultPrice: 15 },
  bakso: { id: "bakso", name: "Bakso", need: "hunger", restore: 80, minPrice: 15, maxPrice: 60, defaultPrice: 35 },
  batik: { id: "batik", name: "Batik", need: null, restore: 0, minPrice: 50, maxPrice: 250, defaultPrice: 100 },
};
export const CATALOG_IDS: ReadonlyArray<string> = ["es_teh", "kopi", "bakso", "batik"];

// ---------- Penyimpanan kepemilikan & kas (persisten, pola sama seperti plots.json) ----------

export interface MenuEntry {
  price: number;
  stocked: boolean;
}

export interface SaleEntry {
  /** Nama pengguna tampilan pembeli. */
  buyer: string;
  /** Id barang di katalog. */
  item: string;
  /** Harga yang benar-benar dibayar (KC). */
  price: number;
  ts: number;
}

export interface LapakRecord {
  /** Kunci akun pemilik (nama pengguna huruf kecil). */
  owner: string;
  /** Nama pengguna tampilan pemilik (untuk papan & state publik). */
  ownerName: string;
  /** Nama lapak (maks. 20 char, sudah disanitasi room). */
  name: string;
  /** Kas usaha terkumpul (KC) — PRIVAT, hanya untuk pemilik; TIDAK masuk state room. */
  kas: number;
  /** Menu: itemId -> harga & stok (PUBLIK lewat state room, untuk panel pembeli). */
  menu: Record<string, MenuEntry>;
  /** Log penjualan terakhir (maks. 20) — PRIVAT, hanya untuk pemilik. */
  sales: SaleEntry[];
  claimedAt: number;
}

interface MarketDB {
  lapaks: Record<string, LapakRecord>;
}

const DATA_DIR = process.env.KOTA_DATA_DIR || join(process.cwd(), "data");
const MARKET_FILE = join(DATA_DIR, "market.json");
const MAX_SALES_LOG = 20;

function defaultMenu(): Record<string, MenuEntry> {
  const menu: Record<string, MenuEntry> = {};
  for (const id of CATALOG_IDS) {
    menu[id] = { price: CATALOG[id].defaultPrice, stocked: true };
  }
  return menu;
}

export class MarketStore {
  private db: MarketDB = { lapaks: {} };

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(MARKET_FILE)) {
      try {
        this.db = JSON.parse(readFileSync(MARKET_FILE, "utf8")) as MarketDB;
      } catch {
        this.db = { lapaks: {} };
      }
    }
    this.db.lapaks ??= {};
    // Migrasi lembut: lengkapi menu/kolom yang mungkin kurang pada data lama.
    for (const rec of Object.values(this.db.lapaks)) {
      rec.kas = typeof rec.kas === "number" && Number.isFinite(rec.kas) ? rec.kas : 0;
      rec.sales ??= [];
      rec.menu ??= {};
      for (const id of CATALOG_IDS) {
        const entry = rec.menu[id];
        if (!entry || typeof entry.price !== "number") {
          rec.menu[id] = { price: CATALOG[id].defaultPrice, stocked: entry?.stocked ?? true };
        }
      }
    }
  }

  private save() {
    const tmp = MARKET_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.db, null, 1));
    renameSync(tmp, MARKET_FILE);
  }

  /** Catatan satu lapak (null = masih kosong/belum diklaim). */
  get(lapakId: string): LapakRecord | null {
    return this.db.lapaks[lapakId] ?? null;
  }

  /** Id lapak milik satu akun (null = belum punya) — penegak aturan 1 akun 1 lapak. */
  lapakOfAccount(accountKey: string): string | null {
    for (const [id, rec] of Object.entries(this.db.lapaks)) {
      if (rec.owner === accountKey) return id;
    }
    return null;
  }

  /** Jumlah lapak yang sudah dimiliki warga (statistik Tahap 8). */
  ownedCount(): number {
    return Object.keys(this.db.lapaks).length;
  }

  /** Catat klaim. Pemanggil (room) WAJIB sudah memvalidasi: lapak kosong, akun belum punya, saldo sudah dipotong. */
  claim(lapakId: string, accountKey: string, ownerName: string) {
    this.db.lapaks[lapakId] = {
      owner: accountKey,
      ownerName,
      name: `Lapak ${ownerName}`.slice(0, 20),
      kas: 0,
      menu: defaultMenu(),
      sales: [],
      claimedAt: Date.now(),
    };
    this.save();
  }

  /** Ganti nama lapak (sudah disanitasi & divalidasi pemilik oleh room). */
  setName(lapakId: string, name: string) {
    const rec = this.db.lapaks[lapakId];
    if (!rec) return;
    rec.name = name;
    this.save();
  }

  /** Atur harga/stok satu barang (sudah divalidasi rentang & pemilik oleh room). */
  setMenuItem(lapakId: string, itemId: string, price: number, stocked: boolean) {
    const rec = this.db.lapaks[lapakId];
    if (!rec || !CATALOG[itemId]) return;
    rec.menu[itemId] = { price, stocked };
    this.save();
  }

  /**
   * Catat satu penjualan yang SUDAH lolos semua validasi & pembayaran di
   * room: kas usaha bertambah sebesar harga, log ditambah (maks. 20 terakhir).
   */
  recordSale(lapakId: string, buyerName: string, itemId: string, price: number) {
    const rec = this.db.lapaks[lapakId];
    if (!rec) return;
    rec.kas += price;
    rec.sales.push({ buyer: buyerName, item: itemId, price, ts: Date.now() });
    if (rec.sales.length > MAX_SALES_LOG) rec.sales = rec.sales.slice(-MAX_SALES_LOG);
    this.save();
  }

  /** Ambil seluruh kas usaha: mengembalikan jumlahnya dan mengosongkan kas. */
  collectKas(lapakId: string): number {
    const rec = this.db.lapaks[lapakId];
    if (!rec) return 0;
    const amount = rec.kas;
    rec.kas = 0;
    this.save();
    return amount;
  }
}

/** Singleton yang dipakai room Colyseus. */
export const market = new MarketStore();
