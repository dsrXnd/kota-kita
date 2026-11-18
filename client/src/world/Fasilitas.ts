import * as THREE from "three";

/**
 * Fasilitas Kota (Tahap 8) — set aset yang disiapkan lebih dulu dan
 * DIAKTIFKAN server lewat voting warga: Taman Bunga, Lapangan Futsal,
 * Perpustakaan Mini.
 *
 * Denah & jejak tabrakan di file ini HARUS sama dengan server
 * (server/src/city/city.ts). Fasilitas TIDAK digambar dan TIDAK punya
 * collider sebelum aktif — daftar id aktif datang dari state room
 * (server otoritatif); modul ini hanya membangun/membongkar model dari
 * daftar itu, termasuk saat fasilitas aktif di tengah sesi.
 */

export interface FacilityDef {
  id: string;
  name: string;
  cx: number;
  cz: number;
}

export const FACILITIES: ReadonlyArray<FacilityDef> = [
  { id: "taman_bunga", name: "Taman Bunga", cx: -36, cz: -32 },
  { id: "lapangan_futsal", name: "Lapangan Futsal", cx: -36, cz: 32 },
  { id: "perpustakaan", name: "Perpustakaan Mini", cx: -24, cz: -39 },
];
export const FACILITY_BY_ID: ReadonlyMap<string, FacilityDef> = new Map(FACILITIES.map((f) => [f.id, f]));

type Box = readonly [number, number, number, number];

/** Bedeng bunga Taman Bunga: [tengah x, tengah z, lebar x, kedalaman z] — sama dengan server. */
const TAMAN_BEDS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-39.2, -34.6, 3.6, 1.4],
  [-32.8, -34.6, 3.6, 1.4],
  [-39.2, -29.4, 3.6, 1.4],
  [-32.8, -29.4, 3.6, 1.4],
];
/** Gawang Lapangan Futsal: [minX, maxX, minZ, maxZ] — sama dengan server. */
const FUTSAL_GOALS: ReadonlyArray<Box> = [
  [-38.5, -33.5, 24.2, 25.0],
  [-38.5, -33.5, 39.0, 39.8],
];
/** Dinding Perpustakaan Mini — sama dengan server. */
const PERPUSTAKAAN_BOX: Box = [-28, -20, -41.25, -36.75];

/** Kotak tabrakan satu fasilitas — sama seperti facilityBoxes di server. */
export function facilityBoxes(facilityId: string): ReadonlyArray<Box> {
  switch (facilityId) {
    case "taman_bunga":
      return TAMAN_BEDS.map(([cx, cz, w, d]) => [cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2] as Box);
    case "lapangan_futsal":
      return FUTSAL_GOALS;
    case "perpustakaan":
      return [PERPUSTAKAAN_BOX];
    default:
      return [];
  }
}

// Palet (selaras docs/art-style.md & Plaza.ts)
const COLORS = {
  stone: 0xe8dcc8,
  cream: 0xf2e3c9,
  roof: 0xb5533c,
  wood: 0x9a6b43,
  trunk: 0x8a5a33,
  leaf: 0x3e9b4f,
  leafLight: 0x57b25e,
  soil: 0x6e4f30,
  court: 0x3f9e57,
  line: 0xffffff,
  glass: 0xbfe3f2,
};

function mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0, ...opts });
}

