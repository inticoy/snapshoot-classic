import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AnimState, CharacterModel, Gesture, ModelColors } from './PlayerModel';
import { visualRandom } from '../core/Random';
import { makeDecalTexture } from './KitDecal';
import { MotionClips } from '../anim/MotionLibrary';

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

type Overlay = 'kick' | 'tackle' | 'dive' | 'hold' | 'header' | 'advance' | 'smother';

const HAIR_TONES = [0x1d1510, 0x3a2516, 0x6b4a2a, 0xc9a25a, 0x111111];
const SKIN_TONES = [0xf1c7a5, 0xd9a47e, 0xb07a52, 0x7d5236, 0xe8b894];

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qC = new THREE.Quaternion();

export class SkinnedPlayerModel implements CharacterModel {
  readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group(); // 태클/다이빙 시 몸 전체 기울기
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = {} as Record<Clip, THREE.AnimationAction>;
  private readonly bones = new Map<string, THREE.Bone>();
  private state: AnimState = 'idle';
  private speed = 0;
  private sprint = false;
  private actionT = 0;
  private kickSide: 1 | -1 = 1;
  private diveSide: 1 | -1 = 1;
  private readonly overlay: Record<Overlay, number> = { kick: 0, tackle: 0, dive: 0, hold: 0, header: 0, advance: 0, smother: 0 };
  private danceW = 0;
  private gesture: Gesture = 'none';
  private readonly gestureW = { raise: 0, point: 0 };
  /** 재생 중인 한 번짜리 동작 (킥·슬라이딩·다이빙 등) */
  private motion: { action: THREE.AnimationAction; w: number; loop: boolean; fadeOut: number; then?: { id: string; speed: number } } | null = null;

