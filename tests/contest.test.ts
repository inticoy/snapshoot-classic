import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { command, simulation } from './helpers';

it('공을 끼고 가만히 서 있으면 붙은 상대가 몸싸움으로 빼앗는다 (태클 운에만 맡기지 않는다)', () => {
  const { match } = simulation(3);
  match.restart();
  const cmd = command();
  for (let t = 0; t < 3; t += PHYSICS.step) match.update(PHYSICS.step, cmd);
  const p = match.local.controlled;
  // 터치라인 근처면 태클에 공이 밖으로 나가 버리므로 경기장 가운데에서
  p.pos.set(-15, 0, 0); p.facing.set(1, 0, 0); p.vel.set(0, 0, 0);
  match.ball.reset(p.pos.x + 0.4, p.pos.z);
  match.ball.owner = p;
  let lost = Infinity;
  for (let t = 0; t < 6 && lost === Infinity; t += PHYSICS.step) {
    match.update(PHYSICS.step, cmd);
    if (match.ball.owner?.team === 1 || match.ball.lastTouch?.team === 1) lost = t;
  }
  expect(lost).toBeLessThan(5);
});

it('공이 오는 중에 넣은 개인기 커맨드는 공을 잡자마자 나간다', () => {
  const { match } = simulation(4);
  match.restart();
  const cmd = command();
  for (let t = 0; t < 2; t += PHYSICS.step) match.update(PHYSICS.step, cmd);
  const p = match.local.controlled;
  p.pos.set(-15, 0, 0); p.facing.set(1, 0, 0); p.vel.set(0, 0, 0);
  Object.defineProperty(p, 'profile', { value: { ...p.profile, skill: 5 }, configurable: true });
  match.ball.owner = null;
  match.ball.reset(-5, 0);
  match.ball.body.velocity.set(-9, 0, 0);
  match.passTarget = p;
  match.ball.lastTouch = match.teams[0].find((q) => q !== p && !q.isKeeper)!;
  const ids: string[] = [];
  // 공이 오는 동안 Shift + → 짧게 (속임 동작)
  const frames: [boolean, number][] = [[true, 0], [true, 1], [true, 0], [false, 0]];
  for (const [shift, right] of frames) for (let i = 0; i < 8; i++) {
    cmd.skill = { held: shift, pressed: shift && i === 0, released: !shift && i === 0 };
    cmd.skillMove = cmd.move.clone().set(0, 0, right);
    match.update(PHYSICS.step, cmd);
    for (const e of match.events) if (e.type === 'skill') ids.push(e.id);
    match.events.length = 0;
  }
  expect(match.ball.owner).not.toBe(p);
  cmd.skill = { held: false, pressed: false, released: false };
  for (let t = 0; t < 1.2; t += PHYSICS.step) {
    match.update(PHYSICS.step, cmd);
    for (const e of match.events) if (e.type === 'skill') ids.push(e.id);
    match.events.length = 0;
  }
  expect(ids).toContain('feint_r');
});

it('Q 짧게 = 동료 침투: 앞쪽 동료가 뛰어 나가되 끝까지 가지 않고 멈춘다', () => {
  const { match } = simulation(5);
  match.restart();
  const cmd = command();
  for (let t = 0; t < 2; t += PHYSICS.step) match.update(PHYSICS.step, cmd);
  const p = match.local.controlled;
  match.ball.reset(p.pos.x + 0.4, p.pos.z);
  match.ball.owner = p;
  cmd.modifier = { held: true, pressed: true, released: false };
  match.update(PHYSICS.step, cmd);
  cmd.modifier = { held: false, pressed: false, released: true };
  match.update(PHYSICS.step, cmd);
  cmd.modifier = { held: false, pressed: false, released: false };
  const [runner] = [...match.runs.keys()];
  expect(runner).toBeDefined();
  const a = runner.attackDir, x0 = runner.pos.x * a;
  for (let t = 0; t < 4; t += PHYSICS.step) match.update(PHYSICS.step, cmd);
  const gained = runner.pos.x * a - x0;
  expect(gained).toBeGreaterThan(5);
  expect(gained).toBeLessThan(20);
  expect(match.runs.has(runner)).toBe(false);
});