function signTexture(text: string, bg: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = "#ffffff";
  g.font = "bold 54px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Fasilitas {
  readonly group = new THREE.Group();
  private builtGroups = new Map<string, THREE.Group>();
  private activeIds = new Set<string>();

  /**
   * Terapkan daftar fasilitas aktif dari state room: bangun model yang
   * baru aktif (langsung tampil walau di tengah sesi), bongkar yang hilang.
   */
  sync(activeIds: ReadonlyArray<string>) {
    const next = new Set(activeIds.filter((id) => FACILITY_BY_ID.has(id)));
    for (const id of next) {
      if (!this.builtGroups.has(id)) {
        const g = this.build(id);
        if (g) {
          this.group.add(g);
          this.builtGroups.set(id, g);
        }
      }
    }
    for (const [id, g] of [...this.builtGroups]) {
      if (!next.has(id)) {
        this.group.remove(g);
        this.builtGroups.delete(id);
      }
    }
    this.activeIds = next;
  }

  /** Kotak tabrakan semua fasilitas yang sedang aktif — diturunkan dari daftar aktif, sama seperti server. */
  colliders(): Array<Box> {
    const boxes: Array<Box> = [];
    for (const id of this.activeIds) boxes.push(...facilityBoxes(id));
    return boxes;
  }

  private build(id: string): THREE.Group | null {
    switch (id) {
      case "taman_bunga":
        return this.buildTamanBunga();
      case "lapangan_futsal":
        return this.buildFutsal();
      case "perpustakaan":
        return this.buildPerpustakaan();
      default:
        return null;
    }
  }

  // ---------- Taman Bunga (barat laut, tengah -36,-32) ----------

  private buildTamanBunga(): THREE.Group {
    const def = FACILITY_BY_ID.get("taman_bunga")!;
    const g = new THREE.Group();
    // Alas taman batu pucat.
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(12.6, 12.6), mat(COLORS.stone));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(def.cx, 0.014, def.cz);
    pad.receiveShadow = true;
    g.add(pad);

    // Empat bedeng bunga: kotak tanah (= collider) + bunga warna-warni.
    const flowerColors = [0xe3772e, 0xd64545, 0xe3b23c, 0x9b59b6, 0xff7fab];
    TAMAN_BEDS.forEach(([bx, bz, w, d], bedIdx) => {
      const soil = new THREE.Mesh(new THREE.BoxGeometry(w, 0.35, d), mat(COLORS.soil));
      soil.position.set(bx, 0.18, bz);
      soil.castShadow = true;
      soil.receiveShadow = true;
      g.add(soil);
      for (let i = 0; i < 5; i++) {
        const flower = new THREE.Mesh(
          new THREE.SphereGeometry(0.21, 8, 6),
          mat(flowerColors[(bedIdx * 2 + i) % flowerColors.length])
        );
        flower.position.set(bx - w / 2 + 0.45 + i * ((w - 0.9) / 4), 0.5, bz + (i % 2 === 0 ? -0.25 : 0.25));
        flower.castShadow = true;
        g.add(flower);
      }
    });

    // Pohon peneduh di tengah + dua bangku menghadap bedeng.
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.38, 2.1, 8), mat(COLORS.trunk));
    trunk.position.set(def.cx, 1.05, def.cz);
    trunk.castShadow = true;
    g.add(trunk);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.8, 10, 8), mat(COLORS.leaf));
    crown.position.set(def.cx, 3.5, def.cz);
    crown.castShadow = true;
    g.add(crown);
    for (const bz of [def.cz - 4.6, def.cz + 4.6]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.6), mat(COLORS.wood));
      seat.position.set(def.cx, 0.55, bz);
      seat.castShadow = true;
      g.add(seat);
      for (const sx of [-0.9, 0.9]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.55), mat(0x555a60));
        leg.position.set(def.cx + sx, 0.27, bz);
        g.add(leg);
      }
    }
    return g;
  }

  // ---------- Lapangan Futsal (barat daya, tengah -36,32) ----------

  private buildFutsal(): THREE.Group {
    const def = FACILITY_BY_ID.get("lapangan_futsal")!;
    const g = new THREE.Group();
    // Lapangan hijau 11 x 17 m.
    const court = new THREE.Mesh(new THREE.PlaneGeometry(11, 17), mat(COLORS.court));
    court.rotation.x = -Math.PI / 2;
    court.position.set(def.cx, 0.016, def.cz);
    court.receiveShadow = true;
    g.add(court);

    // Garis putih: keliling + garis tengah + lingkaran tengah.
    const lineMat = new THREE.MeshBasicMaterial({ color: COLORS.line });
    const mkLine = (w: number, d: number, x: number, z: number) => {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.022, z);
      g.add(line);
    };
    mkLine(11, 0.18, def.cx, def.cz - 8.5);
    mkLine(11, 0.18, def.cx, def.cz + 8.5);
    mkLine(0.18, 17, def.cx - 5.5, def.cz);
    mkLine(0.18, 17, def.cx + 5.5, def.cz);
    mkLine(11, 0.18, def.cx, def.cz);
    const circle = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.73, 28), lineMat);
    circle.rotation.x = -Math.PI / 2;
    circle.position.set(def.cx, 0.022, def.cz);
    g.add(circle);

    // Dua gawang (tiang + mistar + jaring samar) — jejaknya = collider server.
    for (const gz of [24.6, 39.4]) {
      const goal = new THREE.Group();
      const postMat = mat(0xf2f2f2);
      for (const px of [-38.5, -33.5]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.1, 8), postMat);
        post.position.set(px, 1.05, gz);
        post.castShadow = true;
        goal.add(post);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 5.18, 8), postMat);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(-36, 2.1, gz);
      bar.castShadow = true;
      goal.add(bar);
      const net = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
      );
      net.position.set(-36, 1.05, gz);
      goal.add(net);
      g.add(goal);
    }

    // Bola futsal diam di tengah lapangan + bendera sudut.
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 10), mat(0xf5f5f5));
    ball.position.set(def.cx, 0.33, def.cz);
    ball.castShadow = true;
    g.add(ball);
    for (const [fx, fz] of [
      [-41.5, 23.5],
      [-30.5, 23.5],
      [-41.5, 40.5],
      [-30.5, 40.5],
    ] as const) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6), mat(0xe3b23c));
      pole.position.set(fx, 0.75, fz);
      g.add(pole);
    }
    return g;
  }

  // ---------- Perpustakaan Mini (utara, tengah -24,-39) ----------

  private buildPerpustakaan(): THREE.Group {
    const def = FACILITY_BY_ID.get("perpustakaan")!;
    const g = new THREE.Group();
    const base = new THREE.Group();
    base.position.set(def.cx, 0, def.cz);
    // Badan bangunan 8 x 4.5 m (= collider server), menghadap +z (selatan).
    const walls = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 4.5), mat(COLORS.cream));
    walls.position.y = 1.7;
    walls.castShadow = true;
    walls.receiveShadow = true;
    base.add(walls);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 2.2, 4), mat(COLORS.roof));
    roof.position.y = 4.5;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    base.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.1), mat(COLORS.wood));
    door.position.set(-1.8, 1.2, 2.28);
    base.add(door);
    for (const wx of [0.6, 2.6]) {
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1.3, 0.1),
        new THREE.MeshStandardMaterial({ color: COLORS.glass, roughness: 0.15, metalness: 0.1 })
      );
      win.position.set(wx, 1.9, 2.28);
      base.add(win);
    }
    const steps = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, 1), mat(COLORS.stone));
    steps.position.set(-1.8, 0.15, 2.9);
    steps.receiveShadow = true;
    base.add(steps);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6.6, 1.35),
      new THREE.MeshBasicMaterial({ map: signTexture("PERPUSTAKAAN", "#3b4a6b") })
    );
    sign.position.set(0, 2.95, 2.31);
    base.add(sign);
    // Semak di dua sisi bangunan.
    for (const sx of [-4.6, 4.6]) {
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.85, 9, 7), mat(COLORS.leafLight));
      bush.position.set(sx, 0.7, 0.8);
      bush.castShadow = true;
      base.add(bush);
    }
    g.add(base);
    return g;
  }
}
