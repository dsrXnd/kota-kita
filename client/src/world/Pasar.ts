import * as THREE from "three";
import type { Interactable } from "./Plaza";

/**
 * Pasar (Tahap 7) — kawasan usaha pemain di SELATAN Plaza Utama.
 *
 * Denah di file ini HARUS sama dengan server (server/src/market/market.ts):
 * posisi/ukuran lapak dan jejak meja menentukan kotak tabrakan yang sama di
 * client & server. Kepemilikan, nama, menu & harga TIDAK dihitung di sini —
 * semuanya datang dari state room (server otoritatif); kas usaha bahkan
 * tidak pernah dikirim ke client selain pemiliknya (pesan privat).
 * Modul ini hanya menggambar ulang distrik setiap kali state berubah.
 */

export interface LapakDef {
  id: string;
  number: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  face: 1 | -1;
}

function buildLapaks(): LapakDef[] {
  const lapaks: LapakDef[] = [];
  const xs = [-32, -16, 0, 16, 32];
  xs.forEach((cx, i) => lapaks.push({ id: `lp_${i + 1}`, number: i + 1, cx, cz: 46, w: 7, d: 6, face: 1 }));
  xs.forEach((cx, i) => lapaks.push({ id: `lp_${i + 6}`, number: i + 6, cx, cz: 58, w: 7, d: 6, face: -1 }));
  return lapaks;
}

export const LAPAKS: ReadonlyArray<LapakDef> = buildLapaks();
export const LAPAK_BY_ID: ReadonlyMap<string, LapakDef> = new Map(LAPAKS.map((l) => [l.id, l]));
export const LAPAK_PRICE = 10000;

/** Jejak meja lapak — sama dengan STALL_W/STALL_D di server. */
export const STALL_W = 5;
export const STALL_D = 2.5;

/** Pusat bangunan lapak di petaknya (sama seperti stallCenter di server). */
export function stallCenter(def: LapakDef): { x: number; z: number } {
  const back = def.d / 2 - STALL_D / 2 - 0.5;
  return { x: def.cx, z: def.cz - def.face * back };
}

/** Kotak tabrakan meja lapak: [minX, maxX, minZ, maxZ] — sama seperti stallBox di server. */
export function stallBox(def: LapakDef): readonly [number, number, number, number] {
  const c = stallCenter(def);
  return [c.x - STALL_W / 2, c.x + STALL_W / 2, c.z - STALL_D / 2, c.z + STALL_D / 2];
}

export interface LapakCatalogItem {
  id: string;
  name: string;
  /** Teks efek untuk panel (minuman/makanan mengisi meter; batik = suvenir). */
  effectText: string;
  minPrice: number;
  maxPrice: number;
  defaultPrice: number;
}

/** Katalog lapak untuk tampilan panel — angka HARUS sama dengan CATALOG di server. */
export const LAPAK_CATALOG: ReadonlyArray<LapakCatalogItem> = [
  { id: "es_teh", name: "Es Teh", effectText: "💧 Haus +60", minPrice: 5, maxPrice: 25, defaultPrice: 10 },
  { id: "kopi", name: "Kopi", effectText: "💧 Haus +40", minPrice: 5, maxPrice: 30, defaultPrice: 15 },
  { id: "bakso", name: "Bakso", effectText: "🍗 Lapar +80", minPrice: 15, maxPrice: 60, defaultPrice: 35 },
  { id: "batik", name: "Batik", effectText: "🎁 Suvenir koleksi", minPrice: 50, maxPrice: 250, defaultPrice: 100 },
];
export const LAPAK_CATALOG_BY_ID: ReadonlyMap<string, LapakCatalogItem> = new Map(
  LAPAK_CATALOG.map((i) => [i.id, i])
);

// Palet (selaras docs/art-style.md & Plaza.ts/Kampung.ts)
const COLORS = {
  road: 0x6b6f76,
  stone: 0xe8dcc8,
  dirt: 0xd9c69c,
  floor: 0xe3d3ae,
  wood: 0x9a6b43,
  woodDark: 0x7a4a2b,
  leaf: 0x3e9b4f,
  trunk: 0x8a5a33,
  crate: 0xb98d55,
};

/** Warna terpal per nomor lapak (berputar) — identitas visual tiap lapak. */
const TERPAL_COLORS = [0xe3772e, 0x2e8c83, 0xe3b23c, 0x7a4a9e, 0xd64545];

function mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0, ...opts });
}

