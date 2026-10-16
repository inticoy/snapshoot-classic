import * as THREE from 'three';

/**
 * 관절 위치만으로 하는 리타깃팅.
 * 원본 뼈대(Rokoko 모션캡처, Google Research Football 키프레임)마다 관절 이름·축·기본 자세가 달라서
 * "각 관절의 월드 위치"라는 공통 형식으로 바꾼 뒤, 우리 캐릭터(Quaternius, Rigify DEF 뼈)의
 * 뼈 방향을 그 위치에 맞춘다. 원본 기본 자세(T/A 포즈)와 무관하게 동작한다.
 *
 * 좌표: three.js 기준, 단위 아무거나(비율로 맞춤), 캐릭터는 +Z를 바라보고 +X가 왼쪽.
 */
export type Joint =
  | 'hips' | 'spine' | 'chest' | 'neck' | 'head' | 'headTop'
  | 'lShoulder' | 'lArm' | 'lElbow' | 'lHand' | 'lHandTip'
  | 'rShoulder' | 'rArm' | 'rElbow' | 'rHand' | 'rHandTip'
  | 'lHip' | 'lKnee' | 'lAnkle' | 'lToe'
  | 'rHip' | 'rKnee' | 'rAnkle' | 'rToe';

export type Pose = Map<Joint, THREE.Vector3>;

export interface PoseSource {
  readonly name: string;
  readonly duration: number;
  /** 시간 t의 관절 위치 */
  sample(t: number): Pose;
}

/** 우리 뼈 → 방향을 맞출 원본 관절 쌍 [시작, 끝]과 뼈 자신의 방향을 정하는 자식 뼈 */
const LIMBS: [bone: string, from: Joint, to: Joint, child: string | null][] = [
  ['DEF-neck', 'neck', 'head', 'DEF-head'],
  ['DEF-head', 'head', 'headTop', null],
  ['DEF-shoulderL', 'lShoulder', 'lArm', 'DEF-upper_armL'],
  ['DEF-upper_armL', 'lArm', 'lElbow', 'DEF-forearmL'],
  ['DEF-forearmL', 'lElbow', 'lHand', 'DEF-handL'],
  ['DEF-handL', 'lHand', 'lHandTip', 'DEF-f_middle01L'],
  ['DEF-shoulderR', 'rShoulder', 'rArm', 'DEF-upper_armR'],
  ['DEF-upper_armR', 'rArm', 'rElbow', 'DEF-forearmR'],
  ['DEF-forearmR', 'rElbow', 'rHand', 'DEF-handR'],
  ['DEF-handR', 'rHand', 'rHandTip', 'DEF-f_middle01R'],
  ['DEF-thighL', 'lHip', 'lKnee', 'DEF-shinL'],
  ['DEF-shinL', 'lKnee', 'lAnkle', 'DEF-footL'],
  ['DEF-footL', 'lAnkle', 'lToe', 'DEF-toeL'],
  ['DEF-thighR', 'rHip', 'rKnee', 'DEF-shinR'],
  ['DEF-shinR', 'rKnee', 'rAnkle', 'DEF-footR'],
  ['DEF-footR', 'rAnkle', 'rToe', 'DEF-toeR'],
];
const SPINE = ['DEF-spine001', 'DEF-spine002', 'DEF-spine003'];

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();

/** 왼쪽(+X)·위(+Y) 벡터로 만든 몸통 방향 (기본 자세 = 단위 회전) */
function basis(left: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const x = v1.copy(left).normalize();
  const z = v3.crossVectors(x, up).normalize(); // 앞
  const y = v2.crossVectors(z, x).normalize();
  return out.setFromRotationMatrix(m1.makeBasis(x, y, z));
}

const legLength = (p: Pose) =>
  p.get('lHip')!.distanceTo(p.get('lKnee')!) + p.get('lKnee')!.distanceTo(p.get('lAnkle')!);

export interface BakeOptions {
  fps?: number;
  /** 제자리 재생: 엉덩이 수평 이동을 없앤다 */
  inPlace?: boolean;
}

/**
 * 원본 동작을 우리 캐릭터용 AnimationClip으로 굽는다.
 * model: SkeletonUtils.clone 한 캐릭터(원점, 기본 자세). 굽는 동안 뼈를 움직였다가 기본 자세로 되돌린다.
 */
