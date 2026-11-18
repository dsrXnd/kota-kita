import * as THREE from "three";
import type { Interactable } from "./Plaza";

/**
 * Kampung Kita (Tahap 6) — kawasan kavling & rumah pribadi di timur plaza.
 *
 * Denah di file ini HARUS sama dengan server (server/src/housing/housing.ts):
 * posisi/ukuran kavling dan jejak rumah menentukan kotak tabrakan yang sama
 * di client & server. Kepemilikan & tingkat rumah TIDAK dihitung di sini —
 * semuanya datang dari state room (server otoritatif); modul ini hanya
 * menggambar ulang distrik setiap kali state berubah.
 */

export interface PlotDef {
  id: string;
  tier: 1 | 2;
  number: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  face: 1 | -1;
}

function buildPlots(): PlotDef[] {
  const plots: PlotDef[] = [];
  const k2x = [53, 71, 89, 107];
  k2x.forEach((cx, i) => plots.push({ id: `k2_${i + 1}`, tier: 2, number: i + 1, cx, cz: -12.5, w: 14, d: 13, face: 1 }));
  k2x.forEach((cx, i) => plots.push({ id: `k2_${i + 5}`, tier: 2, number: i + 5, cx, cz: 12.5, w: 14, d: 13, face: -1 }));
  const k1x = [50, 61, 72, 83, 94, 105, 116, 127];
  k1x.forEach((cx, i) => plots.push({ id: `k1_${i + 1}`, tier: 1, number: i + 1, cx, cz: -28, w: 10, d: 12, face: 1 }));
  k1x.forEach((cx, i) => plots.push({ id: `k1_${i + 9}`, tier: 1, number: i + 9, cx, cz: 28, w: 10, d: 12, face: -1 }));
  return plots;
}

export const PLOTS: ReadonlyArray<PlotDef> = buildPlots();
export const PLOT_BY_ID: ReadonlyMap<string, PlotDef> = new Map(PLOTS.map((p) => [p.id, p]));
export const PLOT_PRICE: Readonly<Record<number, number>> = { 1: 2500, 2: 5000 };

/** Jejak bangunan per tingkat rumah — sama dengan HOUSES di server. */
export const HOUSE_SIZE: Readonly<Record<number, { w: number; d: number }>> = {
  1: { w: 6, d: 5 },
  2: { w: 8, d: 6.5 },
  3: { w: 8, d: 7 },
};
export const HOUSE_NAME: Readonly<Record<number, string>> = {
  1: "Rumah Bambu",
  2: "Rumah Batu",
  3: "Rumah Tingkat",
};
export const HOUSE_PRICE: Readonly<Record<number, number>> = { 0: 0, 1: 2000, 2: 5000, 3: 7500 };

/** Pusat bangunan rumah di kavling (sama seperti houseCenter di server). */
export function houseCenter(plot: PlotDef, houseTier: number): { x: number; z: number } {
  const size = HOUSE_SIZE[houseTier];
  const back = plot.d / 2 - size.d / 2 - 1;
  return { x: plot.cx, z: plot.cz - plot.face * back };
}

/** Kotak tabrakan rumah: [minX, maxX, minZ, maxZ] — sama seperti houseBox di server. */
export function houseBox(
  plot: PlotDef,
  houseTier: number
): readonly [number, number, number, number] | null {
  const size = HOUSE_SIZE[houseTier];
  if (!size) return null;
  const c = houseCenter(plot, houseTier);
  return [c.x - size.w / 2, c.x + size.w / 2, c.z - size.d / 2, c.z + size.d / 2];
}

// Palet (selaras docs/art-style.md & Plaza.ts)
const COLORS = {
  road: 0x6b6f76,
  stone: 0xe8dcc8,
  cream: 0xf2e3c9,
  roof: 0xb5533c,
  roofDark: 0x7a4a2b,
  wood: 0x9a6b43,
  leaf: 0x3e9b4f,
  leafLight: 0x57b25e,
  trunk: 0x8a5a33,
  dirt1: 0xd9c69c,
  dirt2: 0xcfe0ae,
  hedge: 0x4da657,
  bamboo: 0xdcbd7f,
  thatch: 0xb99b5f,
  glass: 0xbfe3f2,
};

function mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0, ...opts });
}

interface Board {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
}

interface PlotVisual {
  def: PlotDef;
  board: Board;
  owner: string;
  house: number;
  houseGroup: THREE.Group | null;
}

/** Keadaan kavling minimal dari state room (yang dikirim server). */
export interface PlotStateLike {
  owner: string;
  house: number;
}

export class Kampung {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  private visuals = new Map<string, PlotVisual>();

  constructor() {
    this.buildRoads();
    this.buildGate();
    for (const def of PLOTS) this.buildPlot(def);
    this.buildGreenery();
  }

  // ---------- jalan & gerbang ----------

