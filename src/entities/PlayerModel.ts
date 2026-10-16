import * as THREE from 'three';
import type { HairStyle } from '../data/Appearance';
import type { DecalSpec } from './KitDecal';
import { visualRandom } from '../core/Random';

/**
 * 프리미티브로 만든 절차적 휴머노이드.
 * 상태별 포즈(관절 각도 세트)를 가중치로 섞어서 자연스럽게 전환한다.
 * 나중에 Mixamo 캐릭터 + AnimationMixer로 교체할 때도 같은 상태 머신을 그대로 쓸 수 있다.
 */

export type AnimState = 'idle' | 'run' | 'kick' | 'tackle' | 'dive' | 'celebrate' | 'hold' | 'header' | 'advance' | 'smother';

type Joint =
  | 'hipL' | 'hipR' | 'kneeL' | 'kneeR'
  | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR'
  | 'armSpreadL' | 'armSpreadR'
  | 'spine' | 'bodyRoll' | 'bodyPitch' | 'bodyDrop';

type Pose = Partial<Record<Joint, number>>;

const JOINTS: Joint[] = [
  'hipL', 'hipR', 'kneeL', 'kneeR', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR',
  'armSpreadL', 'armSpreadR', 'spine', 'bodyRoll', 'bodyPitch', 'bodyDrop',
];

// 상태 전환 속도 (클수록 빠르게 크로스페이드)
const FADE_SPEED: Record<AnimState, number> = {
  idle: 8, run: 10, kick: 22, tackle: 18, dive: 16, celebrate: 6, hold: 10, header: 20, advance: 12, smother: 20,
};

/** 선수 모델 공통 인터페이스 (절차적 모델 / 스킨드 캐릭터) */
export interface CharacterModel {
  readonly root: THREE.Group;
  readonly current: AnimState;
  play(state: AnimState, opts?: { side?: 1 | -1 }): void;
  setLocomotion(speed: number, sprint: boolean): void;
  update(dt: number): void;
  /** 심판 동작: 오른팔 들기(카드·깃발) / 앞으로 가리키기(프리킥 방향). 스킨드 캐릭터만 지원 */
  setGesture?(gesture: Gesture): void;
  /** 구운 동작(모션캡처·GRF) 재생. 지원하지 않거나 데이터가 없으면 false */
  playMotion?(id: string, opts?: { startAt?: number; speed?: number; loop?: boolean; then?: { id: string; speed: number } }): boolean;
  /** 반복 중인 동작을 끝내고 이동 클립으로 돌아간다 */
  stopMotion?(): void;
  /** 손 월드 위치 (카드·깃발을 쥐여 줄 때, 기본 오른손) */
  handPosition?(out: THREE.Vector3, side?: 'L' | 'R'): THREE.Vector3 | null;
}

export type Gesture = 'none' | 'raise' | 'point';

export interface ModelColors {
  shirt: number;
  shorts: number;
  socks: number;
  skin?: number;
  hair?: number;
  /** 유니폼 디자인: 0 무지, 1 어깨 라인, 2 세로 줄무늬 */
  style?: number;
  trim?: number;
  /** 키퍼: 긴소매 + 장갑 */
  keeper?: boolean;
  gloves?: number;
  hairStyle?: HairStyle;
  /** 등번호·이름·얼굴 데칼 */
  decal?: DecalSpec;
}

const SKIN_TONES = [0xf1c7a5, 0xd9a47e, 0xb07a52, 0x7d5236, 0xe8b894];
const HAIR_TONES = [0x1d1510, 0x3a2516, 0x6b4a2a, 0xc9a25a, 0x111111];

