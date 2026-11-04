import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { SKILLS } from '../src/gameplay/Skills';
import { command, parkPlayers, simulation } from './helpers';

// 사포를 달리다 쓰면 공이 몸 뒤에 떨어지던 문제의 일반화: 모든 개인기를 질주 중에 써도 공을 잃지 않고,
// 끝난 뒤 나가는 방향으로 계속 달리면 공이 2m 안에 붙어 있다.
it.each(SKILLS.filter((d) => !d.sustained && d.trigger.kind !== 'fake').map((d) => [d.id, d] as const))('질주 중 %s: 공을 잃지 않고 끝난 뒤에도 공이 몸 가까이', (_id, def) => {
  const { match } = simulation(5);
  parkPlayers(match);
  const p = match.teams[0].find((q) => q.slot.label === 'ST')!;
  p.actionLock = 0; p.pos.set(-30, 0, 0); p.facing.set(1, 0, 0);
  Object.defineProperty(p, 'profile', { value: { ...p.profile, skill: 5 }, configurable: true });
  match.ball.reset(-29.6, 0); match.ball.owner = p; match.controlled = p;
  const cmd = command(); cmd.move.set(1, 0, 0); cmd.sprint = true;
  for (let t = 0; t < 1.5; t += PHYSICS.step) match.update(PHYSICS.step, cmd);
  expect(Math.hypot(p.vel.x, p.vel.z)).toBeGreaterThan(6);
  let started = false;
  for (let k = 0; k < 120 && !(started = match.skills.start(p, def)); k++) match.update(PHYSICS.step, cmd);
  expect(started).toBe(true);
  cmd.move.copy(new THREE.Vector3(Math.cos(def.exit.dir), 0, Math.sin(def.exit.dir)));
  let maxGap = 0;
  for (let t = 0; t < def.duration + 1; t += PHYSICS.step) {
    match.update(PHYSICS.step, cmd);
    expect(match.ball.owner, `t=${t.toFixed(2)}`).toBe(p);
    if (t > def.duration) maxGap = Math.max(maxGap, Math.hypot(match.ball.position.x - p.pos.x, match.ball.position.z - p.pos.z));
  }
  expect(maxGap).toBeLessThan(2);
});
