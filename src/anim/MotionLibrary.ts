import * as THREE from 'three';

/**
 * 동작 라이브러리: 모션캡처(Rohr)와 GRF 키프레임을 같은 태그로 정리한 목록 + 상황별 선택기.
 * 데이터는 scripts/bake-motions.ts가 만든다 (태그: src/data/MotionCatalog.ts, 키프레임: public/assets/motions.json).
 */
export type MotionKind = 'pass' | 'lob' | 'shot' | 'dive' | 'save' | 'slide' | 'fall' | 'getup' | 'throw' | 'celebrate' | 'card' | 'trap' | 'control' | 'turn';
export type MotionSpeed = 'idle' | 'walk' | 'sprint';

export interface MotionEntry {
  id: string;
  kind: MotionKind;
  source: 'mocap' | 'grf';
  /** 킥: 공에 닿는 발 / 다이빙: 몸을 던지는 쪽 (L = 몸의 왼쪽) */
  side: 'L' | 'R' | null;
  speed: MotionSpeed;
  /** 핵심 순간(공 터치·다이빙)까지 시간 (초) */
  key: number;
  duration: number;
  /** 시작 몸 방향 기준 공이 나가는 방향 (라디안, + = 왼쪽) */
  ballAngle: number;
  /** 시작 대비 핵심 순간·끝의 몸 각도 */
  startYaw: number;
  endYaw: number;
  power: number;
  height: number;
  /** 이어서 재생할 동작 id (슬라이딩·넘어짐 → 일어나기) */
  next?: string;
}

/** 선택 가중치. 모션 랩의 '상황 테스트'에서 조정하며 본다 */
export const MOTION_SELECT = {
  /** 모션캡처 가산점: 상황이 비슷하게 맞으면 모션캡처가 이긴다 */
  mocapBonus: 0.6,
  /** 공 방향이 1라디안 어긋날 때 감점 */
  angleCost: 2.2,
  speedMismatch: 0.9,
  /** 반대 발 동작 감점 (발은 공 위치로 정해져 바뀔 수 있으니 속도 불일치보다 작게) */
  wrongFoot: 0.6,
  /** 같은 동작 반복을 줄이는 무작위 폭 */
  jitter: 0.25,
  /** 킥 버튼을 뗀 뒤 공이 나가기까지 기본 시간 (초). 클립의 터치 직전 이만큼부터 재생한다 */
  windup: 0.16,
};

export interface MotionQuery {
  kind: MotionKind;
  speed: MotionSpeed;
  /** 지금 몸 방향 기준으로 공을 보낼 각도 (+ = 왼쪽) */
  angle: number;
  foot?: 'L' | 'R';
  /** 0..1 무작위 (재현 가능한 경기 난수를 넘긴다) */
  random?: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * 후보마다 점수를 매겨 가장 높은 동작을 고른다: 모션캡처 가산점 - 공 방향 차이 - 속도 불일치 - 반대 발.
 */
export function selectMotion(catalog: MotionEntry[], q: MotionQuery): { entry: MotionEntry; score: number } | null {
  let best: { entry: MotionEntry; score: number } | null = null;
  const S = MOTION_SELECT;
  for (const e of catalog) {
    if (e.kind !== q.kind) continue;
    // 클립은 지금 몸 방향 그대로 시작한다. 공 방향(ballAngle)이 원하는 각도와 다를수록 감점
    // (실제 공은 킥 계산대로 나가므로, 차이는 '보이는 동작'의 어긋남이다)
    let score = (e.source === 'mocap' ? S.mocapBonus : 0) - Math.abs(wrap(q.angle - e.ballAngle)) * S.angleCost;
    if (e.speed !== q.speed) score -= S.speedMismatch * (e.speed === 'idle' || q.speed === 'idle' ? 1.5 : 1);
    if (q.foot && e.side && e.side !== q.foot) score -= S.wrongFoot;
    if (q.random !== undefined) score += (hash(e.id, q.random) - 0.5) * S.jitter;
    if (!best || score > best.score) best = { entry: e, score };
  }
  return best;
}

function hash(id: string, r: number): number {
  let h = Math.floor(r * 1e6);
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return ((h >>> 0) % 10000) / 10000;
}

// ---------------------------------------------------------------- 키프레임 → AnimationClip

interface MotionData { fps: number; bones: string[]; clips: Record<string, { hips: number[]; q: string }> }

/** 요를 뺀 클립 이름 접미사 */
export const FLAT = '#flat';

export class MotionClips {
  private constructor(private readonly data: MotionData, private readonly cache = new Map<string, THREE.AnimationClip>()) {}

  static async load(url: string): Promise<MotionClips | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return new MotionClips((await res.json()) as MotionData);
    } catch {
      return null;
    }
  }

  has(id: string): boolean {
    return id.replace(FLAT, '') in this.data.clips;
  }

  clip(id: string): THREE.AnimationClip | null {
    const cached = this.cache.get(id);
    if (cached) return cached;
    if (id.endsWith(FLAT)) return this.flat(id);
    const c = this.data.clips[id];
    if (!c) return null;
    const { fps, bones } = this.data;
    const frames = c.hips.length / 3;
    const times = Array.from({ length: frames }, (_, i) => i / fps);
    // 16비트 정수 base64 → 쿼터니언 성분
    const raw = Uint8Array.from(atob(c.q), (ch) => ch.charCodeAt(0));
    const q = new Int16Array(raw.buffer);
    const tracks: THREE.KeyframeTrack[] = bones.map((bone, b) => {
      const values = new Float32Array(frames * 4);
      for (let f = 0; f < frames; f++) for (let k = 0; k < 4; k++) values[f * 4 + k] = q[(f * bones.length + b) * 4 + k] / 32767;
      return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
    });
    // 부모 로컬 축과 월드 축이 다르므로 bakeClip에서 만든 세 축을 그대로 복원한다.
    tracks.push(new THREE.VectorKeyframeTrack('DEF-hips.position', times, c.hips));
    const clip = new THREE.AnimationClip(id, (frames - 1) / fps, tracks);
    this.cache.set(id, clip);
    return clip;
  }

  /**
   * 엉덩이의 수평 회전(요)을 시작 방향에 고정한 클립 ('<id>#flat').
   * 개인기처럼 몸 방향을 게임이 직접 돌리는 동작에서 클립의 회전과 겹쳐 두 번 돌지 않게 한다.
   * 엉덩이 부모(root)의 로컬 축은 Z가 위다 → Z축 둘레 비틀림만 뺀다 (기울기·숙임은 그대로)
   */
  private flat(id: string): THREE.AnimationClip | null {
    const base = this.clip(id.slice(0, -FLAT.length));
    if (!base) return null;
    const clip = base.clone();
    clip.name = id;
    const track = clip.tracks.find((t) => t.name === 'DEF-hips.quaternion');
    if (track) {
      const v = track.values;
      const yaw = (i: number) => 2 * Math.atan2(v[i * 4 + 2], v[i * 4 + 3]);
      const y0 = yaw(0);
      const q = new THREE.Quaternion(), r = new THREE.Quaternion(), z = new THREE.Vector3(0, 0, 1);
      for (let i = 0; i < v.length / 4; i++) {
        q.fromArray(v, i * 4);
        r.setFromAxisAngle(z, -(yaw(i) - y0));
        r.multiply(q).toArray(v, i * 4);
      }
    }
    this.cache.set(id, clip);
    return clip;
  }
}
