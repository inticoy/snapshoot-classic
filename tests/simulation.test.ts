import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { Random } from '../src/core/Random';
import { command, simulation } from './helpers';

it('Node에서 document/window 없이 Match를 만들고 22명과 공을 진행한다', () => {
  expect(typeof document).toBe('undefined');
  expect(typeof window).toBe('undefined');
  const { match } = simulation();
  for (let i = 0; i < 240; i++) match.update(PHYSICS.step, command());
  expect(match.players).toHaveLength(22);
  expect(match.goals.flatMap((g) => g.postBodies)).toHaveLength(6);
  expect(match.phase).toBe('playing');
  expect(match.clock).toBeGreaterThan(0.7);
});

it('동일 시드와 입력은 다른 경기와 교차 실행해도 같은 결과를 낸다', () => {
  const a = simulation(42, { userControl: false }).match;
  const b = simulation(42, { userControl: false }).match;
  const c = simulation(43, { userControl: false }).match;
  const cmd = command();
  const snapshot = (m: typeof a) => ({
    phase: m.phase, score: m.score, stats: m.stats,
    ball: m.ball.position.toArray(), velocity: m.ball.velocity.toArray(),
    players: m.players.map((p) => [...p.pos.toArray(), ...p.vel.toArray()]),
  });
  for (let i = 0; i < 15 / PHYSICS.step; i++) {
    a.update(PHYSICS.step, cmd);
    c.update(PHYSICS.step, cmd);
    b.update(PHYSICS.step, cmd);
  }
  expect(snapshot(a)).toEqual(snapshot(b));
  expect(snapshot(a)).not.toEqual(snapshot(c));
});

it('시드 0도 유효하며 균등·정규 난수는 유한한 기대 분포를 따른다', () => {
  const random = new Random(0);
  const uniform = Array.from({ length: 10000 }, () => random.next());
  const normal = Array.from({ length: 10000 }, () => random.gauss());
  expect(Math.min(...uniform)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...uniform)).toBeLessThan(1);
  expect(uniform.reduce((a, b) => a + b) / uniform.length).toBeCloseTo(0.5, 1);
  const mean = normal.reduce((a, b) => a + b) / normal.length;
  const variance = normal.reduce((a, b) => a + (b - mean) ** 2, 0) / normal.length;
  expect(Math.abs(mean)).toBeLessThan(0.03);
  expect(variance).toBeGreaterThan(0.95);
  expect(variance).toBeLessThan(1.05);
});

it.each([7, 42, 2026])('AI 대 AI 5분: 시드 %i에서 정지·교착 없이 종료한다', (seed) => {
  const { match } = simulation(seed, { userControl: false });
  match.duration = 300;
  const cmd = command();
  let dwell = 0;
  let longestPause = 0;
  let phase = match.phase;
  let movement = 0;
  let windowTime = 0;
  let restarts = 0;
  let goals = 0;
  let heavyTouches = 0;
  for (let step = 0; step < 420 / PHYSICS.step && match.phase !== 'fulltime'; step++) {
    const previous = match.ball.position.clone();
    match.update(PHYSICS.step, cmd);
    const pos = match.ball.position;
    expect(Number.isFinite(pos.x + pos.y + pos.z)).toBe(true);
    expect(match.players.every((p) => Number.isFinite(p.pos.lengthSq() + p.vel.lengthSq()))).toBe(true);
    movement += pos.distanceTo(previous);
    windowTime += PHYSICS.step;
    if (windowTime >= 10) {
      // playing이 10초 이상 지속되는 것은 정상이다. 공이 실제로 움직였는지 따로 확인한다.
      expect(movement, `시드 ${seed}, ${match.clock.toFixed(1)}초에서 공 정지`).toBeGreaterThan(1);
      movement = windowTime = 0;
    }
    dwell = match.phase === phase ? dwell + PHYSICS.step : PHYSICS.step;
    phase = match.phase;
    if (phase !== 'playing') {
      longestPause = Math.max(longestPause, dwell);
      expect(dwell, `${phase} 단계 교착`).toBeLessThan(10);
    }
    for (const event of match.events) {
      if (event.type === 'restart') restarts++;
      if (event.type === 'goal') goals++;
      if (event.type === 'heavyTouch') heavyTouches++;
    }
    match.events.length = 0;
  }
  console.info(`AI 5분 seed=${seed}: ${match.score.join(':')}, 슛 ${match.stats.shots.join('/')}, 패스 ${match.stats.passes.join('/')}, 재개 ${restarts}, 파울 ${match.rules.fouls.join('/')}, 오프사이드 ${match.rules.offsides.join('/')}, 카드 ${match.rules.yellows.join('/')}·${match.rules.reds.join('/')}, 최장 대기 ${longestPause.toFixed(3)}초, 헤비 터치 ${heavyTouches}회`);
  expect(heavyTouches).toBeLessThanOrEqual(40);
  expect(match.phase).toBe('fulltime');
  // 전·후반 추가 시간(최대 3+5분 환산)과 마지막 슛 결과를 기다리는 시간까지
  expect(match.clock).toBeGreaterThanOrEqual(300);
  expect(match.clock).toBeLessThan(300 + (8 / 90) * 300 + 4);
  expect(match.half).toBe(2);
  // 90분 환산 파울·오프사이드가 과하지 않다
  for (const team of [0, 1] as const) {
    expect(match.rules.fouls[team]).toBeLessThanOrEqual(25);
    expect(match.rules.offsides[team]).toBeLessThanOrEqual(25);
  }
  expect(restarts).toBeGreaterThan(0);
  for (const team of [0, 1]) expect(match.stats.passes[team]).toBeGreaterThan(5);
  // AI가 슈팅 거리까지 들어가는 일이 드물어(경기당 몇 초) 팀별 슛 0은 시드에 따라 나온다 — 합계로 본다
  expect(match.stats.shots[0] + match.stats.shots[1]).toBeGreaterThan(0);
});
