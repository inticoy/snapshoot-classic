import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AnimState, CharacterModel, FootTarget, Gesture, LegPose, ModelColors } from './PlayerModel';
import { visualRandom } from '../core/Random';
import { makeDecalTexture } from './KitDecal';
import { MotionClips } from '../anim/MotionLibrary';
import { VISUAL } from '../config';

/**
 * 스킨드 캐릭터 (Quaternius Universal Animation Library, CC0).
 * - 이동: Idle / Walk / Jog / Sprint 클립을 속도에 따라 가중치 블렌딩
 * - 세리머니: Dance 클립, 키퍼 대기: Crouch Idle 클립
 * - 킥 / 태클 / 다이빙 / 공 잡기: 라이브러리에 없어서 뼈를 코드로 회전시켜 덧입힘
 * - 유니폼: 바인드 포즈 좌표로 셔츠/바지/양말/축구화 영역을 셰이더에서 칠함
 */

let asset: GLTF | null = null;

export async function loadCharacterAsset(url: string): Promise<boolean> {
  try {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    asset = await loader.loadAsync(url);
    asset.scene.updateMatrixWorld(true);
    asset.scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      // 압축(양자화)된 좌표는 역바인드 행렬로 보정되므로, 기본 자세에서 스키닝을 적용해
      // 실제 바인드 포즈 좌표를 구해 유니폼 영역 계산용 속성으로 따로 둔다
      const pos = m.geometry.getAttribute('position');
      const kit = new Float32Array(pos.count * 3);
      const v = new THREE.Vector3();
      m.skeleton.update();
      for (let i = 0; i < pos.count; i++) {
        m.getVertexPosition(i, v);
        v.toArray(kit, i * 3);
      }
      m.geometry.setAttribute('kitPos', new THREE.BufferAttribute(kit, 3));
    });
    return true;
  } catch (e) {
    console.warn('character load failed, falling back to procedural model', e);
    return false;
  }
}

/** 모션캡처·GRF에서 구운 동작 (없으면 기존 코드 오버레이로 동작) */
let motions: MotionClips | null = null;

export async function loadMotionLibrary(url: string): Promise<boolean> {
  motions = await MotionClips.load(url);
  return motions !== null;
}

export function hasCharacterAsset(): boolean {
  return asset !== null;
}

/** 모션 테스트 페이지용: 유니폼 머티리얼을 입힌 캐릭터 복제본과 원래 클립들 */
export function createCharacterMesh(colors: ModelColors): { root: THREE.Object3D; clips: THREE.AnimationClip[] } {
  if (!asset) throw new Error('character asset not loaded');
  const root = SkeletonUtils.clone(asset.scene);
  const material = makeKitMaterial(colors);
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.material = material;
    m.castShadow = true;
    m.frustumCulled = false;
  });
  return { root, clips: asset.animations };
}

type Clip = 'idle' | 'walk' | 'jog' | 'sprint' | 'dance' | 'crouch';
const CLIP_NAMES: Record<Clip, string> = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  jog: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  dance: 'Dance_Loop',
  crouch: 'Crouch_Idle_Loop',
};
// 클립 원래 속도에 해당하는 이동 속도 (m/s) — 발 미끄러짐을 줄이기 위한 재생 속도 보정
const CLIP_SPEED = { walk: 1.6, jog: 4.2, sprint: 7.2 };

/** 옷 부위별로 나뉜 캐릭터(Mixamo)의 재질 이름 → 부위 번호. 0이면 예전처럼 한 메시를 높이로 나눠 칠한다 */
const PART_INDEX: Record<string, number> = { skin: 1, shirt: 2, shorts: 3, socks: 4, boots: 5, hair: 6 };
function partOf(m: THREE.Mesh): number {
  const name = ((m.material as THREE.Material).name ?? '').replace(/\.\d+$/, '');
  return PART_INDEX[name] ?? 0;
}

/** 축구화 크기 (m) */
const BOOT = { width: 0.1, height: 0.085 };
const BOOT_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.45, metalness: 0.05 });
const bootGeometries = new Map<number, THREE.BufferGeometry>();
/** 앞이 둥근 신발 모양: 상자를 둥글린 캡슐을 납작하게 (길이 방향 = +Z) */
function bootGeometry(length: number): THREE.BufferGeometry {
  const key = Math.round(length * 100);
  let g = bootGeometries.get(key);
  if (!g) {
    g = new THREE.CapsuleGeometry(BOOT.width / 2, Math.max(0.01, length - BOOT.width), 4, 10);
    g.rotateX(Math.PI / 2);
    g.scale(1, BOOT.height / BOOT.width, 1);
    bootGeometries.set(key, g);
  }
  return g;
}
function toeLength(toe: THREE.Bone): number {
  const child = toe.children.find((c) => (c as THREE.Bone).isBone);
  return child ? child.position.length() : 0.06;
}

/** 목 세우기 각도 (rad, 음수 = 뒤로) */
const NECK_UP = -0.35;

type Overlay = 'kick' | 'tackle' | 'dive' | 'hold' | 'header' | 'advance' | 'smother';

