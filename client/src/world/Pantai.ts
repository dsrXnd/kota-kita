import * as THREE from "three";
import type { Interactable } from "./Plaza";

/**
 * Pantai (Tahap 9) — kawasan rekreasi di BARAT plaza.
 *
 * Denah (meter dunia, sama dengan server/src/world/world.ts):
 * - Jalan setapak dari celah pagar barat plaza (x -45, z -2..2) ke barat.
 * - Hamparan pasir x -82..-44, z -34..34 — bebas dijelajahi pejalan kaki.
 * - Air mulai x <= -80: BUKAN area renang. Server & prediksi client
 *   menahan pemain di garis pantai (collider air di WORLD_BOXES), jadi
 *   dermaga & air di sini murni pemandangan.
 * - Dua gubuk pantai di (-50, -12) & (-50, 14) — collider-nya ada di
 *   WORLD_BOXES (server + Heights.ts).
 *
 * Performa: geometri & material dipakai ulang antar objek sejenis;
 * total mesh kawasan ini kecil (±60) dan tidak ada cahaya tambahan.
 */

const SAND = 0xe9d9a3;
const GRASS = 0x5fb96a;
const STONE = 0xd8cfc0;
const WOOD = 0x9a6b43;
const TRUNK = 0x8a5a33;
const LEAF = 0x3e9b4f;

function mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95, metalness: 0, ...opts });
}

export class Pantai {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  private water!: THREE.Mesh;
  private foam!: THREE.Mesh;

  constructor() {
    this.buildGround();
    this.buildPalms();
    this.buildUmbrellas();
    this.buildHuts();
    this.buildPier();
    this.buildEdges();

    this.interactables.push({
      id: "pantai",
      label: "Pantai Kota Kita",
      description:
        "🏖️ Pantai Kota Kita — hamparan pasir di barat plaza untuk santai, kumpul, dan foto sunset. Airnya dangkal & berarus, jadi untuk sekarang berenang belum dibuka: ombaknya cukup dinikmati dari garis pantai ya!",
      position: new THREE.Vector3(-58, 0, 0),
      radius: 7,
    });
  }

  /** Animasi ringan air: permukaan naik-turun halus + buih ombak menyapu tepi pasir. */
  update(t: number) {
    if (this.water) this.water.position.y = 0.05 + Math.sin(t * 0.8) * 0.03;
    if (this.foam) {
      this.foam.position.x = -80.4 + Math.sin(t * 0.6) * 0.45;
      const m = this.foam.material as THREE.MeshStandardMaterial;
      m.opacity = 0.35 + Math.sin(t * 0.6) * 0.15;
    }
  }

  private plane(w: number, d: number, color: number, x: number, z: number, y: number, opts: THREE.MeshStandardMaterialParameters = {}) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color, opts));
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, y, z);
    p.receiveShadow = true;
    this.group.add(p);
    return p;
  }

  private buildGround() {
    // Rumput perpanjangan ke barat (plaza berakhir di x -48).
    this.plane(64, 96, GRASS, -80, 0, 0.004);
    // Hamparan pasir.
    this.plane(38, 68, SAND, -63, 0, 0.012);
    // Jalan setapak batu dari plaza ke pantai.
    this.plane(36, 4, STONE, -62, 0, 0.018);
    // Air laut di barat garis pantai (x <= -80) — visual saja.
    const water = this.plane(36, 130, 0x57b7d9, -98, 14, 0.05, { transparent: true, opacity: 0.88, roughness: 0.3 });
    this.water = water;
    // Buih ombak di tepi air.
    const foam = this.plane(1.4, 68, 0xffffff, -80.4, 0, 0.065, { transparent: true, opacity: 0.4, roughness: 0.4 });
    foam.receiveShadow = false;
    this.foam = foam;
  }

  private palm(x: number, z: number, lean = 0.12) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 4.4, 7), mat(TRUNK));
    trunk.position.set(lean * 2, 2.2, 0);
    trunk.rotation.z = -lean;
    trunk.castShadow = true;
    g.add(trunk);
    const leafGeo = new THREE.ConeGeometry(0.32, 3.4, 4);
    const leafMat = mat(LEAF);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      const a = (i / 5) * Math.PI * 2;
      leaf.position.set(lean * 4 + Math.cos(a) * 1.05, 4.65, Math.sin(a) * 1.05);
      leaf.rotation.set(Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15);
      g.add(leaf);
    }
    this.group.add(g);
  }

  private buildPalms() {
    this.palm(-52, -8);
    this.palm(-58, 10, 0.18);
    this.palm(-70, -20, 0.08);
    this.palm(-74, 18, 0.16);
    this.palm(-55, 26, 0.1);
    this.palm(-68, 4, 0.2);
  }

  private buildUmbrellas() {
    const spots: Array<[number, number, number]> = [
      [-56, -18, 0xd64545],
      [-64, 14, 0xe3b23c],
      [-72, -6, 0x2e8c83],
      [-60, 24, 0x7a4a9e],
    ];
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6);
    const poleMat = mat(WOOD);
    for (const [x, z, color] of spots) {
      const g = new THREE.Group();
      g.position.set(x, 0.02, z);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 1.2;
      g.add(pole);
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.7, 8), mat(color));
      top.position.y = 2.55;
      top.castShadow = true;
      g.add(top);
      const towel = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.8), mat(color));
      towel.position.set(0.9, 0.03, 0.6);
      towel.rotation.y = 0.5;
      g.add(towel);
      this.group.add(g);
    }
  }

  private buildHuts() {
    // Jejak gubuk HARUS sama dengan collider WORLD_BOXES: 3 x 2.5 m.
    for (const z of [-12, 14]) {
      const g = new THREE.Group();
      g.position.set(-50, 0, z);
      const body = new THREE.Mesh(new THREE.BoxGeometry(3, 2.3, 2.5), mat(WOOD));
      body.position.y = 1.15;
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.1, 4), mat(0xb5533c));
      roof.position.y = 2.85;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      g.add(roof);
      this.group.add(g);
    }
  }

  private buildPier() {
    // Dermaga kayu menjorok ke air dari garis pantai — VISUAL saja
    // (pemain tetap tertahan di garis pantai, tidak berjalan di atasnya).
    const g = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(11, 0.25, 3), mat(WOOD));
    deck.position.set(-85.5, 0.55, 0);
    deck.castShadow = true;
    g.add(deck);
    const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.1, 6);
    const postMat = mat(TRUNK);
    for (const [x, z] of [
      [-90.5, -1.3],
      [-90.5, 1.3],
      [-85.5, -1.3],
      [-85.5, 1.3],
      [-80.8, -1.3],
      [-80.8, 1.3],
    ] as const) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, 0, z);
      g.add(post);
    }
    this.group.add(g);
  }

  private buildEdges() {
    // Pagar tanaman penutup tepi barat kawasan (sejajar pagar plaza).
    const hedgeMat = mat(0x4da657);
    const seg: Array<[number, number, number, number]> = [
      [-80, -45, 64, 1.2],
      [-80, 45, 64, 1.2],
      [-112.5, 0, 1.2, 92],
    ];
    for (const [x, z, w, d] of seg) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), hedgeMat);
      h.position.set(x, 0.55, z);
      this.group.add(h);
    }
  }
}
