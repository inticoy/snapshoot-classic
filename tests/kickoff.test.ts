import { expect, it } from 'vitest';
import { PHYSICS, PITCH } from '../src/config';
import { command, simulation } from './helpers';

it('킥오프: 첫 패스 전에는 드리블 못 하고 상대는 서클 밖, S로 옆 선수에게 패스하면 시작', () => {
  const { match } = simulation(3, { kickoffPass: true });
  match.startKickoff(0);
  const taker = match.forward(0);
  const cmd = command();
  cmd.move.set(1, 0, 0);
  for (let t = 0; t < 3; t += PHYSICS.step) match.update(PHYSICS.step, cmd);
  expect(match.phase).toBe('playing');
  expect(taker.pos.length()).toBeLessThan(1.2);
  expect(match.ball.owner).toBe(taker);
  for (const p of match.teams[1]) expect(Math.hypot(p.pos.x, p.pos.z)).toBeGreaterThanOrEqual(PITCH.centerCircle);
  cmd.move.set(0, 0, 1);
  cmd.pass = { held: true, pressed: true, released: false };
  match.update(PHYSICS.step, cmd);
  cmd.pass = { held: false, pressed: false, released: true };
  for (let t = 0; t < 1; t += PHYSICS.step) { match.update(PHYSICS.step, cmd); cmd.pass = { held: false, pressed: false, released: false }; }
  expect(match.kickoffTaker).toBeNull();
  expect(match.stats.passes[0]).toBe(1);
});

it('AI 킥오프는 옆 선수에게 패스로 시작한다', () => {
  const { match } = simulation(3, { kickoffPass: true, userControl: false });
  match.startKickoff(1);
  for (let t = 0; t < 3; t += PHYSICS.step) match.update(PHYSICS.step, command());
  expect(match.kickoffTaker).toBeNull();
  expect(match.stats.passes[1]).toBeGreaterThanOrEqual(1);
});