const HAIR_TONES = [0x1d1510, 0x3a2516, 0x6b4a2a, 0xc9a25a, 0x111111];
const SKIN_TONES = [0xf1c7a5, 0xd9a47e, 0xb07a52, 0x7d5236, 0xe8b894];

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qC = new THREE.Quaternion();
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), vT = new THREE.Vector3(), vK = new THREE.Vector3(), vP = new THREE.Vector3();
const qI = new THREE.Quaternion();
/** 서 있을 때 발목 높이 (GLB) */
const ANKLE_Y = 0.07;

export class SkinnedPlayerModel implements CharacterModel {
  readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group(); // 태클/다이빙 시 몸 전체 기울기
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = {} as Record<Clip, THREE.AnimationAction>;
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly visualBones = new Map<string, THREE.Quaternion>();
  private state: AnimState = 'idle';
  private speed = 0;
  private sprint = false;
  private actionT = 0;
  private kickSide: 1 | -1 = 1;
  private kickFlair = false;
  private diveSide: 1 | -1 = 1;
  private readonly overlay: Record<Overlay, number> = { kick: 0, tackle: 0, dive: 0, hold: 0, header: 0, advance: 0, smother: 0 };
  private danceW = 0;
  private gesture: Gesture = 'none';
  private readonly gestureW = { raise: 0, point: 0 };
  /** 재생 중인 한 번짜리 동작 (킥·슬라이딩·다이빙 등) */
  private motion: { action: THREE.AnimationAction; w: number; loop: boolean; stopping?: boolean; fadeOut: number; then?: { id: string; speed: number } } | null = null;
  private outgoing: { action: THREE.AnimationAction; w: number } | null = null;
  private readonly locoW = { idle: 1, walk: 0, jog: 0, sprint: 0 };
  private stridePhase = visualRandom.next();
  /** 개인기 다리 IK: 목표와 지금 가중치 (목표가 사라져도 마지막 자리에서 가중치만 줄여 원래 동작으로 섞여 돌아간다) */
  private legTarget: LegPose | null = null;
  private readonly legNow = {
    L: { pos: new THREE.Vector3(), toe: new THREE.Vector3(0, 0, 1), w: 0 }, R: { pos: new THREE.Vector3(), toe: new THREE.Vector3(0, 0, 1), w: 0 },
    roll: 0, pitch: 0, drop: 0,
    /** 체중 이동(디딘 발 쪽으로 엉덩이 옆 이동)·착지 반동(스프링)·이전 발 높이 */
    shift: 0, bounce: 0, bounceV: 0, prevL: ANKLE_Y, prevR: ANKLE_Y,
  };

