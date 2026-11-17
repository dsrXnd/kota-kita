import * as THREE from "three";

export interface Interactable {
  id: string;
  label: string;
  description: string;
  position: THREE.Vector3;
  radius: number;
}

/**
 * Kotak tabrakan bangunan (AABB): [minX, maxX, minZ, maxZ].
 * HARUS sama dengan server (server/src/rooms/colliders.ts).
 */
export const COLLIDERS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-29, -19, -35, -27],
  [-17, -7, -35, -27],
  [7, 17, -35, -27],
  [19, 29, -35, -27],
  [-27, -17, 27, 35],
  [17, 27, 27, 35],
  [-35, -27, -17, -7],
  [-35, -27, 7, 17],
  [27, 35, -17, -7],
  [27, 35, 7, 17],
  [-7.5, 7.5, -37.5, -29],
];

const PLAYER_RADIUS = 0.35;

/** Cermin resolveCollisions di server, untuk prediksi lokal. */
export function resolveCollisions(pos: { x: number; z: number }): void {
  for (const [minX, maxX, minZ, maxZ] of COLLIDERS) {
    const nearX = Math.max(minX - PLAYER_RADIUS, Math.min(pos.x, maxX + PLAYER_RADIUS));
    const nearZ = Math.max(minZ - PLAYER_RADIUS, Math.min(pos.z, maxZ + PLAYER_RADIUS));
    const dx = pos.x - nearX;
    const dz = pos.z - nearZ;
    if (dx === 0 && dz === 0) {
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

// Palet resmi proyek (docs/art-style.md)
const COLORS = {
  grass: 0x5fb96a,
  stone: 0xe8dcc8,
  road: 0x6b6f76,
  cream: 0xf2e3c9,
  terracotta: 0xe39a76,
  sage: 0xa8c3a0,
  blue: 0x9db8d2,
  roof: 0xb5533c,
  roofDark: 0x7a4a2b,
  wood: 0x9a6b43,
  leaf: 0x3e9b4f,
  leafLight: 0x57b25e,
  trunk: 0x8a5a33,
  water: 0x57b7d9,
  lampGlow: 0xffc978,
  skyDay: new THREE.Color(0x8ec9e8),
  skyNight: new THREE.Color(0x1e2a4a),
};

function mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0, ...opts });
}

