import * as THREE from 'three';
import type { Joint, Pose, PoseSource } from './Retarget';

// ---------------------------------------------------------------- Rokoko FBX (모션캡처)

/** Rokoko 기본 뼈대 → 공통 관절 */
const ROKOKO: Record<Joint, string> = {
  hips: 'Hips', spine: 'Spine1', chest: 'Spine4', neck: 'Neck', head: 'Head', headTop: 'HeadTip',
  lShoulder: 'LeftShoulder', lArm: 'LeftArm', lElbow: 'LeftForeArm', lHand: 'LeftHand', lHandTip: 'LeftFinger3Proximal',
  rShoulder: 'RightShoulder', rArm: 'RightArm', rElbow: 'RightForeArm', rHand: 'RightHand', rHandTip: 'RightFinger3Proximal',
  lHip: 'LeftThigh', lKnee: 'LeftShin', lAnkle: 'LeftFoot', lToe: 'LeftToeTip',
  rHip: 'RightThigh', rKnee: 'RightShin', rAnkle: 'RightFoot', rToe: 'RightToeTip',
};

/** FBXLoader로 읽은 장면 + 첫 클립. 같은 이름이 둘이면 먼저 나오는(위쪽) 노드가 실제 관절이다 */
export function fbxSource(name: string, root: THREE.Object3D, clip: THREE.AnimationClip): PoseSource {
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const nodes = new Map<Joint, THREE.Object3D>();
  for (const [joint, node] of Object.entries(ROKOKO) as [Joint, string][]) {
    const o = root.getObjectByName(node);
    if (!o) throw new Error(`FBX에 ${node} 관절이 없음`);
    nodes.set(joint, o);
  }
  return {
    name,
    duration: clip.duration,
    sample(t) {
      mixer.setTime(t);
      root.updateMatrixWorld(true);
      const pose: Pose = new Map();
      for (const [j, o] of nodes) pose.set(j, o.getWorldPosition(new THREE.Vector3()));
      return pose;
    },
  };
}

// ---------------------------------------------------------------- Google Research Football (.anim)

/**
 * GRF 사람 뼈대 (data/media/objects/players/player.object). Z가 위, 캐릭터는 -Y를 바라본다.
 * .anim 파일의 쿼터니언은 각 노드의 로컬 회전을 그대로 대체한다.
 */
const GRF_NODES: [name: string, parent: string | null, offset: [number, number, number]][] = [
  ['body', null, [0, 0, 0.96]],
  ['middle', 'body', [0, 0, 0.15]],
  ['neck', 'middle', [0, -0.03, 0.5]],
  ['left_shoulder', 'middle', [0.16, -0.01, 0.48]],
  ['left_elbow', 'left_shoulder', [-0.01, 0, -0.33]],
  ['right_shoulder', 'middle', [-0.16, -0.01, 0.48]],
  ['right_elbow', 'right_shoulder', [0.01, 0, -0.33]],
  ['left_thigh', 'body', [0.087, 0, -0.01]],
  ['left_knee', 'left_thigh', [0, 0, -0.42]],
  ['left_ankle', 'left_knee', [0, -0.04, -0.44]],
  ['right_thigh', 'body', [-0.087, 0, -0.01]],
  ['right_knee', 'right_thigh', [0, 0, -0.42]],
  ['right_ankle', 'right_knee', [0, -0.04, -0.44]],
];
const GRF_NODE_NAMES = new Set(GRF_NODES.map(([n]) => n));

/** 노드 기준으로 붙이는 끝점 (손끝, 발끝, 정수리, 쇄골 시작) */
const GRF_TIPS: [joint: Joint, node: string, offset: [number, number, number]][] = [
  ['hips', 'body', [0, 0, 0]],
  ['spine', 'middle', [0, 0, 0]],
  ['chest', 'middle', [0, -0.01, 0.4]],
  ['neck', 'neck', [0, 0, 0]],
  ['head', 'neck', [0, 0, 0.1]],
  ['headTop', 'neck', [0, 0, 0.3]],
  ['lShoulder', 'middle', [0.05, -0.01, 0.46]],
  ['lArm', 'left_shoulder', [0, 0, 0]],
  ['lElbow', 'left_elbow', [0, 0, 0]],
  ['lHand', 'left_elbow', [0, 0, -0.27]],
  ['lHandTip', 'left_elbow', [0, 0, -0.37]],
  ['rShoulder', 'middle', [-0.05, -0.01, 0.46]],
  ['rArm', 'right_shoulder', [0, 0, 0]],
  ['rElbow', 'right_elbow', [0, 0, 0]],
  ['rHand', 'right_elbow', [0, 0, -0.27]],
  ['rHandTip', 'right_elbow', [0, 0, -0.37]],
  ['lHip', 'left_thigh', [0, 0, 0]],
  ['lKnee', 'left_knee', [0, 0, 0]],
  ['lAnkle', 'left_ankle', [0, 0, 0]],
  ['lToe', 'left_ankle', [0, -0.17, -0.06]],
  ['rHip', 'right_thigh', [0, 0, 0]],
  ['rKnee', 'right_knee', [0, 0, 0]],
  ['rAnkle', 'right_ankle', [0, 0, 0]],
  ['rToe', 'right_ankle', [0, -0.17, -0.06]],
];