  constructor(colors: ModelColors, private readonly keeper: boolean) {
    if (!asset) throw new Error('character asset not loaded');
    const model = SkeletonUtils.clone(asset.scene);
    this.root.add(this.pivot);
    this.pivot.add(model);

    const materials = new Map<number, THREE.Material>();
    let hasBoots = false;
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        const part = partOf(m);
        hasBoots ||= part === 5;
        // 맨살(얼굴·팔다리)은 캐릭터 텍스처 그대로, 옷·머리는 팀 색
        if (part !== 1) {
          if (!materials.has(part)) materials.set(part, makeKitMaterial(colors, part));
          m.material = materials.get(part)!;
        }
        m.castShadow = true;
        m.frustumCulled = false;
      }
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
    });

    // 맨발 몸 모델이면 신발을 붙인다 (옷이 나뉜 캐릭터는 신발 메시가 있다)
    if (!hasBoots) this.addBoots(model);

    this.mixer = new THREE.AnimationMixer(model);
    for (const [key, name] of Object.entries(CLIP_NAMES) as [Clip, string][]) {
      const clip = asset.animations.find((a) => a.name === name);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(key === 'idle' ? 1 : 0);
      // 선수마다 시작 위상은 다르되 걷기·조깅·질주는 같은 발 디딤 위상을 쓴다.
      action.time = (key === 'walk' || key === 'jog' || key === 'sprint' ? this.stridePhase : visualRandom.next()) * clip.duration;
      this.actions[key] = action;
    }
  }

  /**
   * 축구화: 원본 몸 모델은 맨발이라 발·발가락 뼈에 신발 모양을 붙인다 (뼈를 따라 움직이므로 IK·동작 그대로).
   * 바인드 자세에서 발목→발끝 방향과 땅 쪽 방향을 뼈 기준으로 구해 맞춘다.
   */
  private addBoots(model: THREE.Object3D): void {
    model.updateMatrixWorld(true);
    for (const side of ['L', 'R'] as const) {
      const foot = this.bones.get(`DEF-foot${side}`), toe = this.bones.get(`DEF-toe${side}`);
      if (!foot || !toe) continue;
      const ankle = foot.getWorldPosition(new THREE.Vector3());
      const tip = toe.localToWorld(new THREE.Vector3(0, 1, 0).multiplyScalar(toeLength(toe)));
      const along = tip.clone().sub(ankle);
      const length = along.length();
      // 신발 중심: 발목과 발끝 사이, 바닥 쪽으로 내려 밑창이 땅에 닿게
      const center = ankle.clone().addScaledVector(along, 0.5);
      center.y = Math.max(BOOT.height / 2, ankle.y - 0.03);
      const boot = new THREE.Mesh(bootGeometry(length + 0.05), BOOT_MATERIAL);
      boot.castShadow = true;
      // 월드에서 자리 잡은 뒤 발 뼈의 자식으로 옮긴다
      boot.position.copy(center);
      boot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along.clone().setY(0).normalize());
      foot.attach(boot);
    }
  }

  /**
   * 구운 동작 재생. startAt부터 speed 배속으로 한 번 (loop면 반복) 재생하고 끝나면 이동 클립으로 섞여 돌아간다.
   * 동작 데이터가 없으면 false (호출 측이 오버레이로 대체한다)
   */
  playMotion(id: string, opts: { startAt?: number; speed?: number; loop?: boolean; then?: { id: string; speed: number } } = {}): boolean {
    const clip = motions?.clip(id);
    if (!clip) return false;
    const prev = this.motion;
    const action = this.mixer.clipAction(clip);
    if (this.outgoing) this.outgoing.action.stop();
    this.outgoing = prev && prev.action !== action ? { action: prev.action, w: prev.w } : null;
    action.reset();
    action.setLoop(opts.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.time = Math.max(0, opts.startAt ?? 0);
    action.timeScale = opts.speed ?? 1;
    action.setEffectiveWeight(0);
    action.play();
    this.motion = { action, w: 0, loop: !!opts.loop, fadeOut: VISUAL.motionFade, then: opts.then };
    // 같은 부위를 움직이는 오버레이는 끈다
    this.state = 'run';
    return true;
  }

  /** freeze: 그 자리 포즈에서 멈춘 채 사라진다 (페이크처럼 차기 직전에 끊을 때 마저 차는 동작이 보이지 않게) */
  stopMotion(freeze = false): void {
    const m = this.motion;
    if (!m) return;
    if (freeze) m.action.timeScale = 0;
    m.loop = false;
    // 세리머니 종료 시 재생 위치를 끝으로 건너뛰면 포즈가 한 프레임에 튄다.
    m.stopping = true;
    m.action.setLoop(THREE.LoopOnce, Infinity);
    m.action.clampWhenFinished = true;
  }

  get currentMotionId(): string | null { return this.motion?.action.getClip().name ?? null; }

  get hipsHeight(): number | null {
    const hips = this.bones.get('DEF-hips');
    return hips ? hips.getWorldPosition(new THREE.Vector3()).y : null;
  }

  toePosition(out: THREE.Vector3, side: 'L' | 'R'): THREE.Vector3 | null {
    const toe = this.bones.get(`DEF-toe${side}`);
    return toe ? toe.getWorldPosition(out) : null;
  }

  resetAnimation(): void {
    this.motion?.action.stop();
    this.outgoing?.action.stop();
    this.motion = null;
    this.outgoing = null;
    this.visualBones.clear();
    // 직전 개인기의 발 목표·착지 반동이 리셋 뒤 첫 프레임에 섞이지 않게 한다.
    this.legTarget = null;
    for (const side of ['L', 'R'] as const) {
      this.legNow[side].pos.set(0, 0, 0);
      this.legNow[side].toe.set(0, 0, 1);
      this.legNow[side].w = 0;
    }
    Object.assign(this.legNow, { roll: 0, pitch: 0, drop: 0, shift: 0, bounce: 0, bounceV: 0, prevL: ANKLE_Y, prevR: ANKLE_Y });
    this.state = 'idle';
    this.actionT = this.danceW = this.speed = 0;
    Object.assign(this.locoW, { idle: 1, walk: 0, jog: 0, sprint: 0 });
    this.sprint = false;
    for (const key of Object.keys(this.overlay) as Overlay[]) this.overlay[key] = 0;
    this.pivot.position.set(0, 0, 0);
    this.pivot.rotation.set(0, 0, 0);
    this.updateClipWeights(0);
    this.mixer.update(0);
  }

  get motionPlaying(): boolean {
    return !!this.motion;
  }

  setLegPose(pose: LegPose | null): void {
    this.legTarget = pose;
    if (!pose) return;
    for (const side of ['L', 'R'] as const) {
      this.legNow[side].pos.copy(pose[side].pos);
      this.legNow[side].toe.copy(pose[side].toe);
    }
  }

  setGesture(gesture: Gesture): void {
    this.gesture = gesture;
  }

  handPosition(out: THREE.Vector3, side: 'L' | 'R' = 'R'): THREE.Vector3 | null {
    const hand = this.bones.get(side === 'L' ? 'DEF-handL' : 'DEF-handR');
    return hand ? hand.getWorldPosition(out) : null;
  }

  get current(): AnimState {
    return this.state;
  }

  play(state: AnimState, opts: { side?: 1 | -1; flair?: boolean } = {}): void {
    if (state === 'kick' || state === 'tackle' || state === 'dive' || state === 'smother' || state === 'header') {
      this.actionT = 0;
      if (state === 'kick') { this.kickSide = opts.side ?? 1; this.kickFlair = opts.flair ?? false; }
      if (state === 'dive' || state === 'smother') this.diveSide = opts.side ?? 1;
    }
    this.state = state;
  }

  setLocomotion(speed: number, sprint: boolean): void {
    this.speed = speed;
    this.sprint = sprint;
  }

  update(dt: number): void {
    this.actionT += dt;
    this.updateMotionWeight(dt);
    this.updateClipWeights(dt);
    // 서로 다른 이동 클립의 발 디딤 시점을 맞춰 가중치 경계에서 발이 튀지 않게 한다.
    this.stridePhase = (this.stridePhase + dt * Math.max(0.6, this.speed / CLIP_SPEED.jog) / this.actions.jog.getClip().duration) % 1;
    for (const key of ['walk', 'jog', 'sprint'] as const) {
      const action = this.actions[key];
      if (action) action.time = this.stridePhase * action.getClip().duration;
    }
    this.mixer.update(dt);
    const boneBlend = 1 - Math.exp(-dt / VISUAL.boneSmoothTime);
    for (const [name, bone] of this.bones) {
      const previous = this.visualBones.get(name);
      if (previous) {
        qA.copy(bone.quaternion);
        bone.quaternion.slerpQuaternions(previous, qA, boneBlend);
        previous.copy(bone.quaternion);
      } else this.visualBones.set(name, bone.quaternion.clone());
    }

    // 오버레이 동작 가중치 크로스페이드
    const fadeIn = 1 - Math.exp(-22 * dt);
    const fadeOut = 1 - Math.exp(-9 * dt);
    for (const k of Object.keys(this.overlay) as Overlay[]) {
      const target = this.state === k ? 1 : 0;
      this.overlay[k] += (target - this.overlay[k]) * (target ? fadeIn : fadeOut);
    }
    this.applyOverlays();
    // 심판 동작: GLB에서 '.'이 빠진 실제 뼈 이름을 쓴다
    const k = 1 - Math.exp(-10 * dt);
    this.gestureW.raise += ((this.gesture === 'raise' ? 1 : 0) - this.gestureW.raise) * k;
    this.gestureW.point += ((this.gesture === 'point' ? 1 : 0) - this.gestureW.point) * k;
    // 자세 보정: 원본 동작이 목을 앞으로 빼고 있어(거북목) 목을 세우고 머리는 시선이 수평이 되게 살짝 숙인다
    this.rotateBone('DEF-neck', X_AXIS, NECK_UP);
    this.rotateBone('DEF-head', X_AXIS, -NECK_UP * 0.5);
    this.applyLegs(dt);
    if (this.gestureW.raise > 0.002) this.rotateBone('DEF-upper_armR', Z_AXIS, -2.75 * this.gestureW.raise);
    if (this.gestureW.point > 0.002) {
      this.rotateBone('DEF-upper_armR', Z_AXIS, -1.45 * this.gestureW.point);
      this.rotateBone('DEF-upper_armR', Y_AXIS, -1.1 * this.gestureW.point);
    }
  }

  /** 동작 가중치: 이전 동작을 유지하며 새 동작으로 섞고, 끝에서는 이동 자세로 복귀한다. */
  private updateMotionWeight(dt: number): void {
    if (this.outgoing) {
      this.outgoing.w = Math.max(0, this.outgoing.w - dt / VISUAL.motionFade);
      this.outgoing.action.setEffectiveWeight(this.outgoing.w);
      if (this.outgoing.w <= 0) { this.outgoing.action.stop(); this.outgoing = null; }
    }
    const m = this.motion;
    if (!m) return;
    const clip = m.action.getClip();
    const left = (clip.duration - m.action.time) / Math.max(0.01, Math.abs(m.action.timeScale));
    // 이어 붙일 동작이 있으면 끝나기 직전에 넘겨준다 (가중치는 이어받아 끊김 없이)
    if (m.then && left < 0.1) {
      const next = m.then;
      m.then = undefined;
      if (this.playMotion(next.id, { speed: next.speed })) return;
    }
    const target = m.stopping ? 0 : !m.loop && left < m.fadeOut ? Math.max(0, left / m.fadeOut) : 1;
    m.w = target < m.w ? Math.max(target, m.w - dt / VISUAL.motionFade) : Math.min(1, m.w + dt / VISUAL.motionFade);
    m.action.setEffectiveWeight(m.w);
    if (!m.loop && (m.stopping || left <= 0.001) && m.w <= 0.001) {
      m.action.stop();
      this.motion = null;
    }
  }

  private updateClipWeights(dt: number): void {
    const s = this.speed;
    // 속도 → 클립 가중치 (구간 선형 보간)
    const loco: Record<'idle' | 'walk' | 'jog' | 'sprint', number> = { idle: 0, walk: 0, jog: 0, sprint: 0 };
    const pts: [number, keyof typeof loco][] = [
      [0, 'idle'],
      [1.4, 'walk'],
      [4.2, 'jog'],
      [this.sprint ? 6.4 : 7.6, 'sprint'],
    ];
    if (s <= 0) loco.idle = 1;
    else if (s >= pts[3][0]) loco.sprint = 1;
    else {
      for (let i = 0; i < 3; i++) {
        const [a, ka] = pts[i];
        const [b, kb] = pts[i + 1];
        if (s >= a && s <= b) {
          const t = (s - a) / (b - a);
          loco[ka] = 1 - t;
          loco[kb] = t;
        }
      }
    }

    const celebrate = this.state === 'celebrate';
    this.danceW += ((celebrate ? 1 : 0) - this.danceW) * (1 - Math.exp(-5 * dt));
    const rest = (1 - this.danceW) * Math.max(0, 1 - (this.motion?.w ?? 0) - (this.outgoing?.w ?? 0));
    const idleClip: Clip = this.keeper && this.state !== 'hold' ? 'crouch' : 'idle';

    const set = (k: Clip, w: number) => this.actions[k]?.setEffectiveWeight(w);
    const blend = 1 - Math.exp(-dt / VISUAL.locomotionFade);
    for (const key of Object.keys(this.locoW) as (keyof typeof this.locoW)[]) {
      this.locoW[key] += (loco[key] - this.locoW[key]) * blend;
    }
    set('idle', idleClip === 'idle' ? this.locoW.idle * rest : 0);
    set('crouch', idleClip === 'crouch' ? this.locoW.idle * rest : 0);
    set('walk', this.locoW.walk * rest);
    set('jog', this.locoW.jog * rest);
    set('sprint', this.locoW.sprint * rest);
    set('dance', this.danceW * Math.max(0, 1 - (this.motion?.w ?? 0) - (this.outgoing?.w ?? 0)));

    // 실제 이동 속도에 맞춰 재생 속도 조절
    // 세 클립을 같은 stridePhase에서 직접 샘플링하므로 믹서가 별도 속도로 진행시키지 않는다.
    this.actions.walk?.setEffectiveTimeScale(0);
    this.actions.jog?.setEffectiveTimeScale(0);
    this.actions.sprint?.setEffectiveTimeScale(0);
  }

  /** 개인기 다리 IK: 몸을 기울이고 낮춘 뒤 두 다리를 발목 목표로 굽힌다 (구운 동작 위에 덧입힘) */
  private applyLegs(dt: number): void {
    const t = this.legTarget, n = this.legNow;
    // 시작은 빠르게 붙고(첫 터치가 0.1초 안팎), 끝나면 조금 더 천천히 원래 동작으로
    const k = 1 - Math.exp(-dt / (t ? 0.035 : 0.07));
    n.L.w += ((t ? t.L.w : 0) - n.L.w) * k;
    n.R.w += ((t ? t.R.w : 0) - n.R.w) * k;
    n.roll += ((t?.roll ?? 0) - n.roll) * k;
    n.pitch += ((t?.pitch ?? 0) - n.pitch) * k;
    n.drop += ((t?.drop ?? 0) - n.drop) * k;
    // 사람처럼 보이게 하는 부수 동작 (발 목표에서 자동으로): 든 발의 높이 = 체중이 반대 발에 실린 정도
    const liftL = THREE.MathUtils.clamp((n.L.pos.y - ANKLE_Y) / 0.22, 0, 1) * n.L.w;
    const liftR = THREE.MathUtils.clamp((n.R.pos.y - ANKLE_Y) / 0.22, 0, 1) * n.R.w;
    // 디딘 발 위로 엉덩이를 옮긴다 (모델 +X = 왼쪽): 오른발을 들면 왼쪽으로
    n.shift += ((liftR - liftL) * 0.07 - n.shift) * (1 - Math.exp(-dt / 0.08));
    // 발이 땅에 닿는 순간 살짝 내려앉았다가 튀어 오른다 (감쇠 스프링)
    for (const side of ['L', 'R'] as const) {
      const prev = side === 'L' ? n.prevL : n.prevR, y = n[side].pos.y;
      if (t && prev > ANKLE_Y + 0.05 && y <= ANKLE_Y + 0.02) n.bounceV -= 0.55;
      if (side === 'L') n.prevL = y; else n.prevR = y;
    }
    n.bounceV += (-140 * n.bounce - 16 * n.bounceV) * dt;
    n.bounce += n.bounceV * dt;
    const w = Math.max(n.L.w, n.R.w);
    if (w < 0.002 && Math.abs(n.roll) + Math.abs(n.pitch) + n.drop < 0.002) return;
    this.pivot.rotation.z += n.roll;
    this.pivot.rotation.x += n.pitch;
    this.pivot.position.y += n.bounce - n.drop;
    this.pivot.position.x += n.shift;
    this.root.updateMatrixWorld(true);
    // 상체: 든 다리 반대로 비틀고(오른발을 들면 오른 어깨가 뒤로), 반대 팔을 벌려 균형, 고개는 공을 내려다본다
    const twist = -(liftR - liftL) * 0.32;
    this.rotateBone('DEF-spine001', Y_AXIS, twist * 0.4);
    this.rotateBone('DEF-spine003', Y_AXIS, twist * 0.6);
    this.rotateBone('DEF-upper_armL', Z_AXIS, (0.25 + 0.75 * liftR) * w);
    this.rotateBone('DEF-upper_armR', Z_AXIS, -(0.25 + 0.75 * liftL) * w);
    this.rotateBone('DEF-neck', X_AXIS, 0.3 * w);
    for (const side of ['L', 'R'] as const) if (n[side].w > 0.002) this.solveLeg(side, n[side]);
  }

  /** 두 뼈 IK: 무릎은 몸 앞쪽(조금 바깥)으로 굽힌다. 발끝은 목표 방향으로 돌린다 */
  private solveLeg(side: 'L' | 'R', f: FootTarget): void {
    const thigh = this.bones.get(`DEF-thigh${side}`), shin = this.bones.get(`DEF-shin${side}`), foot = this.bones.get(`DEF-foot${side}`), toe = this.bones.get(`DEF-toe${side}`);
    if (!thigh || !shin || !foot || !toe) return;
    thigh.getWorldPosition(vA); shin.getWorldPosition(vB); foot.getWorldPosition(vC);
    const la = vA.distanceTo(vB), lb = vB.distanceTo(vC);
    vT.copy(f.pos).sub(vA);
    const d = THREE.MathUtils.clamp(vT.length(), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
    vT.normalize();
    // 무릎 방향: 모델 앞(+Z)에 바깥쪽(왼다리 +X)을 조금 섞는다
    vP.set(side === 'L' ? 0.25 : -0.25, 0, 1).applyQuaternion(this.root.getWorldQuaternion(qC));
    vP.addScaledVector(vT, -vP.dot(vT)).normalize();
    const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
    vK.copy(vA).addScaledVector(vT, la * cosA).addScaledVector(vP, la * Math.sqrt(1 - cosA * cosA));
    this.aimBone(thigh, vB.sub(vA), vK.clone().sub(vA), f.w);
    shin.getWorldPosition(vB); foot.getWorldPosition(vC);
    const goal = vA.clone().addScaledVector(vT, d);
    this.aimBone(shin, vC.sub(vB), goal.sub(vB), f.w);
    foot.getWorldPosition(vC); toe.getWorldPosition(vB);
    this.aimBone(foot, vB.sub(vC), f.toe, f.w);
  }

  /** 뼈를 월드에서 from 방향이 to 방향을 향하도록 돌린다 (w만큼) */
  private aimBone(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3, w: number): void {
    if (!bone.parent || from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
    qA.setFromUnitVectors(from.normalize(), to.clone().normalize());
    // slerpQuaternions(a, b)는 먼저 a를 복사하므로 qA를 b로 넘기면 안 된다
    if (w < 1) qA.copy(qI.clone().slerp(qA, w));
    bone.getWorldQuaternion(qB);
    qB.premultiply(qA);
    bone.parent.getWorldQuaternion(qC);
    bone.quaternion.copy(qC.invert().multiply(qB));
    bone.updateMatrixWorld(true);
  }

  /** 모델 좌표계 기준 축으로 뼈를 회전 (애니메이션 위에 덧입힘) */
  private rotateBone(name: string, axis: THREE.Vector3, angle: number): void {
    // GLTFLoader가 이름의 점을 제거하므로 실제 GLB 뼈 이름을 사용한다.
    const bone = this.bones.get(name);
    if (!bone || !bone.parent || Math.abs(angle) < 1e-4) return;
    // local' = parentWorld⁻¹ · R_world · parentWorld · local, R_world = rootWorld · R_model · rootWorld⁻¹
    this.root.getWorldQuaternion(qC);
    qA.setFromAxisAngle(axis, angle);
    qA.premultiply(qC).multiply(qC.clone().invert());
    bone.parent.getWorldQuaternion(qB);
    const parentInv = qB.clone().invert();
    bone.quaternion.premultiply(qB).premultiply(qA).premultiply(parentInv);
    bone.updateMatrixWorld(true);
  }

  private applyOverlays(): void {
    const { kick, tackle, dive, hold, header, advance, smother } = this.overlay;
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.position.set(0, 0, 0);
    if (kick + tackle + dive + hold + header + advance + smother < 0.002) return;
    this.root.updateMatrixWorld(true);

    if (kick > 0.002) {
      // 0~0.12s 백스윙, 0.12~0.27s 스윙, 이후 팔로스루
      const a = this.actionT;
      const back = Math.min(1, a / 0.12);
      const swing = THREE.MathUtils.clamp((a - 0.12) / 0.15, 0, 1);
      const leg = (-0.9 * back + 2.0 * swing) * kick;
      const knee = (1.3 * back * (1 - swing) + 0.15) * kick;
      const side = this.kickSide === 1 ? 'R' : 'L';
      const other = side === 'R' ? 'L' : 'R';
      this.rotateBone(`DEF-thigh${side}`, X_AXIS, -leg);
      this.rotateBone(`DEF-shin${side}`, X_AXIS, knee);
      if (this.kickFlair) {
        // 아웃프런트: 차는 다리를 몸 안쪽으로 교차하고 발목·상체를 바깥으로 연다.
        this.rotateBone(`DEF-thigh${side}`, Z_AXIS, this.kickSide * 0.5 * swing * kick);
        this.rotateBone(`DEF-foot${side}`, Y_AXIS, this.kickSide * 0.65 * swing * kick);
        this.rotateBone('DEF-spine001', Y_AXIS, -this.kickSide * 0.4 * swing * kick);
      }
      // 반대 팔을 벌려 균형
      this.rotateBone(`DEF-upper_arm${other}`, Z_AXIS, (other === 'L' ? 0.7 : -0.7) * swing * kick);
      this.rotateBone('DEF-spine001', X_AXIS, -0.2 * swing * kick);
    }

    if (tackle > 0.002) {
      // 슬라이딩: 몸을 뒤로 눕히고 한쪽 다리를 앞으로 뻗음
      const k = Math.min(1, this.actionT / 0.12) * tackle;
      this.pivot.rotation.x = -1.05 * k;
      this.pivot.position.y = -0.05 * k;
      this.rotateBone('DEF-thighR', X_AXIS, -1.3 * k);
      this.rotateBone('DEF-shinR', X_AXIS, 0.05 * k);
      this.rotateBone('DEF-thighL', X_AXIS, -0.5 * k);
      this.rotateBone('DEF-shinL', X_AXIS, 1.3 * k);
      this.rotateBone('DEF-upper_armL', Z_AXIS, 0.9 * k);
      this.rotateBone('DEF-upper_armR', Z_AXIS, -0.9 * k);
    }

    if (advance > 0.002) {
      // 전진 중에도 팔을 벌리고 상체를 숙여 준비 자세를 유지한다.
      this.rotateBone('DEF-spine001', X_AXIS, 0.25 * advance);
      this.rotateBone('DEF-upper_armL', Z_AXIS, 0.6 * advance);
      this.rotateBone('DEF-upper_armR', Z_AXIS, -0.6 * advance);
    }

    if (smother > 0.002) {
      const k = Math.min(1, this.actionT / 0.18) * smother;
      // 발을 기준으로 회전하는 에셋은 중심을 옮겨 잔디 위에 옆으로 눕힌다.
      this.pivot.rotation.z = this.diveSide * 1.45 * k;
      this.pivot.position.y = 0.15 * k;
      this.pivot.position.x = this.diveSide * 0.8 * k;
      this.rotateBone('DEF-upper_armL', X_AXIS, -1.3 * k);
      this.rotateBone('DEF-upper_armR', X_AXIS, -1.3 * k);
      this.rotateBone('DEF-shinL', X_AXIS, 0.4 * k);
      this.rotateBone('DEF-shinR', X_AXIS, 0.3 * k);
    }

    if (dive > 0.002) {
      const k = Math.min(1, this.actionT / 0.18) * dive;
      this.pivot.rotation.z = this.diveSide * 1.3 * k;
      this.pivot.position.y = 0.25 * k;
      this.pivot.position.x = this.diveSide * 0.15 * k;
      // 양팔을 머리 위로 뻗음
      // 구운 선방에는 팔 자세가 들어 있으므로 몸통 기울기만 더한다.
      if (!this.motion) {
        this.rotateBone('DEF-upper_armL', Z_AXIS, 2.6 * k);
        this.rotateBone('DEF-upper_armR', Z_AXIS, -2.6 * k);
      }
    }

    if (header > 0.002) {
      // 점프 → 정점에서 이마로 받으며 상체를 숙임
      const t = Math.min(1, this.actionT / 0.5);
      const jump = Math.sin(t * Math.PI) * header;
      this.pivot.position.y = 0.45 * jump;
      const nod = (-0.25 + 0.6 * Math.min(1, t * 2)) * header;
      this.rotateBone('DEF-spine002', X_AXIS, nod * 0.6);
      this.rotateBone('DEF-neck', X_AXIS, nod * 0.5);
      this.rotateBone('DEF-thighL', X_AXIS, -0.3 * jump);
      this.rotateBone('DEF-shinL', X_AXIS, 0.9 * jump);
      this.rotateBone('DEF-shinR', X_AXIS, 0.5 * jump);
      this.rotateBone('DEF-upper_armL', Z_AXIS, 0.9 * header);
      this.rotateBone('DEF-upper_armR', Z_AXIS, -0.9 * header);
    }

    if (hold > 0.002) {
      // 공을 가슴에 안기
      this.rotateBone('DEF-upper_armL', X_AXIS, -1.1 * hold);
      this.rotateBone('DEF-upper_armR', X_AXIS, -1.1 * hold);
      this.rotateBone('DEF-forearmL', X_AXIS, -1.2 * hold);
      this.rotateBone('DEF-forearmR', X_AXIS, -1.2 * hold);
    }
  }
}

/**
 * 바인드 포즈 좌표로 유니폼 영역을 칠하는 머티리얼.
 * 등번호·이름·가슴 번호·얼굴은 선수별 데칼 아틀라스(KitDecal)를 좌표 투영으로 입힌다.
 * 모델은 +Z를 바라본다 (등 = -Z). 수치는 메시 바인드 포즈 실측값.
 */
function makeKitMaterial(colors: ModelColors, part = 0): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0 });
  const decal = colors.decal && typeof document !== 'undefined' ? makeDecalTexture(colors.decal) : null;
  const uniforms = {
    uShirt: { value: new THREE.Color(colors.shirt) },
    uShorts: { value: new THREE.Color(colors.shorts) },
    uSocks: { value: new THREE.Color(colors.socks) },
    uSkin: { value: new THREE.Color(colors.skin ?? SKIN_TONES[Math.floor(visualRandom.next() * SKIN_TONES.length)]) },
    uHair: { value: new THREE.Color(colors.hair ?? HAIR_TONES[Math.floor(visualRandom.next() * HAIR_TONES.length)]) },
    uBoots: { value: new THREE.Color(0x15171c) },
    uTrim: { value: new THREE.Color(colors.trim ?? colors.shirt) },
    uGloves: { value: new THREE.Color(colors.gloves ?? 0xf4f4f0) },
    uStyle: { value: colors.style ?? 0 },
    uHairStyle: { value: colors.hairStyle ?? 0 },
    uKeeper: { value: colors.keeper ? 1 : 0 },
    uDecal: { value: decal },
    uHasDecal: { value: decal ? 1 : 0 },
    uPart: { value: part },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 kitPos;\nvarying vec3 vKit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKit = kitPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vKit;
uniform vec3 uShirt, uShorts, uSocks, uSkin, uHair, uBoots, uTrim, uGloves;
uniform float uStyle, uHairStyle, uKeeper, uHasDecal, uPart;
uniform sampler2D uDecal;

bool isHair(vec3 p) {
  if (uHairStyle > 2.5) return false;                                   // 민머리
  // 머리 실측: 정수리 1.88, 눈 1.761, 앞이마 머리선 ≈ 1.825, 머리 중심 z ≈ +0.055 (얼굴이 앞으로 나와 있다)
  if (uHairStyle > 1.5) return p.y > 1.81 || (p.y > 1.64 && p.z < 0.06) || (p.y > 1.72 && abs(p.x) > 0.072); // 긴 머리
  if (uHairStyle > 0.5) return p.y > 1.845 || (p.y > 1.73 && p.z < 0.0); // 버즈컷
  return p.y > 1.825 || (p.y > 1.7 && p.z < 0.03) || (p.y > 1.78 && abs(p.x) > 0.075 && p.z < 0.1); // 짧은 머리 (귀 위 옆머리)
}

// 데칼 아틀라스 투영. 영역 밖이면 알파 0
vec4 decalAt(vec3 p) {
  if (uHasDecal < 0.5) return vec4(0.0);
  float ax = abs(p.x);
  // 등: 이름 + 등번호 (뒤에서 보면 +X가 왼쪽)
  if (p.z < -0.02 && ax < 0.16 && p.y > 1.07 && p.y < 1.48)
    return texture2D(uDecal, vec2((0.16 - p.x) / 0.32 * 0.5, (p.y - 1.07) / 0.41));
  // 가슴 번호
  if (p.z > 0.06 && ax < 0.065 && p.y > 1.3 && p.y < 1.43)
    return texture2D(uDecal, vec2(0.75 + (p.x + 0.065) / 0.13 * 0.25, 0.5 + (p.y - 1.3) / 0.13 * 0.5));
  return vec4(0.0);
}

vec3 kitColor(vec3 p) {
  float ax = abs(p.x);
  if (p.y > 1.54) {
    // 눈알 (MPFB 눈 메시, 중심 x ±0.033, y 1.761, z 0.138): 앞쪽은 홍채
    vec3 e = vec3(ax - 0.033, p.y - 1.761, p.z - 0.138);
    if (length(e) < 0.014) return e.z > 0.003 ? vec3(0.16, 0.11, 0.08) : vec3(0.86, 0.84, 0.8);
    // 눈썹: 눈 위 얼굴 앞면에 머리색 띠 (멀리서도 얼굴 방향이 읽히게)
    // 가운데가 3~4mm 높은 완만한 아치
    if (p.z > 0.12 && ax > 0.012 && ax < 0.058 && abs(p.y - (1.79 - 7.0 * (ax - 0.035) * (ax - 0.035))) < 0.005) return mix(uSkin, uHair, 0.85);
    // 입술: 살짝 붉고 어둡게
    if (p.z > 0.12 && ax < 0.022 && abs(p.y - 1.683) < 0.006) return uSkin * vec3(0.78, 0.6, 0.58);
    if (isHair(p)) return uHair;
    return uSkin;
  }
  if (ax > 0.42) {
    // 키퍼는 긴소매 + 장갑, 필드 플레이어는 맨팔 (팔꿈치 x≈0.46, 손목 x≈0.74)
    if (uKeeper > 0.5) return ax > 0.73 ? uGloves : uShirt;
    return uSkin;
  }
  if (ax > 0.25 && p.y > 1.3) {
    // 소매 끝 라인
    if (uStyle > 0.5 && uStyle < 1.5 && ax > 0.385) return uTrim;
    return uShirt;
  }
  if (p.y > 1.04) {
    if (p.y > 1.5 && ax < 0.1) return uTrim;                             // 깃
    if (uStyle > 0.5 && uStyle < 1.5 && p.y > 1.42 && ax > 0.2) return uTrim; // 어깨 라인
    if (uStyle > 1.5 && fract(p.x * 9.0 + 0.5) < 0.2) return uTrim;      // 세로 줄무늬
    return uShirt;
  }
  if (p.y > 0.6) return (uStyle > 0.5 && ax > 0.185 && ax < 0.205) ? uTrim : uShorts; // 바지 옆선
  if (p.y > 0.1) return uSocks;
  return uBoots;
}

// 옷이 나뉜 캐릭터: 메시마다 부위가 정해져 있다 (상의 무늬·깃만 위치로)
vec3 partColor(vec3 p) {
  float ax = abs(p.x);
  if (uPart < 2.5) {
    if (uKeeper < 0.5 && ax > 0.42) return uSkin;
    if (p.y > 1.5 && ax < 0.1) return uTrim;
    if (uStyle > 0.5 && uStyle < 1.5 && p.y > 1.42 && ax > 0.2) return uTrim;
    if (uStyle > 1.5 && fract(p.x * 9.0 + 0.5) < 0.2) return uTrim;
    return uShirt;
  }
  if (uPart < 3.5) return (uStyle > 0.5 && ax > 0.17 && ax < 0.19) ? uTrim : uShorts;
  if (uPart < 4.5) return uSocks;
  if (uPart < 5.5) return uBoots;
  return uHair;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec4 dec = decalAt(vKit);
diffuseColor.rgb = mix(uPart > 0.5 ? partColor(vKit) : kitColor(vKit), dec.rgb, uPart < 0.5 || uPart > 1.5 && uPart < 2.5 ? dec.a : 0.0);`,
      );
  };
  mat.customProgramCacheKey = () => 'kit-v8';
  return mat;
}