  private buildRoads() {
    // Jalan utama ke timur: dari tepi plaza (x 16) sampai ujung distrik (x 134).
    const road = new THREE.Mesh(new THREE.PlaneGeometry(118, 8), mat(COLORS.road));
    road.rotation.x = -Math.PI / 2;
    road.position.set(75, 0.015, 0);
    road.receiveShadow = true;
    this.group.add(road);
    // Jalan lingkungan di depan baris Kavling 1 (utara & selatan).
    for (const z of [-20.5, 20.5]) {
      const street = new THREE.Mesh(new THREE.PlaneGeometry(88, 3), mat(COLORS.stone));
      street.rotation.x = -Math.PI / 2;
      street.position.set(88, 0.018, z);
      street.receiveShadow = true;
      this.group.add(street);
    }
  }

  private buildGate() {
    const g = new THREE.Group();
    for (const sz of [-4.6, 4.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.4, 0.35), mat(COLORS.wood));
      post.position.set(0, 2.2, sz);
      post.castShadow = true;
      g.add(post);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(8.6, 1.7),
      new THREE.MeshBasicMaterial({ map: this.textTexture("KAMPUNG KITA", "#7a4a2b", 84), side: THREE.DoubleSide })
    );
    sign.position.y = 3.9;
    g.add(sign);
    g.position.set(44, 0, 0);
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

  // ---------- kavling ----------

  private buildPlot(def: PlotDef) {
    // Alas petak: Kavling 2 dapat bingkai pagar tanaman (petak premium).
    if (def.tier === 2) {
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(def.w + 0.8, def.d + 0.8), mat(COLORS.hedge));
      frame.rotation.x = -Math.PI / 2;
      frame.position.set(def.cx, 0.01, def.cz);
      frame.receiveShadow = true;
      this.group.add(frame);
    }
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(def.w, def.d),
      mat(def.tier === 2 ? COLORS.dirt2 : COLORS.dirt1)
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(def.cx, 0.012, def.cz);
    pad.receiveShadow = true;
    this.group.add(pad);

    // Papan nomor + pemilik di tepi depan petak, menghadap jalan.
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

    const visual: PlotVisual = {
      def,
      board: { canvas, ctx, tex },
      owner: "",
      house: 0,
      houseGroup: null,
    };
    this.visuals.set(def.id, visual);
    this.drawBoard(visual);