/** GRF 애니메이션 프레임 속도 (게임이 100Hz로 돈다) */
export const GRF_FPS = 100;

interface Track { frames: number[]; values: number[][] }

export interface GrfAnim {
  tracks: Map<string, Track>;
  lastFrame: number;
  /** 파일 끝의 메타데이터 (type, balldirection 등) */
  meta: Map<string, string>;
}

export function parseGrf(text: string): GrfAnim {
  const tracks = new Map<string, Track>();
  const meta = new Map<string, string>();
  let lastFrame = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const tag = /^<([a-z_]+)>$/.exec(line);
    if (tag) {
      meta.set(tag[1], (lines[i + 1] ?? '').trim());
      continue;
    }
    if (line.startsWith('<')) continue;
    const parts = line.split(',');
    const name = parts[0];
    // 공 터치 정보: extension,football,<프레임>,<공 위치 x,y,z (선수 기준)>
    if (name === 'extension' && parts[1] === 'football') {
      meta.set('touchframe', parts[2]);
      meta.set('touchpos', parts.slice(3, 6).join(','));
      continue;
    }
    // 관절 트랙만 읽는다 (그 밖의 부가 데이터 줄은 형식이 다르다)
    if (name !== 'player' && !GRF_NODE_NAMES.has(name)) continue;
    const stride = name === 'player' ? 4 : 5;
    const t: Track = { frames: [], values: [] };
    for (let k = 1; k + stride - 1 < parts.length; k += stride) {
      const frame = Number(parts[k]);
      t.frames.push(frame);
      t.values.push(parts.slice(k + 1, k + stride).map(Number));
      lastFrame = Math.max(lastFrame, frame);
    }
    if (t.frames.length) tracks.set(name, t); // 키가 없는 줄은 기본 자세
  }
  return { tracks, lastFrame, meta };
}

function sampleTrack(t: Track, frame: number, out: number[]): number[] {
  const f = t.frames;
  if (frame <= f[0]) return out.splice(0, out.length, ...t.values[0]), out;
  for (let i = 0; i < f.length - 1; i++) {
    if (frame <= f[i + 1]) {
      const a = (frame - f[i]) / (f[i + 1] - f[i] || 1);
      const va = t.values[i], vb = t.values[i + 1];
      out.length = va.length;
      if (va.length === 4) {
        const qa = new THREE.Quaternion(...va as [number, number, number, number]);
        const qb = new THREE.Quaternion(...vb as [number, number, number, number]);
        qa.slerp(qb, a).toArray(out);
      } else for (let k = 0; k < va.length; k++) out[k] = va[k] + (vb[k] - va[k]) * a;
      return out;
    }
  }
  return out.splice(0, out.length, ...t.values[t.values.length - 1]), out;
}

/** GRF 좌표(Z 위, -Y 앞) → three.js(Y 위, +Z 앞, +X 왼쪽) */
export const toThree = (v: THREE.Vector3) => v.set(v.x, v.z, -v.y);

export function grfSource(name: string, anim: GrfAnim): PoseSource {
  const buf: number[] = [];
  return {
    name,
    duration: Math.max(anim.lastFrame, 1) / GRF_FPS,
    sample(time) {
      const frame = time * GRF_FPS;
      const world = new Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>();
      const player = anim.tracks.get('player');
      const base = player ? new THREE.Vector3(...sampleTrack(player, frame, buf) as [number, number, number]) : new THREE.Vector3();
      for (const [node, parent, offset] of GRF_NODES) {
        const track = anim.tracks.get(node);
        const local = track ? new THREE.Quaternion(...sampleTrack(track, frame, buf) as [number, number, number, number]) : new THREE.Quaternion();
        const off = new THREE.Vector3(...offset);
        if (!parent) {
          world.set(node, { q: local, p: off.add(base) });
          continue;
        }
        const pw = world.get(parent)!;
        world.set(node, { q: pw.q.clone().multiply(local), p: off.applyQuaternion(pw.q).add(pw.p) });
      }
      const pose: Pose = new Map();
      for (const [joint, node, offset] of GRF_TIPS) {
        const w = world.get(node)!;
        pose.set(joint, toThree(new THREE.Vector3(...offset).applyQuaternion(w.q).add(w.p)));
      }
      return pose;
    },
  };
}