function signTexture(text: string, bg: string, fg = "#ffffff"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = fg;
  g.font = "bold 56px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Dunia Plaza Utama — semua dari primitif Three.js (tanpa file model).
 * Satu fungsi builder per jenis objek agar mudah diganti model .glb nanti.
 */
export class Plaza {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];

  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private water!: THREE.Mesh;
  private flag!: THREE.Group;
  private lampHeads: THREE.MeshStandardMaterial[] = [];
  private lampLights: THREE.PointLight[] = [];
  private nightTarget = 0; // 0 = siang, 1 = malam
  private nightBlend = 0;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    scene.background = COLORS.skyDay.clone();
    scene.fog = new THREE.Fog(COLORS.skyDay.getHex(), 55, 130);

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a8f5f, 0.95);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d9, 1.7);
    this.sun.position.set(28, 42, 18);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -52;
    this.sun.shadow.camera.right = 52;
    this.sun.shadow.camera.top = 52;
    this.sun.shadow.camera.bottom = -52;
    this.sun.shadow.camera.far = 120;
    this.sun.shadow.bias = -0.0004;
    scene.add(this.sun);

    this.buildGround();
    this.buildFountain();
    this.buildBuildings();
    this.buildVegetation();
    this.buildFurniture();
    scene.add(this.group);
  }

  setNight(night: boolean) {
    this.nightTarget = night ? 1 : 0;
  }

  get isNight() {
    return this.nightTarget === 1;
  }

  update(dt: number, t: number) {
    // Air mancur: putar & naik-turun halus.
    if (this.water) {
      this.water.rotation.y = t * 0.4;
    }
    // Bendera berkibar.
    if (this.flag) {
      this.flag.rotation.y = Math.sin(t * 2.2) * 0.18;
      this.flag.rotation.z = Math.sin(t * 3.1) * 0.05;
    }
    // Transisi siang <-> malam yang halus.
    if (Math.abs(this.nightBlend - this.nightTarget) > 0.001) {
      const dir = Math.sign(this.nightTarget - this.nightBlend);
      this.nightBlend = THREE.MathUtils.clamp(this.nightBlend + dir * dt * 0.7, 0, 1);
      const b = this.nightBlend;
      const sky = COLORS.skyDay.clone().lerp(COLORS.skyNight, b);
      (this.scene.background as THREE.Color).copy(sky);
      this.scene.fog?.color.copy(sky);
      this.hemi.intensity = THREE.MathUtils.lerp(0.95, 0.3, b);
      this.sun.intensity = THREE.MathUtils.lerp(1.7, 0.3, b);
      this.sun.color.setHex(0xfff2d9).lerp(new THREE.Color(0x9db8ff), b);
      for (const m of this.lampHeads) m.emissiveIntensity = THREE.MathUtils.lerp(0.15, 2.4, b);
      for (const l of this.lampLights) l.intensity = THREE.MathUtils.lerp(0, 14, b);
    }
  }

  // ---------- pembangunan dunia ----------

  private buildGround() {
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(96, 96), mat(COLORS.grass));
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.group.add(grass);

    // Lantai plaza melingkar.
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(17, 40), mat(COLORS.stone));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.02;
    plaza.receiveShadow = true;
    this.group.add(plaza);

    // Jalan aspal di sisi selatan & utara.
    for (const z of [-24, 24]) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(96, 7), mat(COLORS.road));
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, 0.015, z);
      road.receiveShadow = true;
      this.group.add(road);
    }
    // Trotoar batu penghubung plaza ke jalan.
    for (const [x, z, w, d] of [
      [0, 20.5, 5, 7],
      [0, -20.5, 5, 7],
      [20.5, 0, 7, 5],
      [-20.5, 0, 7, 5],
    ] as const) {
      const path = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(COLORS.stone));
      path.rotation.x = -Math.PI / 2;
      path.position.set(x, 0.018, z);
      path.receiveShadow = true;
      this.group.add(path);
    }
  }

  private buildFountain() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.55, 24), mat(0xd8cfc0));
    base.position.y = 0.27;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(2.85, 2.85, 0.12, 24),
      new THREE.MeshStandardMaterial({ color: COLORS.water, transparent: true, opacity: 0.85, roughness: 0.25 })
    );
    water.position.y = 0.52;
    g.add(water);
    this.water = water;

    const fall = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.15, 1.15, 16, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xbfe6f5, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    fall.position.y = 1.15;
    g.add(fall);

    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.7, 12), mat(0xd8cfc0));
    pillar.position.y = 1.1;
    pillar.castShadow = true;
    g.add(pillar);

    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.7, 0.3, 16), mat(0xd8cfc0));
    bowl.position.y = 1.95;
    g.add(bowl);

    this.group.add(g);
    this.interactables.push({
      id: "fountain",
      label: "Air Mancur Plaza",
      description:
        "Air mancur di jantung Plaza Utama — titik kumpul favorit warga KOTA KITA. Konon siapa yang melempar koin sambil berharap, keinginannya didengar kota.",
      position: new THREE.Vector3(0, 0, 0),
      radius: 5,
    });
  }

  private shop(x: number, z: number, rotY: number, wall: number, sign: string, signColor: string, h = 6) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;

    const body = new THREE.Mesh(new THREE.BoxGeometry(10, h, 8), mat(wall));
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Atap limasan (piramida segi empat) khas Indonesia.
    const roof = new THREE.Mesh(new THREE.ConeGeometry(7.6, 2.6, 4), mat(COLORS.roof));
    roof.position.y = h + 1.3;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);

    // Awning warna-warni di depan toko.
    const awning = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.18, 2.2), mat(new THREE.Color(signColor).getHex()));
    awning.position.set(0, 3.1, 5);
    awning.rotation.x = 0.28;
    g.add(awning);

    // Pintu & jendela sederhana.
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.1), mat(COLORS.wood));
    door.position.set(-2.4, 1.3, 4.03);
    g.add(door);
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.8, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xbfe3f2, roughness: 0.15, metalness: 0.1 })
    );
    win.position.set(2.2, 1.9, 4.03);
    g.add(win);

    // Papan nama toko (tekstur canvas).
    const signMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 1.6),
      new THREE.MeshBasicMaterial({ map: signTexture(sign, signColor) })
    );
    signMesh.position.set(0, h - 0.7, 4.06);
    g.add(signMesh);

    this.group.add(g);
  }

  private buildBuildings() {
    // Deretan ruko utara (menghadap plaza).
    this.shop(-24, -31, 0, COLORS.cream, "TOKO BUKU", "#2e8c83", 6.5);
    this.shop(-12, -31, 0, COLORS.terracotta, "WARUNG KOPI", "#b5533c", 5.5);
    this.shop(12, -31, 0, COLORS.sage, "BAKSO & MIE", "#d64545", 6);
    this.shop(24, -31, 0, COLORS.blue, "TOKO BUNGA", "#e3b23c", 5.5);
    // Ruko selatan (di belakang spawn, menghadap utara).
    this.shop(-22, 31, Math.PI, COLORS.sage, "KEDAI ROTI", "#e39a76", 5.5);
    this.shop(22, 31, Math.PI, COLORS.cream, "TOKO BATIK", "#7a4a2b", 6);
    // Ruko barat & timur.
    this.shop(-31, -12, Math.PI / 2, COLORS.blue, "SOTO & SATE", "#2e8c83", 5.5);
    this.shop(-31, 12, Math.PI / 2, COLORS.terracotta, "ES TEH SEGAR", "#57b7d9", 5);
    this.shop(31, -12, -Math.PI / 2, COLORS.cream, "TOKO MAINAN", "#d64545", 6);
    this.shop(31, 12, -Math.PI / 2, COLORS.sage, "FOTOKOPI", "#3b4a6b", 5.5);

    // Landmark: Balai Kota Mini dengan atap limasan besar (utara).
    const balai = new THREE.Group();
    balai.position.set(0, 0, -33);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(15, 6, 9), mat(COLORS.cream));
    hall.position.y = 3;
    hall.castShadow = true;
    hall.receiveShadow = true;
    balai.add(hall);
    const bigRoof = new THREE.Mesh(new THREE.ConeGeometry(11.5, 4.4, 4), mat(COLORS.roofDark));
    bigRoof.position.y = 8.2;
    bigRoof.rotation.y = Math.PI / 4;
    bigRoof.castShadow = true;
    balai.add(bigRoof);
    const steps = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 3), mat(0xd8cfc0));
    steps.position.set(0, 0.25, 6);
    balai.add(steps);
    const balaiSign = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 2.1),
      new THREE.MeshBasicMaterial({ map: signTexture("BALAI KOTA", "#7a4a2b") })
    );
    balaiSign.position.set(0, 4.6, 4.56);
    balai.add(balaiSign);
    this.group.add(balai);

    // Tiang bendera merah-putih di depan balai kota (orisinal, tanpa logo).
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 9, 8), mat(0xd9d9d9));
    pole.position.set(6.5, 4.5, -26);
    this.group.add(pole);
    const flag = new THREE.Group();
    flag.position.set(6.5, 8.6, -26);
    const red = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshBasicMaterial({ color: 0xd64545, side: THREE.DoubleSide }));
    red.position.set(1.2, 0.37, 0);
    const white = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    white.position.set(1.2, -0.37, 0);
    flag.add(red, white);
    this.group.add(flag);
    this.flag = flag;

    this.interactables.push({
      id: "balai",
      label: "Balai Kota Mini",
      description:
        "Balai Kota Mini — pusat kegiatan komunitas KOTA KITA. Untuk sekarang pintunya masih terkunci: kawasan & fitur balai dibuka di tahap pengembangan berikutnya.",
      position: new THREE.Vector3(0, 0, -27),
      radius: 6,
    });
  }

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
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat(Math.random() > 0.5 ? COLORS.leaf : COLORS.leafLight));
      leaf.position.set(bx, by, bz);
      leaf.castShadow = true;
      g.add(leaf);
    }
    this.group.add(g);
  }

  private palm(x: number, z: number) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    let px = 0;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 7), mat(COLORS.trunk));
      px += i * 0.09;
      seg.position.set(px, 0.45 + i * 0.85, 0);
      seg.rotation.z = -0.1;
      g.add(seg);
    }
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.32, 3.4, 4), mat(COLORS.leaf));
      const a = (i / 6) * Math.PI * 2;
      leaf.position.set(px + Math.cos(a) * 1.1, 4.9, Math.sin(a) * 1.1);
      leaf.rotation.set(Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15);
      g.add(leaf);
    }
    this.group.add(g);
  }

  private buildVegetation() {
    const trees: Array<[number, number, number]> = [
      [-19, -18, 1.1], [19, -18, 1], [-19, 17, 1.2], [19, 17, 0.9],
      [-13, -13, 0.9], [13, -13, 1.05], [-13, 12, 1], [13, 12, 1.15],
      [-38, -20, 1.3], [38, -20, 1.2], [-38, 22, 1.1], [38, 22, 1.3],
      [-38, 0, 1], [38, 0, 1.05], [0, -42, 1.25], [-16, -42, 1.1], [16, -42, 1.15],
    ];
    for (const [x, z, s] of trees) this.tree(x, z, s);
    this.palm(-8, 20);
    this.palm(9, 21);
    this.palm(-21, -6);
    this.palm(21, 6);

    // Pagar tanaman di tepi dunia.
    const hedgeMat = mat(0x4da657);
    const seg: Array<[number, number, number, number]> = [
      [0, -45, 92, 1.2], [0, 45, 92, 1.2], [-45, 0, 1.2, 92], [45, 0, 1.2, 92],
    ];
    for (const [x, z, w, d] of seg) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), hedgeMat);
      h.position.set(x, 0.55, z);
      this.group.add(h);
    }
  }

  private bench(x: number, z: number, rotY: number) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.6), mat(COLORS.wood));
    seat.position.y = 0.55;
    seat.castShadow = true;
    g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.12), mat(COLORS.wood));
    back.position.set(0, 0.95, -0.26);
    g.add(back);
    for (const sx of [-0.9, 0.9]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.55), mat(0x555a60));
      leg.position.set(sx, 0.27, 0);
      g.add(leg);
    }
    this.group.add(g);
  }

  private lamp(x: number, z: number, withLight: boolean) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 8), mat(0x3c4147));
    pole.position.y = 1.7;
    g.add(pole);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xfff3cf,
      emissive: COLORS.lampGlow,
      emissiveIntensity: 0.15,
    });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), headMat);
    head.position.y = 3.5;
    g.add(head);
    this.lampHeads.push(headMat);
    if (withLight) {
      const light = new THREE.PointLight(COLORS.lampGlow, 0, 13, 1.8);
      light.position.y = 3.5;
      g.add(light);
      this.lampLights.push(light);
    }
    this.group.add(g);
  }

  private buildFurniture() {
    // Bangku menghadap air mancur di 4 sisi diagonal.
    this.bench(7.5, 7.5, -Math.PI / 4 - Math.PI / 2);
    this.bench(-7.5, 7.5, Math.PI / 4 + Math.PI / 2);
    this.bench(7.5, -7.5, Math.PI / 4 - Math.PI / 2);
    this.bench(-7.5, -7.5, -Math.PI / 4 + Math.PI / 2);
    this.interactables.push({
      id: "bench",
      label: "Bangku Taman",
      description:
        "Bangku taman kayu jati — tempat terbaik buat duduk sore-sore, lihat air mancur, dan nunggu teman datang. (Fitur duduk menyusul di tahap emote.)",
      position: new THREE.Vector3(7.5, 0, 7.5),
      radius: 3,
    });

    // Lampu taman mengelilingi plaza (2 dengan cahaya sungguhan demi performa).
    const lampPos: Array<[number, number]> = [
      [10, 10], [-10, 10], [10, -10], [-10, -10], [16, 0], [-16, 0], [0, 16], [0, -16],
    ];
    lampPos.forEach(([x, z], i) => this.lamp(x, z, i < 2));

    // Papan info di titik spawn (selatan plaza).
    const board = new THREE.Group();
    board.position.set(3.2, 0, 14.5);
    board.rotation.y = Math.PI + 0.0; // menghadap pemain yang baru masuk (dari selatan)
    for (const sx of [-1.1, 1.1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), mat(COLORS.wood));
      post.position.set(sx, 1.2, 0);
      board.add(post);
    }
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 1.5, 0.1),
      mat(COLORS.cream)
    );
    panel.position.y = 1.9;
    board.add(panel);
    const infoTex = (() => {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 272;
      const g = c.getContext("2d")!;
      g.fillStyle = "#f2e3c9";
      g.fillRect(0, 0, 512, 272);
      g.fillStyle = "#7a4a2b";
      g.font = "bold 44px system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText("PLAZA UTAMA", 256, 70);
      g.font = "30px system-ui, sans-serif";
      g.fillText("Selamat datang di KOTA KITA!", 256, 130);
      g.font = "26px system-ui, sans-serif";
      g.fillText("Jelajahi plaza, sapa pemain lain,", 256, 185);
      g.fillText("dan foto di depan air mancur 📸", 256, 225);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    const infoFace = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.44), new THREE.MeshBasicMaterial({ map: infoTex }));
    infoFace.position.set(0, 1.9, -0.06);
    infoFace.rotation.y = Math.PI;
    board.add(infoFace);
    this.group.add(board);

    this.interactables.push({
      id: "info",
      label: "Papan Info Plaza",
      description:
        "Selamat datang di KOTA KITA! Plaza Utama adalah titik kumpul pertama. Kawasan lain — Pasar, Kampus, Pantai, Stasiun — sedang dibangun dan akan dibuka bertahap.",
      position: new THREE.Vector3(3.2, 0, 14.5),
      radius: 3.2,
    });

    // Warung Kopi bisa diajak interaksi dari depan tokonya.
    this.interactables.push({
      id: "warkop",
      label: "Warung Kopi",
      description:
        "☕ MENU WARUNG KOPI — Kopi Tubruk (Rp8.000), Es Teh Manis (Rp5.000), Indomie Telur (Rp12.000), Gorengan Campur (Rp10.000). Buka 06.00–24.00. Kata pemiliknya: \"Ngopi dulu, urusan kota belakangan.\"",
      position: new THREE.Vector3(-12, 0, -25.2),
      radius: 3.6,
    });

    // Papan pengumuman event di seberang papan info (sisi barat spawn).
    const ann = new THREE.Group();
    ann.position.set(-3.6, 0, 14.5);
    ann.rotation.y = Math.PI;
    for (const sx of [-1.1, 1.1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), mat(COLORS.wood));
      post.position.set(sx, 1.2, 0);
      ann.add(post);
    }
    const annPanel = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.5, 0.1), mat(0x3b4a6b));
    annPanel.position.y = 1.9;
    ann.add(annPanel);
    const annTex = (() => {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 272;
      const g = c.getContext("2d")!;
      g.fillStyle = "#3b4a6b";
      g.fillRect(0, 0, 512, 272);
      g.fillStyle = "#ffd97a";
      g.font = "bold 42px system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText("📣 PENGUMUMAN", 256, 66);
      g.fillStyle = "#ffffff";
      g.font = "27px system-ui, sans-serif";
      g.fillText("Kumpul Komunitas: Sabtu 19.00", 256, 122);
      g.fillText("di Air Mancur Plaza", 256, 158);
      g.fillText("Lomba Foto: setiap Minggu", 256, 202);
      g.fillText("Kelas Menari: Minggu 08.00", 256, 238);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    const annFace = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.44), new THREE.MeshBasicMaterial({ map: annTex }));
    annFace.position.set(0, 1.9, -0.06);
    annFace.rotation.y = Math.PI;
    ann.add(annFace);
    this.group.add(ann);

    this.interactables.push({
      id: "pengumuman",
      label: "Papan Pengumuman",
      description:
        "📣 AGENDA KOMUNITAS — Sabtu 19.00: Kumpul Komunitas di Air Mancur Plaza. Minggu: Lomba Foto Mingguan (foto terbaik dipajang di balai kota) & Kelas Menari jam 08.00. Semua warga boleh ikut, gratis!",
      position: new THREE.Vector3(-3.6, 0, 14.5),
      radius: 3.2,
    });
  }
}
