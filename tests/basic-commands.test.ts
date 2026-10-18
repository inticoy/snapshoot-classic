import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { command, parkPlayers, simulation } from './helpers';

const btn = (held: boolean, pressed = false, released = false) => ({ held, pressed, released });

function carrier() {
  const { match } = simulation(5);
  parkPlayers(match);
  const p = match.teams[0].find((q) => q.slot.label === 'ST')!;
  p.actionLock = 0; p.pos.set(0, 0, 0); p.facing.set(1, 0, 0);
  match.ball.reset(0.4, 0); match.ball.owner = p; match.controlled = p;
  return { match, p };
}

function sprintGap(knock: boolean) {
  const { match, p } = carrier();
  const cmd = command();
  cmd.move.set(1, 0, 0); cmd.sprint = true;
  for (let t = 0; t < 1; t += PHYSICS.step) match.update(PHYSICS.step, cmd);
  if (knock) { cmd.skill = btn(true, true); cmd.skillMove = new THREE.Vector3(); }
  match.update(PHYSICS.step, cmd);
  if (knock) cmd.skill = btn(false, false, true);
  match.update(PHYSICS.step, cmd);
  cmd.skill = btn(false);
  let maxGap = 0;
  for (let t = 0; t < 1.5; t += PHYSICS.step) { match.update(PHYSICS.step, cmd); maxGap = Math.max(maxGap, match.ball.position.x - p.pos.x); }
  return { maxGap, owned: match.ball.owner === p };
}

it('Shift 짧게 = 짧은 녹온(EE보다 짧다): 그냥 질주보다 공을 2m 이상 더 길게 치고 소유를 유지한다', () => {
  const plain = sprintGap(false), knock = sprintGap(true);
  expect(knock.maxGap).toBeGreaterThan(plain.maxGap + 2);
  expect(knock.owned).toBe(true);
});

it('E 두 번 = 짧은 녹온', () => {
  const { match, p } = carrier();
  const cmd = command();
  cmd.move.set(1, 0, 0);
  for (let t = 0; t < 0.6; t += PHYSICS.step) match.update(PHYSICS.step, cmd);
  let maxGap = 0;
  const seq = [true, false, true, true];
  for (const s of seq) for (let i = 0; i < 6; i++) { cmd.sprint = s; match.update(PHYSICS.step, cmd); }
  cmd.sprint = true;
  for (let t = 0; t < 1; t += PHYSICS.step) { match.update(PHYSICS.step, cmd); maxGap = Math.max(maxGap, match.ball.position.x - p.pos.x); }
  expect(maxGap).toBeGreaterThan(1.5);
  expect(match.ball.owner).toBe(p);
});

it('수비 Shift + 방향 = 그 방향 동료로 전환', () => {
  const { match } = simulation(5);
  parkPlayers(match);
  const me = match.teams[0][5], up = match.teams[0][6], down = match.teams[0][7];
  for (const q of [me, up, down]) q.actionLock = 0;
  me.pos.set(0, 0, 0); up.pos.set(0, 0, -10); down.pos.set(0, 0, 10);
  const opp = match.teams[1][9];
  opp.pos.set(20, 0, 0); match.ball.reset(20.4, 0); match.ball.owner = opp;
  match.controlled = me;
  const cmd = command();
  cmd.skill = btn(true, true); cmd.skillMove = new THREE.Vector3(0, 0, 1);
  match.update(PHYSICS.step, cmd);
  expect(match.controlled).toBe(down);
});

it('C 유지 = 볼 지키기: 느려지고 가까운 상대에게 등을 돌린다', () => {
  const { match, p } = carrier();
  const opp = match.teams[1][9];
  opp.actionLock = 0; opp.pos.set(1.5, 0, 0);
  const cmd = command();
  cmd.move.set(0, 0, 1); cmd.contain = btn(true, true);
  for (let t = 0; t < 1; t += PHYSICS.step) { match.update(PHYSICS.step, cmd); opp.pos.set(p.pos.x + 1.5, 0, p.pos.z); }
  expect(p.shielding).toBe(true);
  expect(Math.hypot(p.vel.x, p.vel.z)).toBeLessThan(p.maxSpeed(true) * 0.6);
  expect(p.facing.x).toBeLessThan(-0.5);
});
