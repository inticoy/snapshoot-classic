import { expect, it } from 'vitest';
import { GOAL, PHYSICS } from '../src/config';
import { CrowdMood, crowdTarget } from '../src/audio/CrowdMood';
import { parkPlayers, simulation } from './helpers';

function carrierAt(team: 0 | 1, distanceToGoal: number) {
  const { match } = simulation(1, { userControl: false });
  parkPlayers(match);
  const p = match.teams[team].find((q) => q.slot.label === 'ST')!;
  const gx = match.oppGoalX(team);
  p.pos.set(gx - Math.sign(gx) * distanceToGoal, 0, 0);
  match.ball.reset(p.pos.x, 0); match.ball.owner = p;
  return match;
}

it('공격이 상대 골문에 다가갈수록 함성이 커지고, 홈팀 공격이 원정보다 크다', () => {
  const far = crowdTarget(carrierAt(0, 60)), mid = crowdTarget(carrierAt(0, 25)), box = crowdTarget(carrierAt(0, 10));
  expect(far).toBe(0);
  expect(mid).toBeGreaterThan(0.2);
  expect(box).toBe(1);
  expect(crowdTarget(carrierAt(1, 10))).toBeLessThan(box);
});

it('골이면 최고조를 몇 초 유지하고, 올라갈 때는 빠르게·내려갈 때는 천천히', () => {
  const m = carrierAt(0, 60);
  const mood = new CrowdMood();
  m.phase = 'goal';
  for (let t = 0; t < 1; t += 1 / 60) mood.update(1 / 60, m);
  expect(mood.level).toBeGreaterThan(0.9);
  m.phase = 'playing';
  for (let t = 0; t < 3; t += 1 / 60) mood.update(1 / 60, m);
  expect(mood.level).toBeGreaterThan(0.95); // 골 뒤 4초 유지
  for (let t = 0; t < 3; t += 1 / 60) mood.update(1 / 60, m);
  expect(mood.level).toBeLessThan(0.6);
});

it('골문 옆으로 아깝게 빗나간 슛에 탄성(ooh), 멀리 빗나간 슛은 조용하다', () => {
  for (const [z, expected] of [[GOAL.width / 2 + 1, true], [20, false]] as const) {
    const { match } = simulation(1, { userControl: false });
    parkPlayers(match);
    match.phase = 'playing';
    const shooter = match.teams[0].find((q) => q.slot.label === 'ST')!;
    const gx = match.oppGoalX(0);
    match.ball.reset(gx - Math.sign(gx) * 5, z);
    match.ball.shot = { id: 1, by: shooter, saveRolled: true };
    match.ball.lastTouch = shooter;
    match.ball.body.velocity.set(Math.sign(gx) * 20, 0, 0);
    const mood = new CrowdMood();
    let ooh = false;
    for (let t = 0; t < 1.5; t += PHYSICS.step) {
      match.update(PHYSICS.step, null as never);
      match.events.length = 0;
      ooh ||= mood.update(PHYSICS.step, match);
    }
    expect(match.score).toEqual([0, 0]);
    expect(ooh, `z=${z}`).toBe(expected);
  }
});
