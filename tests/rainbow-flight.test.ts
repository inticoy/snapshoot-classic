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
