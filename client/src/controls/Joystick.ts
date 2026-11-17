/**
 * Joystick virtual (kiri bawah) — murni pointer events,
 * mendukung multi-sentuh (pointerId dilacak terpisah dari kamera).
 */
export class Joystick {
  /** vektor arah: x = kanan(+)/kiri(-), y = bawah(+)/atas(-), panjang 0..1 */
  readonly vector = { x: 0, y: 0 };
  private pointerId: number | null = null;
  private base: HTMLElement;
  private knob: HTMLElement;
  private radius = 44;

  constructor(baseEl: HTMLElement, knobEl: HTMLElement) {
    this.base = baseEl;
    this.knob = knobEl;

    baseEl.addEventListener("pointerdown", (e) => {
      this.pointerId = e.pointerId;
      baseEl.setPointerCapture(e.pointerId);
      this.move(e);
    });
    baseEl.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.pointerId) this.move(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.vector.x = 0;
      this.vector.y = 0;
      this.knob.style.transform = "translate(-50%, -50%)";
    };
    baseEl.addEventListener("pointerup", end);
    baseEl.addEventListener("pointercancel", end);
  }

  private move(e: PointerEvent) {
    const rect = this.base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) {
      dx = (dx / len) * this.radius;
      dy = (dy / len) * this.radius;
    }
    this.vector.x = dx / this.radius;
    this.vector.y = dy / this.radius;
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}
