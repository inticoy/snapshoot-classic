import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { command, parkPlayers, simulation } from './helpers';

function caught() {
  const { match } = simulation(4);
  parkPlayers(match);
  const k = match.teams[0][0];
  for (const p of match.teams[0]) p.actionLock = 0;
  k.pos.set(-48, 0, 0); k.facing.set(1, 0, 0);
  match.teams[0][5].pos.set(-30, 0, 6);
  match.ball.body.position.set(-47.6, 1.1, 0);
  match.ball.body.velocity.set(0, 0, 0);
  match.gainPossession(k);
  return { match, k };
}

it('사람 팀 키퍼가 손으로 잡으면 키퍼를 직접 조작하고, S로 던지면 동료에게 조작이 넘어간다', () => {
  const { match, k } = caught();
  expect(match.controlled).toBe(k);
  const cmd = command();
  cmd.move.set(1, 0, 0.3);
  cmd.pass = { held: true, pressed: true, released: false };
  match.update(PHYSICS.step, cmd);
  cmd.pass = { held: false, pressed: false, released: true };
  let kicked = false;
  for (let t = 0; t < 1; t += PHYSICS.step) { match.update(PHYSICS.step, cmd); if (match.ball.owner !== k) kicked = true; }
  expect(kicked).toBe(true);
  expect(match.controlled.isKeeper).toBe(false);
});

it('W로 내려놓으면 공이 발 앞 땅에 있고 키퍼가 방향키로 움직인다', () => {
  const { match, k } = caught();
  const cmd = command();
  cmd.through = { held: true, pressed: true, released: false };
  match.update(PHYSICS.step, cmd);
  expect(match.ball.position.y).toBeLessThan(0.3);
  cmd.through = { held: false, pressed: false, released: true };
  cmd.move.set(1, 0, 0);
  const x0 = k.pos.x;
  for (let t = 0; t < 1; t += PHYSICS.step) match.update(PHYSICS.step, cmd);
  expect(k.pos.x - x0).toBeGreaterThan(1.5);
});

it('6초 넘게 들고 있으면 자동으로 배급한다', () => {
  const { match, k } = caught();
  for (let t = 0; t < 7; t += PHYSICS.step) match.update(PHYSICS.step, command());
  expect(match.ball.owner).not.toBe(k);
});
