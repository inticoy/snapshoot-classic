import { MOTION_CATALOG } from '../data/MotionCatalog';
import { MOTION_SELECT, selectMotion, type MotionEntry, type MotionKind, type MotionSpeed } from '../anim/MotionLibrary';
import type { Player } from '../entities/Player';

/** 선수 속도 → 동작 속도 분류 */
export function speedClass(p: Player): MotionSpeed {
  const v = Math.hypot(p.vel.x, p.vel.z);
  return v < 0.8 ? 'idle' : v < 5.2 ? 'walk' : 'sprint';
}

export interface KickPlan {
  entry: MotionEntry;
  /** 동작 동안 유지할 몸 방향 (월드 각도, atan2(x, z)) = 지금 방향 */
  facing: number;
  /** 버튼을 뗀 뒤 공이 나가기까지 (초) */
  windup: number;
}

/**
 * 킥 동작 고르기: 공을 보낼 방향(월드)과 지금 몸 방향·속도·쓰는 발로 가장 맞는 클립.
 * 모션캡처가 비슷하게 맞으면 우선, 각도·속도가 크게 다르면 그 상황에 맞는 GRF 동작.
 */
/** height: 차는 순간 공 높이 (땅볼 킥에 헤딩·다이빙 헤딩 클립이 뽑히지 않게) */
export function planKick(p: Player, kind: MotionKind, dirX: number, dirZ: number, foot: 'L' | 'R', random: number, height = 0.11): KickPlan | null {
  const body = Math.atan2(p.facing.x, p.facing.z);
  const want = Math.atan2(dirX, dirZ);
  const angle = Math.atan2(Math.sin(want - body), Math.cos(want - body));
  const pick = selectMotion(MOTION_CATALOG, { kind, speed: speedClass(p), angle, foot, random, height });
  if (!pick) return null;
  return { entry: pick.entry, facing: body, windup: Math.min(MOTION_SELECT.windup, pick.entry.key) };
}

/** 킥 말고 종류·속도·방향만 보는 동작 (슬라이딩, 넘어짐, 다이빙, 세리머니) */
export function pickMotion(kind: MotionKind, speed: MotionSpeed, side: 'L' | 'R' | null, random: number): MotionEntry | null {
  const list = MOTION_CATALOG.filter((e) => e.kind === kind && (!side || !e.side || e.side === side));
  if (!list.length) return null;
  const same = list.filter((e) => e.speed === speed);
  const pool = same.length ? same : list;
  // 모션캡처가 있으면 우선
  const mocap = pool.filter((e) => e.source === 'mocap');
  const final = mocap.length ? mocap : pool;
  return final[Math.floor(random * final.length) % final.length];
}
