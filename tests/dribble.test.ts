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

const up = new THREE.Vector3(0, 0, -1);
const right = new THREE.Vector3(1, 0, 0);
const down = new THREE.Vector3(0, 0, 1);

/** 출발·터치 위상은 같게 두고 전환 때의 능력치만 바꿔 회전 반응을 비교한다. */
function turnTime(seed: number, direction: THREE.Vector3, seconds: number, skill?: number, tolerance = Math.PI / 6) {
  const { match, p, run } = scene(seed);
  p.facing.copy(up);
  match.ball.reset(p.pos.x, p.pos.z - 0.4);
  match.ball.owner = match.ball.lastTouch = p;
  run(1, up);
  const original = p.profile.stats;
  if (skill !== undefined) p.profile.stats = { ...original, dribbling: skill, agility: skill };
  let elapsed = 0, reached = Infinity;
  let previous = match.ball.velocity.clone();
  let turnsWithoutTouch = 0;
  match.events.length = 0;
  try {
    run(seconds, direction, false, () => {
      elapsed += PHYSICS.step;
      const v = match.ball.velocity;
      const speed = Math.hypot(v.x, v.z);
      const delta = Math.atan2(v.z, v.x) - Math.atan2(previous.z, previous.x);
      if (speed > 1 && Math.hypot(previous.x, previous.z) > 1 &&
          Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) > 0.2 &&
          !match.events.some((e) => e.type === 'touch')) turnsWithoutTouch++;
      previous = v.clone();
      if (speed > 1 && (v.x * direction.x + v.z * direction.z) / speed >= Math.cos(tolerance)) {
        reached = Math.min(reached, elapsed);
      }
      // 중간에 놓쳤다가 다시 주운 경우도 성공으로 세지 않는다.
      expect(match.ball.owner).toBe(p);
      match.events.length = 0;
    });
    expect(turnsWithoutTouch).toBe(0);
    const v = match.ball.velocity;
    expect((v.x * direction.x + v.z * direction.z) / Math.hypot(v.x, v.z)).toBeGreaterThanOrEqual(Math.cos(tolerance));
  } finally {
    p.profile.stats = original;
  }
  return reached;
}

it.each([1, 7, 42])('↑ 1초 뒤 → 90° 전환: 1초 안에 공이 ±30°로 꺾인다 (seed=%i)', (seed) => {
  const time = turnTime(seed, right, 1);
  console.info(`90° seed=${seed}: ${time.toFixed(3)}초`);
  expect(time).toBeLessThanOrEqual(1);
});

it.each([1, 7, 42])('↑ 1초 뒤 ↓ 180° 전환: 2초 안에 소유를 유지하며 돌아선다 (seed=%i)', (seed) => {
  const time = turnTime(seed, down, 2);
  console.info(`180° seed=${seed}: ${time.toFixed(3)}초`);
  expect(time).toBeLessThanOrEqual(2);
});

// 135° 전환: 낮은 능력치(한 터치 한도 turnMin)는 두 번에 나눠 접고, 높은 능력치(turnMax)는 한 번에 접는다
const backRight = new THREE.Vector3(1, 0, 1).normalize();
it.each([1, 7, 42])('높은 드리블·민첩성은 낮은 능력치보다 135° 전환을 빨리 마친다 (seed=%i)', (seed) => {
  const low = turnTime(seed, backRight, 2, 40, Math.PI / 12);
  const high = turnTime(seed, backRight, 2, 99, Math.PI / 12);
  console.info(`능력치 seed=${seed}: 낮음 ${low.toFixed(3)}초, 높음 ${high.toFixed(3)}초`);
  expect(Number.isFinite(low)).toBe(true);
  expect(high).toBeLessThan(low);
});

it('굴러가는 공을 멈춰 세우는 터치는 한 번만 발생한다', () => {
  const { match, p, run } = scene(9);
  match.ball.body.velocity.set(3, 0, 0);
  let touches = 0;
  run(0.1, new THREE.Vector3(), false, () => {
    touches += match.events.filter((e) => e.type === 'touch').length;
    match.events.length = 0;
  });
  expect(touches).toBe(1);
  expect(match.ball.owner).toBe(p);
  expect(match.ball.speed()).toBeLessThan(0.3);
});

it.each([40, 99])('한 터치의 회전 한도는 능력치 %i에서 DRIBBLE.turnMin~turnMax이고 180°는 나눠 접는다', (skill) => {
  const { match, p, run } = scene(11);
  const original = p.profile.stats;
  p.profile.stats = { ...original, dribbling: skill, agility: skill };
  p.vel.set(5, 0, 0);
  match.ball.body.velocity.set(5, 0, 0);
  try {
    match.events.length = 0;
    run(PHYSICS.step, new THREE.Vector3(-1, 0, 0));
    const angle = Math.abs(Math.atan2(match.ball.velocity.z, match.ball.velocity.x));
    expect(angle).toBeCloseTo(skill === 40 ? DRIBBLE.turnMin : DRIBBLE.turnMax, 5);
    expect(angle).toBeLessThan(Math.PI); // 180°는 한 번에 못 접는다
    expect(match.events.filter((e) => e.type === 'touch')).toHaveLength(1);
    expect(match.ball.owner).toBe(p);
  } finally {
    p.profile.stats = original;
  }
});

it('90°로 접는 터치는 직진 터치보다 느리고 몸도 새 방향으로 일부 튼다', () => {
  const touch = (direction: THREE.Vector3) => {
    const { match, p, run } = scene(12);
    p.vel.set(5, 0, 0);
    match.ball.body.velocity.set(5, 0, 0);
    run(PHYSICS.step, direction);
    return { speed: Math.hypot(match.ball.velocity.x, match.ball.velocity.z), facing: p.facing.clone() };
  };
  const straight = touch(new THREE.Vector3(1, 0, 0));
  const turn = touch(down);
  expect(turn.speed / straight.speed).toBeGreaterThan(0.5);
  expect(turn.speed / straight.speed).toBeLessThan(0.7);
  expect(turn.facing.z).toBeGreaterThan(0.5);
  expect(turn.facing.x).toBeGreaterThan(0.5);
});
