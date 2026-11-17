import * as THREE from "three";

export interface AvatarColors {
  skin: string;
  shirt: string;
  pants: string;
  /** pendek | panjang | hijab | peci | botak */
  hair?: string;
  hairColor?: string;
  /** polos | batik */
  shirtStyle?: string;
}

/** Tekstur batik prosedural: motif kawung geometris sederhana di atas warna dasar. */
function batikTexture(base: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.lineWidth = 3;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const cx = x * 32 + (y % 2 === 0 ? 16 : 0);
      const cy = y * 32 + 16;
      g.beginPath();
      g.arc(cx, cy, 10, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * Avatar stylized dari primitif (lihat docs/avatar-design.md).
 * Animasi prosedural: idle / walk / run / jump / wave.
 */
export class Avatar {
  readonly group = new THREE.Group();
  private rig = new THREE.Group();
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private headGroup!: THREE.Group;
  private phase = 0;
  private bubbleSprite: THREE.Sprite;
  private bubbleTex: THREE.CanvasTexture;
  private bubbleCanvas: HTMLCanvasElement;
  private bubbleUntil = 0;

  constructor(name: string, colors: AvatarColors) {
    const skin = new THREE.MeshStandardMaterial({ color: colors.skin, flatShading: true, roughness: 0.8 });
    const shirt =
      colors.shirtStyle === "batik"
        ? new THREE.MeshStandardMaterial({ map: batikTexture(colors.shirt), flatShading: true, roughness: 0.9 })
        : new THREE.MeshStandardMaterial({ color: colors.shirt, flatShading: true, roughness: 0.9 });
    const pants = new THREE.MeshStandardMaterial({ color: colors.pants, flatShading: true, roughness: 0.9 });
    const hairMat = new THREE.MeshStandardMaterial({ color: colors.hairColor ?? "#3a2a1c", flatShading: true, roughness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 });

    this.group.add(this.rig);

    // Kaki (pivot di pinggul agar bisa berayun).
    const makeLeg = (side: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(0.17 * side, 0.92, 0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.26), pants);
      leg.position.y = -0.39;
      leg.castShadow = true;
      pivot.add(leg);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.4), dark);
      shoe.position.set(0, -0.76, 0.05);
      pivot.add(shoe);
      this.rig.add(pivot);
      return pivot;
    };
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);

    // Badan kapsul.
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.42, 6, 12), shirt);
    body.position.y = 1.32;
    body.castShadow = true;
    this.rig.add(body);

    // Lengan (pivot di bahu).
    const makeArm = (side: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(0.5 * side, 1.62, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.68, 0.21), shirt);
      arm.position.y = -0.3;
      arm.castShadow = true;
      pivot.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), skin);
      hand.position.y = -0.66;
      pivot.add(hand);
      this.rig.add(pivot);
      return pivot;
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);

    // Kepala + wajah sederhana + gaya rambut/penutup kepala.
    const headGroup = new THREE.Group();
    headGroup.position.y = 2.02;
    this.headGroup = headGroup;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), skin);
    head.castShadow = true;
    headGroup.add(head);

    const hairStyle = colors.hair ?? "pendek";
    if (hairStyle === "pendek" || hairStyle === "panjang") {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.355, 18, 12), hairMat);
      cap.scale.set(1, 0.78, 1);
      cap.position.set(0, 0.1, -0.03);
      headGroup.add(cap);
      if (hairStyle === "panjang") {
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.85, 0.16), hairMat);
        back.position.set(0, -0.28, -0.26);
        back.rotation.x = 0.07;
        headGroup.add(back);
      }
    } else if (hairStyle === "hijab") {
      // Hijab: bola sedikit lebih besar digeser ke belakang agar wajah tetap terlihat,
      // plus draperi menutup bahu.
      const cover = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 14), hairMat);
      cover.scale.set(1, 1.05, 0.92);
      cover.position.set(0, 0.03, -0.09);
      headGroup.add(cover);
      const drape = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.55, 0.6, 14, 1, true), hairMat);
      drape.position.y = -0.52;
      headGroup.add(drape);
    } else if (hairStyle === "peci") {
      const peci = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.315, 0.24, 16), hairMat);
      peci.position.y = 0.3;
      headGroup.add(peci);
      const flat = new THREE.Mesh(new THREE.SphereGeometry(0.345, 18, 10), hairMat);
      flat.scale.set(1, 0.45, 1);
      flat.position.y = 0.14;
      headGroup.add(flat);
    }
    // "botak": tanpa tambahan apa pun.

    for (const sx of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 8), dark);
      eye.position.set(sx, 0.03, 0.31);
      headGroup.add(eye);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.016, 8, 16, Math.PI), dark);
    smile.position.set(0, -0.05, 0.315);
    smile.rotation.z = Math.PI;
    headGroup.add(smile);
    this.rig.add(headGroup);

    // Label nama melayang.
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 256;
    labelCanvas.height = 64;
    const lg = labelCanvas.getContext("2d")!;
    lg.fillStyle = "rgba(16,22,32,0.66)";
    roundedRect(lg, 28, 10, 200, 44, 14);
    lg.fill();
    lg.fillStyle = "#ffffff";
    lg.font = "bold 26px system-ui, sans-serif";
    lg.textAlign = "center";
    lg.textBaseline = "middle";
    lg.fillText(name.slice(0, 16), 128, 33);
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    labelTex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, depthTest: false, transparent: true }));
    label.scale.set(1.9, 0.48, 1);
    label.position.y = 2.62;
    label.renderOrder = 20;
    this.group.add(label);

    // Bubble chat (digambar ulang setiap ada pesan).
    this.bubbleCanvas = document.createElement("canvas");
    this.bubbleCanvas.width = 320;
    this.bubbleCanvas.height = 160;
    this.bubbleTex = new THREE.CanvasTexture(this.bubbleCanvas);
    this.bubbleTex.colorSpace = THREE.SRGBColorSpace;
    this.bubbleSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.bubbleTex, depthTest: false, transparent: true })
    );
    this.bubbleSprite.scale.set(2.3, 1.15, 1);
    this.bubbleSprite.position.y = 3.35;
    this.bubbleSprite.renderOrder = 21;
    this.bubbleSprite.visible = false;
    this.group.add(this.bubbleSprite);

    this.group.scale.setScalar(0.78);
  }

  showBubble(text: string) {
    const g = this.bubbleCanvas.getContext("2d")!;
    g.clearRect(0, 0, 320, 160);
    g.fillStyle = "rgba(255,255,255,0.96)";
    roundedRect(g, 8, 8, 304, 118, 22);
    g.fill();
    // Ekor bubble.
    g.beginPath();
    g.moveTo(140, 124);
    g.lineTo(180, 124);
    g.lineTo(160, 148);
    g.closePath();
    g.fill();
    g.fillStyle = "#1c2733";
    g.font = "25px system-ui, sans-serif";
    g.textAlign = "center";
    // Bungkus teks sederhana, maks 3 baris.
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      if ((line + " " + w).trim().length > 16 && line) {
        lines.push(line);
        line = w;
      } else {
        line = (line + " " + w).trim();
      }
      if (lines.length === 3) break;
    }
    if (line && lines.length < 3) lines.push(line);
    lines.slice(0, 3).forEach((l, i) => g.fillText(l, 160, 48 + i * 30));
    this.bubbleTex.needsUpdate = true;
    this.bubbleSprite.visible = true;
    this.bubbleUntil = performance.now() + 6000;
  }

  /** anim: idle | walk | run | jump | wave */
  update(dt: number, anim: string) {
    const t = performance.now() / 1000;
    if (this.bubbleSprite.visible && performance.now() > this.bubbleUntil) {
      this.bubbleSprite.visible = false;
    }

    const speed = anim === "run" ? 11 : anim === "walk" ? 7.5 : 0;
    if (speed > 0) this.phase += dt * speed;
    const swing = anim === "run" ? 0.85 : 0.6;
    const s = Math.sin(this.phase);

    // Reset dasar.
    this.armL.rotation.set(0, 0, 0.06);
    this.armR.rotation.set(0, 0, -0.06);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.headGroup.rotation.set(0, 0, 0);
    this.rig.position.y = 0;
    this.rig.rotation.x = 0;
    this.rig.rotation.y = 0;
    this.rig.rotation.z = 0;

    if (anim === "walk" || anim === "run") {
      this.armL.rotation.x = s * swing;
      this.armR.rotation.x = -s * swing;
      this.legL.rotation.x = -s * swing;
      this.legR.rotation.x = s * swing;
      this.rig.position.y = Math.abs(Math.cos(this.phase)) * 0.05;
      if (anim === "run") this.rig.rotation.x = 0.09;
    } else if (anim === "jump") {
      this.legL.rotation.x = -0.55;
      this.legR.rotation.x = 0.3;
      this.armL.rotation.x = -0.7;
      this.armR.rotation.x = -0.7;
    } else if (anim === "wave") {
      this.armR.rotation.z = -2.35; // lengan kanan terangkat
      this.armR.rotation.x = Math.sin(t * 9) * 0.45; // melambai
      this.armL.rotation.x = Math.sin(t * 1.6) * 0.05;
    } else if (anim === "sit") {
      this.rig.position.y = -0.52; // badan turun, duduk di tanah
      this.legL.rotation.x = -1.5;
      this.legR.rotation.x = -1.5;
      this.armL.rotation.x = -0.3;
      this.armR.rotation.x = -0.3;
      this.rig.position.y += Math.sin(t * 1.7) * 0.008; // tetap bernapas
    } else if (anim === "dance") {
      this.phase += dt * 9;
      const ds = Math.sin(this.phase);
      this.rig.position.y = Math.abs(Math.cos(this.phase)) * 0.13;
      this.rig.rotation.y = ds * 0.3;
      this.rig.rotation.z = Math.sin(this.phase * 0.5) * 0.06;
      this.armL.rotation.z = ds > 0 ? 2.5 : 0.5;
      this.armR.rotation.z = ds > 0 ? -0.5 : -2.5;
      this.legL.rotation.x = Math.max(0, ds) * 0.4;
      this.legR.rotation.x = Math.max(0, -ds) * 0.4;
    } else if (anim === "laugh") {
      this.rig.position.y = Math.abs(Math.sin(t * 12)) * 0.035;
      this.headGroup.rotation.x = -0.3; // kepala menengadah
      this.armL.rotation.x = -0.55;
      this.armR.rotation.x = -0.55;
      this.armL.rotation.z = 0.35;
      this.armR.rotation.z = -0.35;
    } else if (anim === "clap") {
      const cs = Math.sin(t * 11);
      this.armL.rotation.x = -1.15;
      this.armR.rotation.x = -1.15;
      this.armL.rotation.z = 0.42 + cs * 0.16;
      this.armR.rotation.z = -0.42 - cs * 0.16;
      this.rig.position.y = Math.abs(Math.sin(t * 5.5)) * 0.02;
    } else {
      // idle: napas halus
      this.rig.position.y = Math.sin(t * 1.7) * 0.015;
      this.armL.rotation.x = Math.sin(t * 1.7) * 0.05;
      this.armR.rotation.x = -Math.sin(t * 1.7) * 0.05;
    }
  }
}
