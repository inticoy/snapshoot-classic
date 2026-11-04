import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { SKILLS } from '../src/gameplay/Skills';
import { command, parkPlayers, simulation } from './helpers';

// 개인기가 끝난 뒤 드리블 처리가 떠 있는 공의 위 속도를 지우면 사포 공이 머리 위에서 멈춰 수직으로 떨어졌다.
it.each([[false], [true]])('사포 공은 경기 루프에서도 포물선대로 머리 위를 넘어 앞에 떨어지고 따라가 다시 받는다 (방향키 %s)', (run) => {
  const { match } = simulation(5);
  parkPlayers(match);
  const p = match.teams[0].find((q) => q.slot.label === 'ST')!;
  p.actionLock = 0; p.pos.set(0, 0, 0); p.vel.set(0, 0, 0); p.facing.set(1, 0, 0);
  Object.defineProperty(p, 'profile', { value: { ...p.profile, skill: 5 }, configurable: true });
  match.ball.reset(0.4, 0); match.ball.owner = p; match.controlled = p;
  expect(match.skills.start(p, SKILLS.find((d) => d.id === 'rainbow')!)).toBe(true);
  const cmd = command();
  if (run) cmd.move.set(1, 0, 0);
  let top = 0, landX = NaN;
  for (let t = 0; t < 2.5; t += PHYSICS.step) {
    match.update(PHYSICS.step, cmd);
    const b = match.ball.position;
    top = Math.max(top, b.y);
    if (Number.isNaN(landX) && t > 1 && b.y < 0.15) landX = b.x;
  }
  expect(top).toBeGreaterThan(2.4);
  expect(landX).toBeGreaterThan(1.5);
  expect(landX).toBeLessThan(3.5);
  expect(match.ball.owner).toBe(p);
  expect(match.skillLoft).toBeNull();
});

// 달리다 사포를 쓰면 몸이 그 자리에 급정거하고 공도 제자리에 떨어졌다 (들어온 속도의 20%만 유지)
it.each([[false], [true]])('드리블하다 사포: 몸은 부드럽게 감속하고 공은 달리던 속도로 앞에 떨어져 계속 내 공이다 (질주 %s)', (sprint) => {
  const { match } = simulation(5);
  parkPlayers(match);
  const p = match.teams[0].find((q) => q.slot.label === 'ST')!;
  p.actionLock = 0; p.pos.set(-30, 0, 0); p.facing.set(1, 0, 0);
  Object.defineProperty(p, 'profile', { value: { ...p.profile, skill: 5 }, configurable: true });
  match.ball.reset(-29.6, 0); match.ball.owner = p; match.controlled = p;
  const cmd = command(); cmd.move.set(1, 0, 0); cmd.sprint = sprint;
  for (let t = 0; t < 1.5; t += PHYSICS.step) match.update(PHYSICS.step, cmd);
  const v0 = Math.hypot(p.vel.x, p.vel.z);
  expect(v0).toBeGreaterThan(4);
  const rainbow = SKILLS.find((d) => d.id === 'rainbow')!;
  for (let k = 0; k < 120 && !match.skills.start(p, rainbow); k++) match.update(PHYSICS.step, cmd);
  const x0 = p.pos.x;
  let minEarly = Infinity, landGap = NaN;
  for (let t = 0; t < 3; t += PHYSICS.step) {
    match.update(PHYSICS.step, cmd);
    if (t < 0.1) minEarly = Math.min(minEarly, Math.hypot(p.vel.x, p.vel.z));
    if (Number.isNaN(landGap) && t > 1 && match.ball.position.y < 0.15) landGap = match.ball.position.x - p.pos.x;
  }
  // 0.1초 안에 급정거하지 않는다
  expect(minEarly).toBeGreaterThan(v0 * 0.6);
  // 공은 몸보다 앞에, 따라가 받을 거리(3m 안)에 떨어진다
  expect(landGap).toBeGreaterThan(0.3);
  expect(landGap).toBeLessThan(3);
  expect(match.ball.position.x - x0).toBeGreaterThan(v0 * 1.5);
  expect(match.ball.owner).toBe(p);
});