export class PlayerModel implements CharacterModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group(); // 기울기/하강용
  private readonly torso = new THREE.Group();
  private readonly joints = {} as Record<
    'hipL' | 'hipR' | 'kneeL' | 'kneeR' | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR',
    THREE.Group
  >;
  private readonly weights: Record<AnimState, number> = {
    idle: 1, run: 0, kick: 0, tackle: 0, dive: 0, celebrate: 0, hold: 0, header: 0, advance: 0, smother: 0,
  };
  private state: AnimState = 'idle';
  private runPhase = visualRandom.next() * Math.PI * 2;
  private time = visualRandom.next() * 10;
  private actionT = 0; // 일회성 동작(킥 등) 진행 시간
  private speed = 0;
  private sprint = false;
  private kickSide: 1 | -1 = 1;
  private diveSide: 1 | -1 = 1;
  private readonly shirtMaterial: THREE.MeshStandardMaterial;

  constructor(colors: ModelColors, number: number) {
    const skin = new THREE.MeshStandardMaterial({
      color: colors.skin ?? SKIN_TONES[Math.floor(visualRandom.next() * SKIN_TONES.length)],
      roughness: 0.7,
    });
    this.shirtMaterial = new THREE.MeshStandardMaterial({ color: colors.shirt, roughness: 0.6 });
    const shorts = new THREE.MeshStandardMaterial({ color: colors.shorts, roughness: 0.7 });
    const socks = new THREE.MeshStandardMaterial({ color: colors.socks, roughness: 0.8 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4 });
    const hair = new THREE.MeshStandardMaterial({
      color: colors.hair ?? HAIR_TONES[Math.floor(visualRandom.next() * HAIR_TONES.length)],
      roughness: 0.9,
    });

    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, y = 0, x = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };

    this.root.add(this.body);
    // 엉덩이 높이 0.95m 기준
    this.body.position.y = 0.95;

    // 하체
    const pelvis = mesh(new THREE.BoxGeometry(0.34, 0.2, 0.22), shorts, 0);
    this.body.add(pelvis);

    const makeLeg = (side: 1 | -1) => {
      const hip = new THREE.Group();
      hip.position.set(0.1 * side, -0.05, 0);
      const thigh = mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 8), shorts, -0.2);
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.43;
      const shin = mesh(new THREE.CapsuleGeometry(0.06, 0.32, 4, 8), socks, -0.2);
      const foot = mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), boots, -0.43, 0, 0.05);
      knee.add(shin, foot);
      hip.add(knee);
      this.body.add(hip);
      return { hip, knee };
    };
    const l = makeLeg(-1);
    const r = makeLeg(1);
    this.joints.hipL = l.hip;
    this.joints.kneeL = l.knee;
    this.joints.hipR = r.hip;
    this.joints.kneeR = r.knee;

    // 상체
    this.torso.position.y = 0.08;
    this.body.add(this.torso);
    const chest = mesh(new THREE.BoxGeometry(0.42, 0.5, 0.24), this.shirtMaterial, 0.27);
    this.torso.add(chest);
    const head = mesh(new THREE.SphereGeometry(0.115, 16, 12), skin, 0.66);
    const neck = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), skin, 0.55);
    const hairCap = mesh(
      new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      hair,
      0.68,
      0,
      -0.01,
    );
    this.torso.add(head, neck, hairCap);

    // 등번호
    const numberTex = makeNumberTexture(number);
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.26),
      new THREE.MeshBasicMaterial({ map: numberTex, transparent: true }),
    );
    back.position.set(0, 0.3, -0.121);
    back.rotation.y = Math.PI;
    this.torso.add(back);

    const makeArm = (side: 1 | -1) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.26 * side, 0.48, 0);
      const upper = mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), this.shirtMaterial, -0.14);
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      const fore = mesh(new THREE.CapsuleGeometry(0.045, 0.2, 4, 8), skin, -0.13);
      elbow.add(fore);
      shoulder.add(elbow);
      this.torso.add(shoulder);
      return { shoulder, elbow };
    };
    const al = makeArm(-1);
    const ar = makeArm(1);
    this.joints.shoulderL = al.shoulder;
    this.joints.elbowL = al.elbow;
    this.joints.shoulderR = ar.shoulder;
    this.joints.elbowR = ar.elbow;
  }

  setShirtColor(color: number): void {
    this.shirtMaterial.color.setHex(color);
  }

  /** 상태 전환. 일회성 동작은 처음부터 다시 재생된다 */
  play(state: AnimState, opts: { side?: 1 | -1 } = {}): void {
    if (state === 'kick' || state === 'tackle' || state === 'dive' || state === 'smother' || state === 'header') {
      this.actionT = 0;
      if (state === 'kick') this.kickSide = opts.side ?? 1;
      if (state === 'dive' || state === 'smother') this.diveSide = opts.side ?? 1;
    }
    this.state = state;
  }

  get current(): AnimState {
    return this.state;
  }

  setLocomotion(speed: number, sprint: boolean): void {
    this.speed = speed;
    this.sprint = sprint;
  }

  update(dt: number): void {
    this.time += dt;
    this.actionT += dt;

    // 크로스페이드: 현재 상태 가중치는 1로, 나머지는 0으로 수렴
    const fade = 1 - Math.exp(-FADE_SPEED[this.state] * dt);
    let total = 0;
    for (const s of Object.keys(this.weights) as AnimState[]) {
      const target = s === this.state ? 1 : 0;
      this.weights[s] += (target - this.weights[s]) * fade;
      total += this.weights[s];
    }

    // 달리기 위상은 실제 이동 속도에 맞춘다 (발 미끄러짐 방지)
    const stride = this.sprint ? 1.9 : 1.6;
    this.runPhase += (this.speed / stride) * Math.PI * 2 * dt;

    const blended: Record<Joint, number> = Object.fromEntries(JOINTS.map((j) => [j, 0])) as Record<Joint, number>;
    for (const s of Object.keys(this.weights) as AnimState[]) {
      const w = this.weights[s] / total;
      if (w < 0.001) continue;
      const pose = this.pose(s);
      for (const j of JOINTS) blended[j] += (pose[j] ?? 0) * w;
    }
    this.apply(blended);
  }

  private pose(state: AnimState): Pose {
    const t = this.time;
    switch (state) {
      case 'idle': {
        const b = Math.sin(t * 2.2) * 0.03;
        return {
          hipL: 0.05, hipR: -0.05, kneeL: 0.15, kneeR: 0.15,
          shoulderL: 0.05 + b, shoulderR: 0.05 - b, elbowL: -0.35, elbowR: -0.35,
          armSpreadL: 0.12, armSpreadR: 0.12, spine: 0.08 + b * 0.5, bodyDrop: 0.03,
        };
      }
      case 'run': {
        const p = this.runPhase;
        const amp = Math.min(1, this.speed / 5) * (this.sprint ? 1.15 : 0.9);
        const s = Math.sin(p);
        return {
          hipL: s * 0.85 * amp,
          hipR: -s * 0.85 * amp,
          // 무릎은 다리가 뒤로 갈 때 굽힌다
          kneeL: (0.25 + Math.max(0, -Math.sin(p - 0.6)) * 1.3) * amp,
          kneeR: (0.25 + Math.max(0, Math.sin(p - 0.6)) * 1.3) * amp,
          shoulderL: -s * 0.75 * amp,
          shoulderR: s * 0.75 * amp,
          elbowL: -1.2, elbowR: -1.2,
          armSpreadL: 0.1, armSpreadR: 0.1,
          spine: 0.12 + 0.12 * amp,
          bodyDrop: Math.abs(Math.cos(p)) * 0.05 * amp,
        };
      }
      case 'advance': {
        const s = Math.sin(this.runPhase) * Math.min(1, this.speed / 5);
        return {
          hipL: s * 0.65, hipR: -s * 0.65, kneeL: 0.4, kneeR: 0.4,
          shoulderL: -0.4, shoulderR: -0.4, elbowL: -0.8, elbowR: -0.8,
          armSpreadL: 0.65, armSpreadR: 0.65, spine: 0.3, bodyDrop: 0.12,
        };
      }
      case 'smother': {
        // 발밑으로 던질 때는 낮게 옆으로 눕고 양팔을 공 쪽으로 뻗는다.
        const k = Math.min(1, this.actionT / 0.18);
        return {
          hipL: 0.3, hipR: 0.15, kneeL: 0.5, kneeR: 0.3,
          shoulderL: -1.3 * k, shoulderR: -1.3 * k, elbowL: -0.2, elbowR: -0.2,
          armSpreadL: 0.3, armSpreadR: 0.3,
          bodyRoll: this.diveSide * 1.45 * k, bodyDrop: 0.68 * k,
        };
      }
      case 'kick': {
        // 0~0.12s 백스윙, 0.12~0.3s 스윙, 이후 팔로스루
        const a = this.actionT;
        const back = Math.min(1, a / 0.12);
        const swing = THREE.MathUtils.clamp((a - 0.12) / 0.15, 0, 1);
        const leg = -0.9 * back + 2.2 * swing;
        const knee = 1.4 * back * (1 - swing) + 0.2;
        const kickL = this.kickSide === -1;
        return {
          hipL: kickL ? leg : -0.15, hipR: kickL ? -0.15 : leg,
          kneeL: kickL ? knee : 0.3, kneeR: kickL ? 0.3 : knee,
          shoulderL: kickL ? 0.6 * swing : -0.7 * swing,
          shoulderR: kickL ? -0.7 * swing : 0.6 * swing,
          armSpreadL: 0.5, armSpreadR: 0.5,
          elbowL: -0.4, elbowR: -0.4,
          spine: -0.15 * swing + 0.1,
          bodyDrop: 0.05,
        };
      }
      case 'tackle': {
        // 슬라이딩: 몸을 뒤로 눕히며 한 다리를 앞으로 뻗음
        const k = Math.min(1, this.actionT / 0.12);
        return {
          hipL: 1.5 * k, hipR: 0.6 * k, kneeL: 0.05, kneeR: 1.4 * k,
          shoulderL: -0.6 * k, shoulderR: -0.9 * k, armSpreadL: 0.9 * k, armSpreadR: 0.7 * k,
          elbowL: -0.3, elbowR: -0.3,
          bodyPitch: -1.0 * k, bodyDrop: 0.62 * k,
        };
      }
      case 'dive': {
        const k = Math.min(1, this.actionT / 0.18);
        const side = this.diveSide;
        return {
          hipL: 0.2, hipR: 0.2, kneeL: 0.3, kneeR: 0.5,
          shoulderL: 0, shoulderR: 0,
          armSpreadL: side === -1 ? 2.9 * k : 2.4 * k,
          armSpreadR: side === 1 ? 2.9 * k : 2.4 * k,
          elbowL: -0.1, elbowR: -0.1,
          bodyRoll: side * 1.25 * k,
          bodyDrop: 0.35 * k,
        };
      }
      case 'celebrate': {
        const w = Math.sin(t * 9) * 0.15;
        return {
          hipL: 0.1, hipR: -0.1, kneeL: 0.2, kneeR: 0.2,
          shoulderL: -0.2, shoulderR: -0.2,
          armSpreadL: 2.6 + w, armSpreadR: 2.6 - w,
          elbowL: -0.2, elbowR: -0.2,
          spine: -0.15,
          bodyDrop: -Math.abs(Math.sin(t * 6)) * 0.12,
        };
      }
      case 'header': {
        // 점프하며 이마로 받기
        const t = Math.min(1, this.actionT / 0.5);
        const jump = Math.sin(t * Math.PI);
        return {
          hipL: 0.3, hipR: 0.1, kneeL: 0.9 * jump, kneeR: 0.5 * jump,
          shoulderL: 0.2, shoulderR: 0.2, armSpreadL: 0.9, armSpreadR: 0.9,
          elbowL: -0.6, elbowR: -0.6,
          spine: -0.25 + 0.6 * Math.min(1, t * 2),
          bodyDrop: -0.45 * jump,
        };
      }
      case 'hold': {
        // 키퍼가 공을 가슴에 안은 자세
        return {
          hipL: 0.05, hipR: -0.05, kneeL: 0.15, kneeR: 0.15,
          shoulderL: -1.2, shoulderR: -1.2, elbowL: -1.4, elbowR: -1.4,
          armSpreadL: -0.25, armSpreadR: -0.25, spine: 0.05,
        };
      }
    }
  }

  private apply(p: Record<Joint, number>): void {
    const j = this.joints;
    // 다리: X축 회전이 앞뒤 스윙 (음수 = 앞으로)
    j.hipL.rotation.x = -p.hipL;
    j.hipR.rotation.x = -p.hipR;
    j.kneeL.rotation.x = p.kneeL;
    j.kneeR.rotation.x = p.kneeR;
    j.shoulderL.rotation.x = -p.shoulderL;
    j.shoulderR.rotation.x = -p.shoulderR;
    j.shoulderL.rotation.z = -p.armSpreadL;
    j.shoulderR.rotation.z = p.armSpreadR;
    j.elbowL.rotation.x = p.elbowL;
    j.elbowR.rotation.x = p.elbowR;
    this.torso.rotation.x = p.spine;
    this.body.rotation.z = -p.bodyRoll;
    this.body.rotation.x = p.bodyPitch;
    this.body.position.y = 0.95 - p.bodyDrop;
  }
}

function makeNumberTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 4;
  g.font = 'bold 46px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.strokeText(String(n), 32, 34);
  g.fillText(String(n), 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
