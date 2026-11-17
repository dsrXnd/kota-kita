import * as THREE from "three";

/**
 * Kamera third-person: mengikuti avatar dari belakang,
 * diputar dengan menggeser layar (sentuh/drag mouse), zoom dengan roda/pinch.
 */
export class ThirdPersonCamera {
  yaw = Math.PI; // mulai dari selatan, melihat ke plaza
  pitch = 0.34;
  distance = 8;

  private current = new THREE.Vector3(0, 4, 24);
  private lookTarget = new THREE.Vector3();

  rotate(dxPx: number, dyPx: number) {
    this.yaw -= dxPx * 0.0052;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dyPx * 0.0042, 0.06, 1.15);
  }

  zoom(delta: number) {
    this.distance = THREE.MathUtils.clamp(this.distance + delta, 4, 13);
  }

  /** Mode pembuka: kamera mengorbit plaza pelan sebelum pemain masuk. */
  updateOrbit(camera: THREE.PerspectiveCamera, t: number) {
    const r = 24;
    camera.position.set(Math.sin(t * 0.07) * r, 9.5, Math.cos(t * 0.07) * r);
    camera.lookAt(0, 1.5, 0);
  }

  update(camera: THREE.PerspectiveCamera, target: THREE.Vector3, dt: number) {
    const cp = Math.cos(this.pitch);
    const desired = new THREE.Vector3(
      target.x + Math.sin(this.yaw) * cp * this.distance,
      target.y + Math.sin(this.pitch) * this.distance + 0.6,
      target.z + Math.cos(this.yaw) * cp * this.distance
    );
    desired.y = Math.max(desired.y, 0.7);
    // Ikuti dengan halus (tidak kaku menempel).
    const k = 1 - Math.pow(0.0001, dt);
    this.current.lerp(desired, k);
    camera.position.copy(this.current);
    this.lookTarget.set(target.x, target.y + 1.6, target.z);
    camera.lookAt(this.lookTarget);
  }

  snapBehind(target: THREE.Vector3) {
    const cp = Math.cos(this.pitch);
    this.current.set(
      target.x + Math.sin(this.yaw) * cp * this.distance,
      target.y + Math.sin(this.pitch) * this.distance + 0.6,
      target.z + Math.cos(this.yaw) * cp * this.distance
    );
  }
}
