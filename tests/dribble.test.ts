import * as THREE from 'three';
import { expect, it } from 'vitest';
import { DRIBBLE, PHYSICS } from '../src/config';
import { command, parkPlayers, simulation } from './helpers';

/** 사용자 선수가 공을 갖고 방향키 입력대로 달리는 장면 */
function scene(seed = 1) {
  const { match } = simulation(seed);
  parkPlayers(match);
  const p = match.forward(0);
  p.actionLock = 0;
  p.pos.set(-20, 0, 0);
  p.facing.set(1, 0, 0);
  match.ball.reset(-19.6, 0);
  match.ball.owner = match.ball.lastTouch = p;
  match.controlled = p;
  const cmd = command();
  const run = (seconds: number, move: THREE.Vector3, sprint = false, each?: () => void) => {
    cmd.move.copy(move);
    cmd.sprint = sprint;
    for (let i = 0; i < seconds / PHYSICS.step; i++) {
      match.update(PHYSICS.step, cmd);
      each?.();
    }
  };
  return { match, p, run };
}

it('달리면 공이 발에서 떨어졌다 다시 닿는다 (터치가 반복되고 거리가 출렁인다)', () => {
  const { match, p, run } = scene();
  let touches = 0, minD = Infinity, maxD = 0;
  run(3, new THREE.Vector3(1, 0, 0), false, () => {
    touches += match.events.filter((e) => e.type === 'touch').length;
    match.events.length = 0;
    const d = Math.hypot(match.ball.position.x - p.pos.x, match.ball.position.z - p.pos.z);
    minD = Math.min(minD, d);
    maxD = Math.max(maxD, d);
  });
  expect(match.ball.owner).toBe(p);
  expect(touches).toBeGreaterThan(3);
  expect(maxD - minD).toBeGreaterThan(0.25);
});

it('질주 터치는 걷기보다 공을 멀리 치고 나간다', () => {
  const far = (sprint: boolean) => {
    const { match, p, run } = scene(2);
    let maxAhead = 0;
    run(3, new THREE.Vector3(1, 0, 0), sprint, () => {
      maxAhead = Math.max(maxAhead, (match.ball.position.x - p.pos.x) * p.facing.x + (match.ball.position.z - p.pos.z) * p.facing.z);
    });
    return maxAhead;
  };
  expect(far(true)).toBeGreaterThan(far(false) + 0.2);
});

it('공의 방향은 발이 닿는(터치) 순간에만 바뀌고, 꺾으면 결국 새 방향으로 간다', () => {
  const { match, run } = scene(3);
  run(1.5, new THREE.Vector3(1, 0, 0), true);
  let prev = match.ball.velocity.clone();
  let turnsWithoutTouch = 0;
  for (let i = 0; i < 1.5 / PHYSICS.step; i++) {
    match.events.length = 0;
    run(PHYSICS.step, new THREE.Vector3(0, 0, 1), true);
    const v = match.ball.velocity;
    const a = Math.atan2(v.z, v.x), b = Math.atan2(prev.z, prev.x);
    const turned = Math.hypot(v.x, v.z) > 1 && Math.hypot(prev.x, prev.z) > 1 && Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > 0.2;
    if (turned && !match.events.some((e) => e.type === 'touch')) turnsWithoutTouch++;
    prev = v.clone();
  }
  expect(turnsWithoutTouch).toBe(0);
  expect(match.ball.velocity.z).toBeGreaterThan(Math.abs(match.ball.velocity.x));
});

it('멈추면 공을 발 앞에 세워 둔다', () => {
  const { match, p, run } = scene(4);
  run(1.5, new THREE.Vector3(1, 0, 0));
  run(1.5, new THREE.Vector3());
  const d = Math.hypot(match.ball.position.x - p.pos.x, match.ball.position.z - p.pos.z);
  expect(match.ball.owner).toBe(p);
  expect(d).toBeLessThan(0.8);
  expect(Math.hypot(match.ball.velocity.x, match.ball.velocity.z)).toBeLessThan(0.3);
});

it('공이 너무 멀어지면 소유를 잃는다', () => {
  const { match, p, run } = scene(5);
  run(1, new THREE.Vector3(1, 0, 0));
  // 발이 닿지 않는 곳으로 크게 차 버린 터치
  match.ball.body.position.x = p.pos.x + 1.6;
  match.ball.body.velocity.set(16, 0, 0);
  run(0.8, new THREE.Vector3(1, 0, 0));
  expect(match.ball.owner).not.toBe(p);
  expect(DRIBBLE.leash).toBeGreaterThan(2);
});