  constructor(colors: ModelColors, private readonly keeper: boolean) {
    if (!asset) throw new Error('character asset not loaded');
    const model = SkeletonUtils.clone(asset.scene);
    this.root.add(this.pivot);
    this.pivot.add(model);

    const material = makeKitMaterial(colors);
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.material = material;
        m.castShadow = true;
        m.frustumCulled = false;
      }
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
    });

    this.mixer = new THREE.AnimationMixer(model);
    for (const [key, name] of Object.entries(CLIP_NAMES) as [Clip, string][]) {
      const clip = asset.animations.find((a) => a.name === name);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(key === 'idle' ? 1 : 0);
      // 클립마다 시작 위상을 다르게 해서 선수들이 똑같이 움직이지 않게
      action.time = visualRandom.next() * clip.duration;
      this.actions[key] = action;
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
    if (prev && prev.action !== action) prev.action.stop();
    action.reset();
    action.setLoop(opts.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.time = Math.max(0, opts.startAt ?? 0);
    action.timeScale = opts.speed ?? 1;
    action.setEffectiveWeight(prev ? prev.w : 0);
    action.play();
    this.motion = { action, w: prev ? prev.w : 0, loop: !!opts.loop, fadeOut: 0.18, then: opts.then };
    // 같은 부위를 움직이는 오버레이는 끈다
    this.state = 'run';
    return true;
  }

  stopMotion(): void {
    if (this.motion) this.motion.loop = false, (this.motion.action.time = Math.max(this.motion.action.time, this.motion.action.getClip().duration - this.motion.fadeOut));
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
    this.motion = null;
    this.state = 'idle';
    this.actionT = this.danceW = this.speed = 0;
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

  play(state: AnimState, opts: { side?: 1 | -1 } = {}): void {
    if (state === 'kick' || state === 'tackle' || state === 'dive' || state === 'smother' || state === 'header') {
      this.actionT = 0;
      if (state === 'kick') this.kickSide = opts.side ?? 1;
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
    this.mixer.update(dt);

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
    if (this.gestureW.raise > 0.002) this.rotateBone('DEF-upper_armR', Z_AXIS, -2.75 * this.gestureW.raise);
    if (this.gestureW.point > 0.002) {
      this.rotateBone('DEF-upper_armR', Z_AXIS, -1.45 * this.gestureW.point);
      this.rotateBone('DEF-upper_armR', Y_AXIS, -1.1 * this.gestureW.point);
    }
  }

  /** 동작 가중치: 시작 0.08초에 걸쳐 들어오고, 끝나기 fadeOut 전부터 이동 클립으로 섞여 나간다 */
  private updateMotionWeight(dt: number): void {
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
    const target = !m.loop && left < m.fadeOut ? Math.max(0, left / m.fadeOut) : 1;
    m.w = target < m.w ? target : Math.min(1, m.w + dt / 0.08);
    m.action.setEffectiveWeight(m.w);
    if (!m.loop && left <= 0.001 && m.w <= 0.001) {
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
    const rest = (1 - this.danceW) * (1 - (this.motion?.w ?? 0));
    const idleClip: Clip = this.keeper && this.state !== 'hold' ? 'crouch' : 'idle';

    const set = (k: Clip, w: number) => this.actions[k]?.setEffectiveWeight(w);
    set('idle', idleClip === 'idle' ? loco.idle * rest : 0);
    set('crouch', idleClip === 'crouch' ? loco.idle * rest : 0);
    set('walk', loco.walk * rest);
    set('jog', loco.jog * rest);
    set('sprint', loco.sprint * rest);
    set('dance', this.danceW * (1 - (this.motion?.w ?? 0)));

    // 실제 이동 속도에 맞춰 재생 속도 조절
    const scale = (k: 'walk' | 'jog' | 'sprint') => THREE.MathUtils.clamp(s / CLIP_SPEED[k], 0.6, 1.5);
    this.actions.walk?.setEffectiveTimeScale(scale('walk'));
    this.actions.jog?.setEffectiveTimeScale(scale('jog'));
    this.actions.sprint?.setEffectiveTimeScale(scale('sprint'));
  }

  /** 모델 좌표계 기준 축으로 뼈를 회전 (애니메이션 위에 덧입힘) */
  private rotateBone(name: string, axis: THREE.Vector3, angle: number): void {
    // 주의: GLB를 읽을 때 뼈 이름의 '.'이 빠진다('DEF-thigh.L' → 'DEF-thighL'). 그래서 지금은 목·척추 외
    // 팔다리 오버레이가 적용되지 않는다. 이름만 고치면 슬라이딩 자세가 뒤틀리므로, 모션캡처 클립으로
    // 바꿀 때 함께 정리한다 (모션 랩: motions.html).
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
      this.rotateBone(`DEF-thigh.${side}`, X_AXIS, -leg);
      this.rotateBone(`DEF-shin.${side}`, X_AXIS, knee);
      // 반대 팔을 벌려 균형
      this.rotateBone(`DEF-upper_arm.${other}`, Z_AXIS, (other === 'L' ? 0.7 : -0.7) * swing * kick);
      this.rotateBone('DEF-spine.001', X_AXIS, -0.2 * swing * kick);
    }

    if (tackle > 0.002) {
      // 슬라이딩: 몸을 뒤로 눕히고 한쪽 다리를 앞으로 뻗음
      const k = Math.min(1, this.actionT / 0.12) * tackle;
      this.pivot.rotation.x = -1.05 * k;
      this.pivot.position.y = -0.05 * k;
      this.rotateBone('DEF-thigh.R', X_AXIS, -1.3 * k);
      this.rotateBone('DEF-shin.R', X_AXIS, 0.05 * k);
      this.rotateBone('DEF-thigh.L', X_AXIS, -0.5 * k);
      this.rotateBone('DEF-shin.L', X_AXIS, 1.3 * k);
      this.rotateBone('DEF-upper_arm.L', Z_AXIS, 0.9 * k);
      this.rotateBone('DEF-upper_arm.R', Z_AXIS, -0.9 * k);
    }

    if (advance > 0.002) {
      // 전진 중에도 팔을 벌리고 상체를 숙여 준비 자세를 유지한다.
      this.rotateBone('DEF-spine.001', X_AXIS, 0.25 * advance);
      this.rotateBone('DEF-upper_arm.L', Z_AXIS, 0.6 * advance);
      this.rotateBone('DEF-upper_arm.R', Z_AXIS, -0.6 * advance);
    }

    if (smother > 0.002) {
      const k = Math.min(1, this.actionT / 0.18) * smother;
      // 발을 기준으로 회전하는 에셋은 중심을 옮겨 잔디 위에 옆으로 눕힌다.
      this.pivot.rotation.z = this.diveSide * 1.45 * k;
      this.pivot.position.y = 0.15 * k;
      this.pivot.position.x = this.diveSide * 0.8 * k;
      this.rotateBone('DEF-upper_arm.L', X_AXIS, -1.3 * k);
      this.rotateBone('DEF-upper_arm.R', X_AXIS, -1.3 * k);
      this.rotateBone('DEF-shin.L', X_AXIS, 0.4 * k);
      this.rotateBone('DEF-shin.R', X_AXIS, 0.3 * k);
    }

    if (dive > 0.002) {
      const k = Math.min(1, this.actionT / 0.18) * dive;
      this.pivot.rotation.z = this.diveSide * 1.3 * k;
      this.pivot.position.y = 0.25 * k;
      this.pivot.position.x = this.diveSide * 0.15 * k;
      // 양팔을 머리 위로 뻗음
      this.rotateBone('DEF-upper_arm.L', Z_AXIS, 2.6 * k);
      this.rotateBone('DEF-upper_arm.R', Z_AXIS, -2.6 * k);
    }

    if (header > 0.002) {
      // 점프 → 정점에서 이마로 받으며 상체를 숙임
      const t = Math.min(1, this.actionT / 0.5);
      const jump = Math.sin(t * Math.PI) * header;
      this.pivot.position.y = 0.45 * jump;
      const nod = (-0.25 + 0.6 * Math.min(1, t * 2)) * header;
      this.rotateBone('DEF-spine.002', X_AXIS, nod * 0.6);
      this.rotateBone('DEF-neck', X_AXIS, nod * 0.5);
      this.rotateBone('DEF-thigh.L', X_AXIS, -0.3 * jump);
      this.rotateBone('DEF-shin.L', X_AXIS, 0.9 * jump);
      this.rotateBone('DEF-shin.R', X_AXIS, 0.5 * jump);
      this.rotateBone('DEF-upper_arm.L', Z_AXIS, 0.9 * header);
      this.rotateBone('DEF-upper_arm.R', Z_AXIS, -0.9 * header);
    }

    if (hold > 0.002) {
      // 공을 가슴에 안기
      this.rotateBone('DEF-upper_arm.L', X_AXIS, -1.1 * hold);
      this.rotateBone('DEF-upper_arm.R', X_AXIS, -1.1 * hold);
      this.rotateBone('DEF-forearm.L', X_AXIS, -1.2 * hold);
      this.rotateBone('DEF-forearm.R', X_AXIS, -1.2 * hold);
    }
  }
}

/**
 * 바인드 포즈 좌표로 유니폼 영역을 칠하는 머티리얼.
 * 등번호·이름·가슴 번호·얼굴은 선수별 데칼 아틀라스(KitDecal)를 좌표 투영으로 입힌다.
 * 모델은 +Z를 바라본다 (등 = -Z). 수치는 메시 바인드 포즈 실측값.
 */
function makeKitMaterial(colors: ModelColors): THREE.MeshStandardMaterial {
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
uniform float uStyle, uHairStyle, uKeeper, uHasDecal;
uniform sampler2D uDecal;

bool isHair(vec3 p) {
  if (uHairStyle > 2.5) return false;                                   // 민머리
  if (uHairStyle > 1.5) return p.y > 1.73 || (p.y > 1.57 && p.z < 0.0) || (p.y > 1.66 && abs(p.x) > 0.075); // 긴 머리
  if (uHairStyle > 0.5) return p.y > 1.79 || (p.y > 1.68 && p.z < -0.05); // 버즈컷
  return p.y > 1.76 || (p.y > 1.62 && p.z < -0.03);                     // 짧은 머리
}

// 데칼 아틀라스 투영. 영역 밖이면 알파 0
vec4 decalAt(vec3 p) {
  if (uHasDecal < 0.5) return vec4(0.0);
  float ax = abs(p.x);
  // 등: 이름 + 등번호 (뒤에서 보면 +X가 왼쪽)
  if (p.z < -0.02 && ax < 0.16 && p.y > 1.02 && p.y < 1.43)
    return texture2D(uDecal, vec2((0.16 - p.x) / 0.32 * 0.5, (p.y - 1.02) / 0.41));
  // 가슴 번호
  if (p.z > 0.02 && ax < 0.065 && p.y > 1.24 && p.y < 1.37)
    return texture2D(uDecal, vec2(0.75 + (p.x + 0.065) / 0.13 * 0.25, 0.5 + (p.y - 1.24) / 0.13 * 0.5));
  // 얼굴
  if (p.z > 0.0 && ax < 0.09 && p.y > 1.56 && p.y < 1.8)
    return texture2D(uDecal, vec2(0.5 + (p.x + 0.09) / 0.18 * 0.25, (p.y - 1.56) / 0.24));
  return vec4(0.0);
}

vec3 kitColor(vec3 p) {
  float ax = abs(p.x);
  if (p.y > 1.52) {
    if (isHair(p)) return uHair;
    return uSkin;
  }
  if (ax > 0.58) {
    // 키퍼는 긴소매 + 장갑, 필드 플레이어는 맨팔
    if (uKeeper > 0.5) return ax > 0.8 ? uGloves : uShirt;
    return uSkin;
  }
  if (ax > 0.24 && p.y > 1.18) {
    // 소매 끝 라인
    if (uStyle > 0.5 && uStyle < 1.5 && ax > 0.53) return uTrim;
    return uShirt;
  }
  if (p.y > 0.96) {
    if (p.y > 1.485 && ax < 0.08) return uTrim;                          // 깃
    if (uStyle > 0.5 && uStyle < 1.5 && p.y > 1.36 && ax > 0.19) return uTrim; // 어깨 라인
    if (uStyle > 1.5 && fract(p.x * 9.0 + 0.5) < 0.2) return uTrim;      // 세로 줄무늬
    return uShirt;
  }
  if (p.y > 0.52) return (uStyle > 0.5 && ax > 0.15 && ax < 0.17) ? uTrim : uShorts; // 바지 옆선
  if (p.y > 0.09) return uSocks;
  return uBoots;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec4 dec = decalAt(vKit);
diffuseColor.rgb = mix(kitColor(vKit), dec.rgb, dec.a);`,
      );
  };
  mat.customProgramCacheKey = () => 'kit-v3';
  return mat;
}
