import * as THREE from 'three';
import { GOAL, PITCH, RULES } from '../config';
import { n } from '../data/Stats';
import type { Player } from '../entities/Player';

/**
 * 페널티킥 공통 로직. 경기 중 PK와 승부차기가 함께 쓴다.
 * 나중에 SnapShoot 승부차기 모드와 합칠 때 이 모듈만 가져가면 되도록 Match에 의존하지 않는다.
 */

/** 공격 방향 a인 팀이 차는 페널티 마크 */
export function penaltySpot(attackDir: 1 | -1, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(attackDir * (PITCH.halfL - RULES.penaltySpot), 0, 0);
}

/**
 * 방향키 → 골문 안 목표 방향. 중계 화면에서 골문 좌우는 z축(화면 위아래)이다.
 * aim: -1(아래쪽 구석) ~ 1(위쪽 구석), 0 = 가운데
 */
export function penaltyAim(spot: THREE.Vector3, attackDir: 1 | -1, aim: number, out = new THREE.Vector3()): THREE.Vector3 {
  const z = THREE.MathUtils.clamp(aim, -1, 1) * (GOAL.width / 2 - 0.45);
  return out.set(attackDir * PITCH.halfL - spot.x, 0, z - spot.z).normalize();
}

/** 찬 공이 골라인을 지날 때의 z */
export function shotLineZ(spot: THREE.Vector3, vel: { x: number; z: number }, attackDir: 1 | -1): number {
  const dx = attackDir * PITCH.halfL - spot.x;
  return Math.abs(vel.x) < 0.1 ? spot.z : spot.z + (vel.z * dx) / vel.x;
}

export type DiveSide = -1 | 0 | 1;

/** 입력 축 값 → 다이빙 방향 (작은 입력은 가운데 버티기) */
export function sideFromInput(z: number): DiveSide {
  return Math.abs(z) < 0.3 ? 0 : z > 0 ? 1 : -1;
}

/**
 * AI 키퍼가 미리 고르는 방향. 반응·다이빙 능력치가 좋을수록 차는 방향을 읽는다.
 * 못 읽으면 대부분 좌우 중 하나로 넘겨짚고, 가끔 가운데 버틴다.
 */
export function keeperGuess(rand: () => number, keeper: Player, shotZ: number): DiveSide {
  const st = keeper.profile.stats;
  const skill = n(st.reflexes ?? 60) * 0.6 + n(st.diving ?? 60) * 0.4;
  const truth: DiveSide = Math.abs(shotZ) < 0.9 ? 0 : shotZ > 0 ? 1 : -1;
  if (rand() < 0.25 + 0.3 * skill) return truth;
  const r = rand();
  return r < 0.12 ? 0 : r < 0.56 ? -1 : 1;
}

/** 고른 방향으로 몸을 던진다 */
export function diveKeeper(keeper: Player, side: DiveSide): void {
  if (side === 0) return;
  const diving = n(keeper.profile.stats.diving ?? 60);
  const vz = side * (5.5 + 2.5 * diving);
  const theta = Math.atan2(keeper.facing.x, keeper.facing.z);
  keeper.startDive(new THREE.Vector3(0, 0, vz), -Math.sin(theta) * side >= 0 ? 1 : -1);
}

/** 차는 순서: 결정력·침착성이 좋은 필드 플레이어 순, 키퍼는 마지막 */
export function kickOrder(squad: Player[]): Player[] {
  const score = (p: Player) => p.profile.stats.finishing + p.profile.stats.composure;
  return [...squad.filter((p) => !p.isKeeper).sort((a, b) => score(b) - score(a)), ...squad.filter((p) => p.isKeeper)];
}

/** 승부차기 결과가 확정됐는지 (5번씩 찬 뒤에는 같은 횟수에서 점수가 갈리면 끝) */
export function shootoutDecided(results: [boolean[], boolean[]], rounds = 5): boolean {
  const [a, b] = results;
  const ga = a.filter(Boolean).length, gb = b.filter(Boolean).length;
  if (a.length <= rounds && b.length <= rounds) {
    const leftA = rounds - a.length, leftB = rounds - b.length;
    if (ga + leftA < gb || gb + leftB < ga) return true;
    if (a.length < rounds || b.length < rounds) return false;
  }
  return a.length === b.length && ga !== gb;
}