    this.interactables.push({
      id: `plot:${def.id}`,
      label: `Kavling ${def.tier} No. ${def.number}`,
      description: "",
      position: new THREE.Vector3(def.cx, 0, boardZ),
      radius: 4.5,
    });
  }

  private drawBoard(v: PlotVisual) {
    const { ctx, tex } = v.board;
    const g = ctx;
    g.fillStyle = v.def.tier === 2 ? "#8a6d1f" : "#7a4a2b";
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.font = "bold 62px system-ui, sans-serif";
    g.fillText(`KAVLING ${v.def.tier} · ${v.def.number}`, 256, 92);
    g.font = "bold 52px system-ui, sans-serif";
    g.fillStyle = v.owner ? "#ffd97a" : "#cfe8c0";
    const line = v.owner ? `@${v.owner}` : "— KOSONG —";
    g.fillText(line.slice(0, 18), 256, 182);
    tex.needsUpdate = true;
  }

  // ---------- rumah (dibangun dari state) ----------

  private doorAndWindow(front: number, w: number) {
    const parts: THREE.Object3D[] = [];
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.1), mat(COLORS.wood));
    door.position.set(-w / 4, 1.15, front);
    parts.push(door);
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.4, 0.1),
      new THREE.MeshStandardMaterial({ color: COLORS.glass, roughness: 0.15, metalness: 0.1 })
    );
    win.position.set(w / 4.5, 1.8, front);
    parts.push(win);
    return parts;
  }

  /** Bangun model rumah satu tingkat katalog. Grup menghadap +z; pemanggil memutar sesuai hadap kavling. */
  private buildHouse(tier: number): THREE.Group {
    const g = new THREE.Group();
    if (tier === 1) {
      // Rumah Bambu: dinding anyaman terang + tiang kayu + atap jerami limasan.
      const size = HOUSE_SIZE[1];
      const walls = new THREE.Mesh(new THREE.BoxGeometry(size.w, 3, size.d), mat(COLORS.bamboo));
      walls.position.y = 1.5;
      walls.castShadow = true;
      walls.receiveShadow = true;
      g.add(walls);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.4, 0.28), mat(COLORS.wood));
          post.position.set(sx * (size.w / 2 - 0.1), 1.7, sz * (size.d / 2 - 0.1));
          g.add(post);
        }
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.9, 2.1, 4), mat(COLORS.thatch));
      roof.position.y = 4.05;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      g.add(roof);
      for (const p of this.doorAndWindow(size.d / 2 + 0.03, size.w)) g.add(p);
    } else if (tier === 2) {
      // Rumah Batu: dinding batu krem + atap genteng limasan + cerobong.
      const size = HOUSE_SIZE[2];
      const walls = new THREE.Mesh(new THREE.BoxGeometry(size.w, 3.4, size.d), mat(0xe6dbc4));
      walls.position.y = 1.7;
      walls.castShadow = true;
      walls.receiveShadow = true;
      g.add(walls);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(6.3, 2.6, 4), mat(COLORS.roof));
      roof.position.y = 4.7;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      g.add(roof);
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.7), mat(0xb0a08a));
      chimney.position.set(2.4, 4.6, -1.2);
      g.add(chimney);
      for (const p of this.doorAndWindow(size.d / 2 + 0.03, size.w)) g.add(p);
    } else {
      // Rumah Tingkat: dua lantai + balkon depan + atap limasan.
      const size = HOUSE_SIZE[3];
      const floor1 = new THREE.Mesh(new THREE.BoxGeometry(size.w, 3, size.d), mat(0xe6dbc4));
      floor1.position.y = 1.5;
      floor1.castShadow = true;
      floor1.receiveShadow = true;
      g.add(floor1);
      const floor2 = new THREE.Mesh(new THREE.BoxGeometry(size.w - 0.4, 2.8, size.d - 0.4), mat(COLORS.cream));
      floor2.position.y = 4.4;
      floor2.castShadow = true;
      floor2.receiveShadow = true;
      g.add(floor2);
      // Balkon di sisi depan lantai dua.
      const balcony = new THREE.Mesh(new THREE.BoxGeometry(size.w - 1, 0.22, 1.5), mat(COLORS.wood));
      balcony.position.set(0, 3.05, size.d / 2 + 0.7);
      balcony.castShadow = true;
      g.add(balcony);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(size.w - 1, 0.7, 0.08), mat(COLORS.wood));
      rail.position.set(0, 3.55, size.d / 2 + 1.4);
      g.add(rail);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 2.4, 4), mat(COLORS.roof));
      roof.position.y = 7;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      g.add(roof);
      for (const p of this.doorAndWindow(size.d / 2 + 0.03, size.w)) g.add(p);
      const win2 = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 1.2, 0.1),
        new THREE.MeshStandardMaterial({ color: COLORS.glass, roughness: 0.15, metalness: 0.1 })
      );
      win2.position.set(0, 4.6, size.d / 2 - 0.17);
      g.add(win2);
    }
    return g;
  }

  // ---------- sinkronisasi state ----------

  /**
   * Terapkan keadaan kavling dari state room. Hanya menggambar ulang yang
   * berubah (papan pemilik / model rumah) agar hemat di HP.
   */
  sync(state: { get(id: string): PlotStateLike | undefined } | null) {
    if (!state) return;
    for (const v of this.visuals.values()) {
      const s = state.get(v.def.id);
      if (!s) continue;
      if (s.owner !== v.owner) {
        v.owner = s.owner;
        this.drawBoard(v);
      }
      if (s.house !== v.house) {
        v.house = s.house;
        if (v.houseGroup) {
          this.group.remove(v.houseGroup);
          v.houseGroup = null;
        }
        if (v.house > 0) {
          const house = this.buildHouse(v.house);
          const c = houseCenter(v.def, v.house);
          house.position.set(c.x, 0, c.z);
          house.rotation.y = v.def.face === 1 ? 0 : Math.PI;
          this.group.add(house);
          v.houseGroup = house;
        }
      }
    }
  }

  /** Kotak tabrakan semua rumah yang sedang berdiri — diturunkan dari state terakhir, sama seperti server. */
  houseColliders(): Array<readonly [number, number, number, number]> {
    const boxes: Array<readonly [number, number, number, number]> = [];
    for (const v of this.visuals.values()) {
      const box = houseBox(v.def, v.house);
      if (box) boxes.push(box);
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
    const blobs: Array<[number, number, number, number]> = [
      [0, 3.4, 0, 1.7],
      [0.9, 2.8, 0.3, 1.2],
      [-0.9, 2.9, -0.2, 1.25],
    ];
    for (const [bx, by, bz, r] of blobs) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat(COLORS.leaf));
      leaf.position.set(bx, by, bz);
      leaf.castShadow = true;
      g.add(leaf);
    }
    this.group.add(g);
  }

  private buildGreenery() {
    // Taman kecil di ujung timur baris premium + pepohonan di celah antar-kavling & tepi gerbang.
    this.tree(124, -12.5, 1.2);
    this.tree(130, -9, 1);
    this.tree(127, -16, 1.1);
    this.tree(120, -6, 1.05);
    this.tree(62, 17.5, 0.9);
    this.tree(98, -17.5, 0.95);
    this.tree(119, 17.5, 0.9);
    this.tree(45, 9, 1);
  }
}
