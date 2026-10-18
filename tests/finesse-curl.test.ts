import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { command, parkPlayers, simulation } from './helpers';

/** +X로 공격하며 골문 가운데를 노려 감아찬다. side: 공이 몸 오른쪽(1, 오른발) / 왼쪽(-1, 왼발) */
function curl(side: 1 | -1, z0 = 0) {
  const { match } = simulation(4);
  parkPlayers(match);
  const p = match.forward(0);
  p.actionLock = 0;
  const gx = match.oppGoalX(0);
  p.pos.set(gx - 22, 0, z0); p.facing.set(1, 0, 0);
  // 몸 오른쪽 = (-fz, 0, fx) = +Z
  match.ball.reset(p.pos.x + 0.35, z0 + side * 0.12); match.ball.owner = p; match.controlled = p;
  match.shoot(p, 0.6, true, new THREE.Vector3(1, 0, 0), true);
  const pts: THREE.Vector3[] = [];
  for (let t = 0; t < 1.6 / PHYSICS.step && match.phase === 'playing' && match.ball.position.x < gx; t++) {
    match.update(PHYSICS.step, command());
    pts.push(new THREE.Vector3(match.ball.position.x, 0, match.ball.position.z));
  }
  // 출발점→도착점 직선(현)에서 비행 중간 공이 몸 오른쪽(+)으로 휘어 나갔는지 (휘어 들어오는 공은 반대쪽으로 볼록)
  const a = pts[0], b = pts.at(-1)!;
  const d = b.clone().sub(a).normalize();
  const right = new THREE.Vector3(-d.z, 0, d.x);
  return pts[Math.floor(pts.length / 2)].clone().sub(a).dot(right);
}

it.each([-8, 0, 8])('오른발 감아차기 (z=%i): 직선보다 오른쪽으로 불룩하게 나갔다가 왼쪽으로 휘어 들어온다', (z) => {
  expect(curl(1, z)).toBeGreaterThan(0.2);
});

it.each([-8, 0, 8])('왼발 감아차기 (z=%i): 직선보다 왼쪽으로 불룩하게 나갔다가 오른쪽으로 휘어 들어온다', (z) => {
  expect(curl(-1, z)).toBeLessThan(-0.2);
});

it('약발 3 이하 오른발잡이는 공이 왼발 쪽에 있어도 주발(오른발)로 감아 — 오른쪽으로 불룩하게 나간다', async () => {
  const { match } = simulation(4);
  parkPlayers(match);
  const p = match.forward(0);
  Object.defineProperty(p, 'profile', { value: { ...p.profile, foot: 'R', weakFoot: 2 }, configurable: true });
  p.actionLock = 0;
  const gx = match.oppGoalX(0);
  p.pos.set(gx - 22, 0, 0); p.facing.set(1, 0, 0);
  match.ball.reset(p.pos.x + 0.35, -0.12); match.ball.owner = p; match.controlled = p; // 왼발 쪽
  match.shoot(p, 0.6, true, new THREE.Vector3(1, 0, 0), true);
  const pts: THREE.Vector3[] = [];
  for (let t = 0; t < 1.6 / PHYSICS.step && match.phase === 'playing' && match.ball.position.x < gx; t++) {
    match.update(PHYSICS.step, command());
    pts.push(new THREE.Vector3(match.ball.position.x, 0, match.ball.position.z));
  }
  const a = pts[0], b = pts.at(-1)!, d = b.clone().sub(a).normalize();
  expect(pts[Math.floor(pts.length / 2)].clone().sub(a).dot(new THREE.Vector3(-d.z, 0, d.x))).toBeGreaterThan(0.2);
});
