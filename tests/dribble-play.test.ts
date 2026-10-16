import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { command, simulation } from './helpers';
/**
 * 실제 경기 입력 측정: 킥오프 직후 사용자 공격수가 상대 압박 속에서
 * 앞 2초 → 뒤 2초 → 위 1.5초 → 아래 1.5초 → 앞+질주 2초로 드리블한다 (30경기).
 * 터치 드리블이 예전 '붙여 다니는' 드리블보다 못하지 않은지 비교한다.
 */
const PLAN: [number, number, boolean, number][] = [[1, 0, false, 2], [-1, 0, false, 2], [0, -1, false, 1.5], [0, 1, false, 1.5], [1, 0, true, 2]];
function measure(touches: boolean, seeds = 30) {
  let lost = 0, stunT = 0, fouls = 0, prog = 0, reverseT = 0, rev = 0, turn90 = 0, n90 = 0, heavy = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const { match } = simulation(seed, { dribbleTouches: touches, kickMotion: true });
    const cmd = command();
    for (let i = 0; i < 1.3 / PHYSICS.step; i++) match.update(PHYSICS.step, cmd);
    const p = match.controlled;
    let prevDir = new THREE.Vector3(1, 0, 0);
    outer: for (const [x, z, sprint, sec] of PLAN) {
      cmd.move.set(x, 0, z); cmd.sprint = sprint;
      const want = new THREE.Vector3(x, 0, z);
      const start = p.pos.clone(); let reached = -1;
      for (let i = 0; i < sec / PHYSICS.step; i++) {
        match.update(PHYSICS.step, cmd);
        if (p.stunned > 0) stunT += PHYSICS.step;
        for (const e of match.events) { if (e.type === 'foul') fouls++; if (e.type === 'heavyTouch') heavy++; }
        match.events.length = 0;
        if (match.ball.owner && match.ball.owner.team !== p.team) { lost++; break outer; }
        if (match.phase !== 'playing') break outer; // 파울·아웃: 측정 끝
        const v = new THREE.Vector3(p.vel.x, 0, p.vel.z);
        if (reached < 0 && v.length() > 1 && v.normalize().dot(want) > 0.85) reached = i * PHYSICS.step;
      }
      prog += p.pos.clone().sub(start).dot(want);
      const dot = prevDir.dot(want);
      if (dot < -0.5) { rev++; reverseT += reached < 0 ? sec : reached; }
      else if (Math.abs(dot) < 0.5) { n90++; turn90 += reached < 0 ? sec : reached; }
      prevDir = want;
    }
  }
  return { prog: Math.round(prog), lost, stun: +stunT.toFixed(1), fouls, heavy, reverse: +(reverseT / Math.max(1, rev)).toFixed(2), turn90: +(turn90 / Math.max(1, n90)).toFixed(2) };
}
it('터치 드리블: 실제 경기 입력에서 전진·소유·방향 전환이 예전 드리블에 뒤지지 않는다', () => {
  const glued = measure(false);
  const touch = measure(true);
  console.info('드리블 측정', JSON.stringify({ glued, touch }));
  expect(touch.prog).toBeGreaterThanOrEqual(glued.prog * 0.9);
  expect(touch.lost).toBeLessThanOrEqual(glued.lost + 1);
  expect(touch.reverse).toBeLessThanOrEqual(0.45);
  expect(touch.turn90).toBeLessThanOrEqual(0.45);
  expect(touch.heavy).toBeLessThanOrEqual(3);
}, 60_000);
