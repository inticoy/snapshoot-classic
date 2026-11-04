import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PHYSICS, PITCH } from '../src/config';
import type { Match, MatchEvent } from '../src/gameplay/Match';
import { command, parkPlayers, simulation } from './helpers';

/** 사용자 팀(0)이 골문 정면 14m 간접 프리킥을 슛으로 바로 찬다. touched = 찬 뒤 다른 선수가 건드린 것으로 */
function indirectShot(touched: boolean) {
  const { match } = simulation(6);
  parkPlayers(match);
  const a = match.teams[0][0].attackDir;
  match.setPieces.award('indirect', 0, new THREE.Vector3(a * (PITCH.halfL - 14), 0, 0));
  const events: MatchEvent[] = [];
  const step = (cmd = command()) => { match.update(PHYSICS.step, cmd); events.push(...match.events); match.events.length = 0; };
  for (let t = 0; t < 4 && match.phase !== 'setpiece'; t += PHYSICS.step) step();
  expect(match.setPieces.current!.kind).toBe('indirect');
  // 막을 사람이 없게 상대를 모두 치운다
  clearDefenders(match);
  for (let t = 0; t < 0.5; t += PHYSICS.step) step();
  const taker = match.setPieces.current!.taker;
  const hold = command(); hold.shoot = { held: true, pressed: true, released: false };
  step(hold);
  hold.shoot = { held: true, pressed: false, released: false };
  for (let t = 0; t < 0.5; t += PHYSICS.step) step(hold);
  step(command());
  expect(match.phase).toBe('playing');
  if (touched) match.ball.lastTouch = match.teams[1].find((p) => !p.isKeeper)!;
  for (let t = 0; t < 3 && match.phase === 'playing'; t += PHYSICS.step) { clearDefenders(match); step(); }
  return { match, events, taker };
}
function clearDefenders(m: Match) {
  m.teams[1].forEach((p, i) => { p.pos.set(-m.teams[0][0].attackDir * 40, 0, -20 + i * 3); p.vel.set(0, 0, 0); p.actionLock = 60; });
}

it('간접 프리킥은 슛을 찰 수 있지만, 아무도 건드리지 않고 들어가면 골이 아니라 상대 골킥이다', () => {
  const { match, events } = indirectShot(false);
  expect(match.score).toEqual([0, 0]);
  expect(events.some((e) => e.type === 'noGoal')).toBe(true);
  expect(events.some((e) => e.type === 'out' && e.kind === 'goalkick' && e.team === 1)).toBe(true);
});

it('찬 뒤 다른 선수가 건드리고 들어가면 골이다', () => {
  const { match, events } = indirectShot(true);
  expect(events.some((e) => e.type === 'noGoal')).toBe(false);
  expect(match.phase).toBe('goal');
  // 마지막 터치가 상대 선수면 자책골로 기록된다
  expect(match.score[0]).toBe(1);
});
