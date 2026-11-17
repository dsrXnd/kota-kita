import { Joystick } from "./Joystick";

/**
 * Menggabungkan semua sumber input: joystick sentuh + keyboard (untuk PC).
 * Hasil akhir berupa "niat gerak" di ruang layar:
 *  - moveX: kanan +1 / kiri -1
 *  - moveY: maju -1 (atas) / mundur +1 (bawah)  [mengikuti konvensi joystick]
 */
export class InputManager {
  private joystick: Joystick;
  private keys = new Set<string>();
  private jumpQueued = false;
  /** Toggle lari dari tombol HUD (selain Shift di keyboard). */
  runToggle = false;

  constructor(joystick: Joystick) {
    this.joystick = joystick;
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Space") {
        this.jumpQueued = true;
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  queueJump() {
    this.jumpQueued = true;
  }

  /** Ambil & kosongkan antrean lompat (sekali pakai). */
  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  get moveX(): number {
    let x = this.joystick.vector.x;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    return Math.max(-1, Math.min(1, x));
  }

  get moveY(): number {
    let y = this.joystick.vector.y;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y += 1;
    return Math.max(-1, Math.min(1, y));
  }

  get sprint(): boolean {
    return this.runToggle || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
  }

  get isMoving(): boolean {
    return Math.abs(this.moveX) > 0.12 || Math.abs(this.moveY) > 0.12;
  }
}
