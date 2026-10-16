import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { command, parkPlayers, simulation } from './helpers';
function chips(dist: number, depth: number, charge: number) {
  let goals = 0;
  for (let seed = 0; seed < 60; seed++) {
    const { match } = simulation(seed); parkPlayers(match);
    const striker = match.forward(0), keeper = match.teams[1][0];
    const a = striker.attackDir, gx = match.oppGoalX(0);
    striker.actionLock = keeper.actionLock = 0;
    striker.pos.set(gx - a * dist, 0, (seed % 7 - 3) * 1.2); striker.facing.set(a, 0, 0);
    keeper.pos.set(gx - a * depth, 0, 0); keeper.facing.set(-a, 0, 0);
    match.controlled = striker; match.ball.reset(striker.pos.x + a * 0.5, striker.pos.z); match.ball.owner = match.ball.lastTouch = striker;
    match.chipShot(striker, charge, new THREE.Vector3(a, 0, 0));
    striker.actionLock = 60;
    for (let t = 0; t < 5 / PHYSICS.step && match.phase === 'playing'; t++) { match.update(PHYSICS.step, command()); match.events.length = 0; if (match.ball.owner === keeper) break; }
    if (match.score[0]) goals++;
  }
  return Math.round(goals / 60 * 100);
}
it('앞으로 나온 키퍼를 넘기는 칩슛: 12m·6m 전진에서 15~65% (예전 97%), 골문 키퍼는 거의 막는다', () => {
  const adv = chips(12, 6, 0.5), line = chips(18, 0.8, 0.5);
  expect(adv).toBeGreaterThanOrEqual(15); expect(adv).toBeLessThanOrEqual(65); expect(line).toBeLessThan(15);
}, 300000);