export function bakeClip(source: PoseSource, model: THREE.Object3D, opts: BakeOptions = {}): THREE.AnimationClip {
  const fps = opts.fps ?? 30;
  const bones = new Map<string, THREE.Bone>();
  model.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
  const rest = new Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  for (const b of bones.values()) rest.set(b, { q: b.quaternion.clone(), p: b.position.clone() });
  const restore = () => { for (const [b, r] of rest) { b.quaternion.copy(r.q); b.position.copy(r.p); } model.updateMatrixWorld(true); };
  restore();

  const hips = bones.get('DEF-hips')!;
  // 우리 캐릭터의 기본 자세 정보
  const restWorldQ = new Map<string, THREE.Quaternion>();
  for (const [name, b] of bones) restWorldQ.set(name, b.getWorldQuaternion(new THREE.Quaternion()));
  const tgtLeg = bones.get('DEF-thighL')!.getWorldPosition(new THREE.Vector3())
    .distanceTo(bones.get('DEF-shinL')!.getWorldPosition(new THREE.Vector3())) +
    bones.get('DEF-shinL')!.getWorldPosition(new THREE.Vector3()).distanceTo(bones.get('DEF-footL')!.getWorldPosition(new THREE.Vector3()));
  const hipsRestWorld = hips.getWorldPosition(new THREE.Vector3());

  const first = source.sample(0);
  const scale = tgtLeg / legLength(first);
  const origin = first.get('hips')!.clone();

  const frames = Math.max(2, Math.round(source.duration * fps) + 1);
  const times: number[] = [];
  const quats = new Map<string, number[]>();
  const hipPos: number[] = [];
  const animated = ['DEF-hips', ...SPINE, ...LIMBS.map((l) => l[0])].filter((n) => bones.has(n));
  for (const n of animated) quats.set(n, []);

  const setWorld = (b: THREE.Bone, world: THREE.Quaternion) => {
    b.parent!.getWorldQuaternion(q2);
    b.quaternion.copy(q2.invert().multiply(world));
    b.updateMatrixWorld(true);
  };

  for (let f = 0; f < frames; f++) {
    const t = Math.min(source.duration, f / fps);
    const p = source.sample(t);
    restore();

    // 엉덩이: 위치 + 몸통 방향
    const hp = p.get('hips')!.clone().sub(origin).multiplyScalar(scale);
    if (opts.inPlace) hp.x = hp.z = 0;
    const world = hipsRestWorld.clone().add(hp);
    hips.position.copy(hips.parent!.worldToLocal(world.clone()));
    const hipBasis = basis(v1.subVectors(p.get('lHip')!, p.get('rHip')!), v2.subVectors(p.get('chest')!, p.get('hips')!), new THREE.Quaternion());
    setWorld(hips, hipBasis.clone().multiply(restWorldQ.get('DEF-hips')!));

    // 척추: 엉덩이 방향 → 가슴 방향으로 나눠서 비튼다
    const chestBasis = basis(v1.subVectors(p.get('lArm')!, p.get('rArm')!), v2.subVectors(p.get('neck')!, p.get('spine')!), new THREE.Quaternion());
    SPINE.forEach((name, i) => {
      const b = bones.get(name);
      if (!b) return;
      q1.slerpQuaternions(hipBasis, chestBasis, (i + 1) / SPINE.length);
      setWorld(b, q1.clone().multiply(restWorldQ.get(name)!));
    });

    // 팔다리·목: 뼈 방향을 원본 관절 방향으로 돌린다 (부모부터)
    for (const [name, from, to, child] of LIMBS) {
      const b = bones.get(name);
      if (!b) continue;
      const target = v3.subVectors(p.get(to)!, p.get(from)!);
      if (target.lengthSq() < 1e-10) continue;
      target.normalize();
      const dirLocal = child && bones.get(child) ? bones.get(child)!.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
      const cur = b.getWorldQuaternion(new THREE.Quaternion());
      const dir = dirLocal.applyQuaternion(cur);
      const swing = new THREE.Quaternion().setFromUnitVectors(dir, target);
      setWorld(b, swing.multiply(cur));
    }

    times.push(t);
    hipPos.push(hips.position.x, hips.position.y, hips.position.z);
    for (const n of animated) quats.get(n)!.push(...bones.get(n)!.quaternion.toArray());
  }
  restore();

  const tracks: THREE.KeyframeTrack[] = [new THREE.VectorKeyframeTrack('DEF-hips.position', times, hipPos)];
  for (const [n, values] of quats) tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, values));
  return new THREE.AnimationClip(source.name, source.duration, tracks);
}
