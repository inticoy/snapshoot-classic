import * as THREE from 'three';
import { CAMERA, PITCH } from '../config';
import { visualRandom } from '../core/Random';

// TV 중계 (FIFA 기본 카메라 느낌): 관중석 높은 곳에서 망원(좁은 화각)으로 당겨 찍는다.
// 원근 왜곡이 적고 선수가 크게 보인다. 카메라는 터치라인 밖에 고정, 좌우로만 공을 따라간다.
// CAMERA(config.ts)는 '넓은 중계' 설정.
const TELE_CAMERA = {
  fov: 24, // 경기장 중앙을 볼 때 화각 (기준 거리에서)
  height: 20,
  backFromTouchline: 22,
  endMargin: 9,
  followX: 0.9,
  followZ: 0.85, // 공이 먼 쪽/가까운 쪽으로 가면 카메라도 앞뒤로 따라가 거리를 거의 일정하게 (줌은 남은 차이만 보정)
  minFov: 14,
  maxFov: 40,
};

export type CameraMode = 'tele' | 'broadcast' | 'pro';

export const CAMERA_LABEL: Record<CameraMode, string> = { tele: 'TV 중계', broadcast: '넓은 중계', pro: '선수 뒤' };
const ORDER: CameraMode[] = ['tele', 'broadcast', 'pro'];

/**
 * 중계 카메라(옆에서) / 프로 카메라(선수 뒤에서).
 * 입력 매핑을 위해 화면 기준 앞/오른쪽 방향을 지면 위 벡터로 제공한다.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'tele';
  private readonly pos = new THREE.Vector3(0, CAMERA.height, CAMERA.distance);
  private readonly look = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private shake = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.1, 500);
    this.camera.position.copy(this.pos);
  }

  toggle(): CameraMode {
    this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length];
    this.applyFov();
    return this.mode;
  }

  /** 화면 위쪽이 가리키는 지면 방향 */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return this.mode !== 'pro' ? out.set(0, 0, -1) : out.set(1, 0, 0);
  }

  right(out: THREE.Vector3): THREE.Vector3 {
    return this.mode !== 'pro' ? out.set(1, 0, 0) : out.set(0, 0, 1);
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
    } else if (this.mode === 'tele') {
      // 관중석 고정 위치에서 좌우로 따라가며 공을 바라본다 (망원)
      const fx = THREE.MathUtils.clamp(ball.x * TELE_CAMERA.followX + focus.x * 0.1, -PITCH.halfL + TELE_CAMERA.endMargin, PITCH.halfL - TELE_CAMERA.endMargin);
      const fz = ball.z * 0.85 + focus.z * 0.15;
      this.desiredPos.set(fx, TELE_CAMERA.height, PITCH.halfW + TELE_CAMERA.backFromTouchline + fz * TELE_CAMERA.followZ);
      this.desiredLook.set(ball.x * 0.9 + focus.x * 0.1, 0, fz);
    } else if (this.mode === 'broadcast') {
      // 공과 조종 선수 사이를 따라가되, 경기장 끝에서는 멈춘다
      const fx = THREE.MathUtils.clamp(ball.x * 0.8 + focus.x * 0.2, -PITCH.halfL + CAMERA.endMargin, PITCH.halfL - CAMERA.endMargin);
      const fz = ball.z * 0.8 + focus.z * 0.2;
      this.desiredPos.set(fx, CAMERA.height, fz + CAMERA.distance);
      this.desiredLook.set(fx, 0, fz);
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
    if (this.mode === 'tele') this.zoomToKeepFraming();
  }

  /**
   * TV 중계처럼 공과의 거리에 따라 줌을 조절해 화면에 보이는 범위를 일정하게 유지한다.
   * (공이 가까운 터치라인으로 와도 갑자기 확대되지 않게)
   */
  private zoomToKeepFraming(): void {
    const dist = this.camera.position.distanceTo(this.look);
    const ref = Math.hypot(TELE_CAMERA.height, PITCH.halfW + TELE_CAMERA.backFromTouchline); // 중앙을 볼 때 거리
    const span = 2 * ref * Math.tan(THREE.MathUtils.degToRad(TELE_CAMERA.fov / 2)); // 유지할 세로 범위
    let fov = THREE.MathUtils.radToDeg(2 * Math.atan(span / 2 / dist));
    if (this.camera.aspect < 1) fov *= 1.45;
    fov = THREE.MathUtils.clamp(fov, TELE_CAMERA.minFov, TELE_CAMERA.maxFov * (this.camera.aspect < 1 ? 1.45 : 1));
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.applyFov();
  }

  private applyFov(): void {
    // 세로로 긴 화면에서는 더 넓게
    const base = this.mode === 'tele' ? TELE_CAMERA.fov : CAMERA.fov;
    this.camera.fov = this.camera.aspect < 1 ? base * 1.45 : base;
    this.camera.updateProjectionMatrix();
  }
}