interface Board {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
}

interface LapakVisual {
  def: LapakDef;
  board: Board;
  owner: string;
  name: string;
  stallGroup: THREE.Group | null;
}

/** Keadaan lapak minimal dari state room (yang dikirim server). */
export interface LapakStateLike {
  owner: string;
  name: string;
}

export class Pasar {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  private visuals = new Map<string, LapakVisual>();

  constructor() {
    this.buildGroundAndStreet();
    this.buildGate();
    for (const def of LAPAKS) this.buildLapak(def);
    this.buildGreenery();
  }

  // ---------- tanah, jalan & gerbang ----------

  private buildGroundAndStreet() {
    // Lantai kawasan pasar (batu pucat) menutupi area selatan plaza.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(94, 27), mat(COLORS.floor));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.008, 55.5);
    floor.receiveShadow = true;
    this.group.add(floor);
    // Jalan pasar: aspal barat–timur di antara dua baris lapak.
    const street = new THREE.Mesh(new THREE.PlaneGeometry(88, 6), mat(COLORS.road));
    street.rotation.x = -Math.PI / 2;
    street.position.set(0, 0.015, 52);
    street.receiveShadow = true;
    this.group.add(street);
    // Jalan batu penghubung dari plaza (selatan ruko) ke gerbang pasar.
    const path = new THREE.Mesh(new THREE.PlaneGeometry(5, 15), mat(COLORS.stone));
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.012, 41.5);
    path.receiveShadow = true;
    this.group.add(path);
  }

  private buildGate() {
    const g = new THREE.Group();
    for (const sx of [-3.4, 3.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.2, 0.35), mat(COLORS.wood));
      post.position.set(sx, 2.1, 0);
      post.castShadow = true;
      g.add(post);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(8.2, 1.6),
      new THREE.MeshBasicMaterial({ map: this.textTexture("PASAR KOTA KITA", "#a3542a", 76), side: THREE.DoubleSide })
    );
    sign.position.y = 3.7;
    g.add(sign);
    g.position.set(0, 0, 44);
    this.group.add(g);
  }

  private textTexture(text: string, bg: string, fontPx: number): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = "#ffffff";
    g.font = `bold ${fontPx}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 256, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---------- lapak ----------

  private buildLapak(def: LapakDef) {
    // Alas petak lapak.
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(def.w, def.d), mat(COLORS.dirt));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(def.cx, 0.012, def.cz);
    pad.receiveShadow = true;
    this.group.add(pad);

    // Papan nomor + nama lapak + pemilik di tepi depan petak, menghadap jalan.
    const boardZ = def.cz + def.face * (def.d / 2 - 0.6);
    const bg = new THREE.Group();
    bg.position.set(def.cx, 0, boardZ);
    bg.rotation.y = def.face === 1 ? 0 : Math.PI;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), mat(COLORS.wood));
    post.position.y = 0.75;
    bg.add(post);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(2.9, 1.45, 0.1),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    panel.position.y = 1.85;
    bg.add(panel);
    this.group.add(bg);

    const visual: LapakVisual = { def, board: { canvas, ctx, tex }, owner: "", name: "", stallGroup: null };
    this.visuals.set(def.id, visual);
    this.drawBoard(visual);

    this.interactables.push({
      id: `lapak:${def.id}`,
      label: `Lapak No. ${def.number}`,
      description: "",
      position: new THREE.Vector3(def.cx, 0, boardZ),
      radius: 4.5,
    });
  }

  private drawBoard(v: LapakVisual) {
    const { ctx, tex } = v.board;
    const g = ctx;
    g.fillStyle = "#a3542a";
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.font = "bold 58px system-ui, sans-serif";
    g.fillText(`LAPAK ${v.def.number}`, 256, 66);
    g.font = "bold 50px system-ui, sans-serif";
    if (v.owner) {
      g.fillStyle = "#ffd97a";
      g.fillText((v.name || `Lapak ${v.owner}`).slice(0, 18), 256, 142);
      g.font = "bold 42px system-ui, sans-serif";
      g.fillStyle = "#ffffff";
      g.fillText(`@${v.owner}`.slice(0, 20), 256, 208);
    } else {
      g.fillStyle = "#cfe8c0";
      g.fillText("— KOSONG —", 256, 168);
    }
    tex.needsUpdate = true;
  }

  /** Bangun visual gerobak lapak (hanya saat dimiliki): tiang, meja, terpal, peti & barang. */
  private buildStall(def: LapakDef): THREE.Group {
    const g = new THREE.Group();
    const terpal = TERPAL_COLORS[(def.number - 1) % TERPAL_COLORS.length];
    // Empat tiang sudut.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.18), mat(COLORS.wood));
        post.position.set(sx * (STALL_W / 2 - 0.15), 1.3, sz * (STALL_D / 2 + 0.55));
        post.castShadow = true;
        g.add(post);
      }
    }
    // Meja/gerobak: kotak utama selebar jejak tabrakan.
    const counter = new THREE.Mesh(new THREE.BoxGeometry(STALL_W, 1.05, STALL_D), mat(COLORS.woodDark));
    counter.position.y = 0.53;
    counter.castShadow = true;
    counter.receiveShadow = true;
    g.add(counter);
    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(STALL_W + 0.3, 0.12, STALL_D + 0.3), mat(COLORS.wood));
    counterTop.position.y = 1.1;
    counterTop.castShadow = true;
    g.add(counterTop);
    // Terpal miring di atas (grup lokal menghadap +z; pemanggil memutar sesuai hadap).
    const awning = new THREE.Mesh(new THREE.BoxGeometry(STALL_W + 0.9, 0.1, STALL_D + 1.9), mat(terpal));
    awning.position.set(0, 2.75, 0);
    awning.rotation.x = -0.16;
    awning.castShadow = true;
    g.add(awning);
    // Peti barang di samping meja + tumpukan barang warna-warni di atas meja.
    for (const sx of [-1, 1]) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), mat(COLORS.crate));
      crate.position.set(sx * (STALL_W / 2 + 0.75), 0.43, 0.4);
      crate.castShadow = true;
      g.add(crate);
    }
    const goodsColors = [0xe3772e, 0x57b25e, 0xe3b23c, 0xd64545, 0x9db8d2];
    for (let i = 0; i < 4; i++) {
      const goods = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.4, 0.55),
        mat(goodsColors[(def.number + i) % goodsColors.length])
      );
      goods.position.set(-1.7 + i * 1.1, 1.36, (i % 2 === 0 ? -0.5 : 0.45));
      goods.castShadow = true;
      g.add(goods);
    }
    return g;
  }

  // ---------- sinkronisasi state ----------

  /**
   * Terapkan keadaan lapak dari state room. Hanya menggambar ulang yang
   * berubah (papan / gerobak) agar hemat di HP.
   */
  sync(state: { get(id: string): LapakStateLike | undefined } | null) {
    if (!state) return;
    for (const v of this.visuals.values()) {
      const s = state.get(v.def.id);
      if (!s) continue;
      if (s.owner !== v.owner || s.name !== v.name) {
        v.owner = s.owner;
        v.name = s.name;
        this.drawBoard(v);
      }
      const owned = !!s.owner;
      if (owned && !v.stallGroup) {
        const stall = this.buildStall(v.def);
        const c = stallCenter(v.def);
        stall.position.set(c.x, 0, c.z);
        stall.rotation.y = v.def.face === 1 ? 0 : Math.PI;
        this.group.add(stall);
        v.stallGroup = stall;
      } else if (!owned && v.stallGroup) {
        this.group.remove(v.stallGroup);
        v.stallGroup = null;
      }
    }
  }

  /** Kotak tabrakan semua meja lapak yang sedang berdiri — diturunkan dari state terakhir, sama seperti server. */
  stallColliders(): Array<readonly [number, number, number, number]> {
    const boxes: Array<readonly [number, number, number, number]> = [];
    for (const v of this.visuals.values()) {
      if (v.stallGroup) boxes.push(stallBox(v.def));
    }
    return boxes;
  }

  // ---------- penghijauan ----------

  private tree(x: number, z: number, s = 1) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 2.2, 8), mat(COLORS.trunk));
    trunk.position.y = 1.1;
    trunk.castShadow = true;
    g.add(trunk);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), mat(COLORS.leaf));
    leaf.position.set(0, 3.4, 0);
    leaf.castShadow = true;
    g.add(leaf);
    this.group.add(g);
  }

  private buildGreenery() {
    // Pepohonan di ujung barat & timur kawasan pasar + dekat gerbang.
    this.tree(-42, 52, 1.1);
    this.tree(42, 52, 1.1);
    this.tree(-42, 63, 0.95);
    this.tree(42, 41, 0.95);
    this.tree(8, 66, 1.05);
    this.tree(-24, 40.5, 0.9);
  }
}

