import * as THREE from 'three';
import { PITCH } from '../config';
import { visualRandom } from '../core/Random';

export type CameraMode = 'broadcast' | 'pro';

/**
 * 중계 카메라(옆에서) / 프로 카메라(선수 뒤에서).
 * 입력 매핑을 위해 화면 기준 앞/오른쪽 방향을 지면 위 벡터로 제공한다.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'broadcast';
  private readonly pos = new THREE.Vector3(0, 18, PITCH.halfW + 24);
  private readonly look = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private shake = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 500);
    this.camera.position.copy(this.pos);
  }

  toggle(): CameraMode {
    this.mode = this.mode === 'broadcast' ? 'pro' : 'broadcast';
    return this.mode;
  }

  /** 화면 위쪽이 가리키는 지면 방향 */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return this.mode === 'broadcast' ? out.set(0, 0, -1) : out.set(1, 0, 0);
  }

  right(out: THREE.Vector3): THREE.Vector3 {
    return this.mode === 'broadcast' ? out.set(1, 0, 0) : out.set(0, 0, 1);
  }

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  update(
    dt: number,
    ball: { x: number; y: number; z: number },
    focus: THREE.Vector3,
    celebrate: THREE.Vector3 | null,
  ): void {
    if (celebrate) {
      // 득점자 클로즈업
      this.desiredPos.set(celebrate.x + (this.mode === 'pro' ? -6 : 0), 3.2, celebrate.z + (this.mode === 'pro' ? 0 : 7));
      this.desiredLook.set(celebrate.x, 1.2, celebrate.z);
    } else if (this.mode === 'broadcast') {
      // 공과 조종 선수 사이를 따라가되, 경기장 끝에서는 멈춘다
      const fx = THREE.MathUtils.clamp(ball.x * 0.8 + focus.x * 0.2, -PITCH.halfL + 12, PITCH.halfL - 12);
      const fz = ball.z * 0.8 + focus.z * 0.2;
      this.desiredPos.set(fx, 17 + Math.max(0, fz) * 0.15, PITCH.halfW + 21);
      this.desiredLook.set(fx, 0, fz * 0.55 - 1);
    } else {
      const fx = focus.x * 0.6 + ball.x * 0.4;
      const fz = focus.z * 0.6 + ball.z * 0.4;
      this.desiredPos.set(fx - 13, 7.5, fz * 0.85);
      this.desiredLook.set(fx + 9, 0, fz * 0.92);
    }

    const k = 1 - Math.exp(-(celebrate ? 2.5 : 4.5) * dt);
    this.pos.lerp(this.desiredPos, k);
    this.look.lerp(this.desiredLook, 1 - Math.exp(-6 * dt));
    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      this.camera.position.x += (visualRandom.next() - 0.5) * this.shake;
      this.camera.position.y += (visualRandom.next() - 0.5) * this.shake;
      this.shake *= Math.exp(-6 * dt);
    }
    this.camera.lookAt(this.look);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    // 세로로 긴 화면에서는 더 넓게
    this.camera.fov = aspect < 1 ? 60 : 38;
    this.camera.updateProjectionMatrix();
  }
}
