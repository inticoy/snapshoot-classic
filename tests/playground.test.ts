import { afterEach, describe, expect, it } from 'vitest';
import { DRIBBLE, PHYSICS } from '../src/config';
import { MOTION_SELECT } from '../src/anim/MotionLibrary';
import { PLAYGROUND_SCENARIOS } from '../src/data/Playground';
import { PlaygroundScenarios } from '../src/playground/Scenarios';
import { parameterSnapshot, setParameter } from '../src/playground/Parameters';
import { directionAngle, initialTelemetry, recentHistory, recordsToCsv, updateTelemetry, type TelemetrySample } from '../src/playground/Telemetry';
import { command, simulation } from './helpers';

const sample = (overrides: Partial<TelemetrySample> = {}): TelemetrySample => ({
  time: 0.1, dt: 0.1, controlled: '0:9', input: [1, 0], playerVelocity: [3, 0, 4], facing: [1, 0],
  ballVelocity: [4, 0, 0], footDistance: 0.7, owned: true, intentionalKick: false,
  touches: 0, heavyTouches: 0, motionId: null, hipsHeight: 0.95, ...overrides,
});

describe('플레이그라운드 순수 텔레메트리', () => {
  it('속도·거리·각도와 동작·엉덩이 높이를 계산한다', () => {
    const { metrics } = updateTelemetry(initialTelemetry(), sample({ facing: [0, 1], motionId: 'slide', hipsHeight: 0.2 }));
    expect(metrics).toMatchObject({ playerSpeed: 5, ballSpeed: 4, footDistance: 0.7, bodyInputAngle: 90, ballInputAngle: 0, motionId: 'slide', hipsHeight: 0.2 });
  });

  it('방향각은 크기에 독립적이며 ±180° 경계를 연속으로 취급한다', () => {
    expect(directionAngle([0, 5], [5, 0])).toBeCloseTo(90);
    expect(directionAngle([-1, 0.001], [-1, -0.001])).toBeLessThan(0.12);
    expect(directionAngle([1, 0], [-1, 0])).toBe(180);
  });

  it('입력 없음·정지 공에는 각도를 만들지 않는다', () => {
    expect(updateTelemetry(initialTelemetry(), sample({ input: [0, 0] })).metrics.bodyInputAngle).toBeNull();
    const { metrics } = updateTelemetry(initialTelemetry(), sample({ ballVelocity: [0, 3, 0] }));
    expect(metrics.ballInputAngle).toBeNull();
    expect(directionAngle([0, 0], [1, 0])).toBeNull();
  });

  it('90° 전환은 입력이 바뀐 스텝 시작부터 공이 ±30° 안에 들어올 때까지 잰다', () => {
    const a = updateTelemetry(initialTelemetry(), sample());
    const b = updateTelemetry(a.state, sample({ time: 0.2, input: [0, 1] }));
    expect(b.metrics.turnPending).toBe(true);
    expect(b.metrics.lastTurnSeconds).toBeNull();
    const c = updateTelemetry(b.state, sample({ time: 0.3, input: [0, 1], ballVelocity: [1, 0, 2] }));
    expect(c.metrics.lastTurnSeconds).toBeCloseTo(0.2);
    expect(c.metrics.turnPending).toBe(false);
  });

  it('180° 전환과 같은 스텝 완료도 측정하며 정지 공을 완료로 보지 않는다', () => {
    const a = updateTelemetry(initialTelemetry(), sample());
    const b = updateTelemetry(a.state, sample({ time: 0.2, input: [-1, 0], ballVelocity: [0, 0, 0] }));
    expect(b.metrics.turnPending).toBe(true);
    const c = updateTelemetry(b.state, sample({ time: 0.3, input: [-1, 0], ballVelocity: [-3, 0, 0] }));
    expect(c.metrics.lastTurnSeconds).toBeCloseTo(0.2);
    const instant = updateTelemetry(a.state, sample({ time: 0.2, input: [0, 1], ballVelocity: [0, 0, 2] }));
    expect(instant.metrics.lastTurnSeconds).toBeCloseTo(0.1);
  });

  it('입력 중단·선수 변경은 미완료 전환을 취소한다', () => {
    const a = updateTelemetry(initialTelemetry(), sample());
    const b = updateTelemetry(a.state, sample({ time: 0.2, input: [0, 1] }));
    for (const next of [sample({ time: 0.3, input: [0, 0] }), sample({ time: 0.3, controlled: '0:8', input: [0, 1] })]) {
      expect(updateTelemetry(b.state, next).metrics.turnPending).toBe(false);
    }
  });

  it('작은 아날로그 변경의 누적을 포착하고 더 최신 입력으로 다시 측정한다', () => {
    const dir = (d: number): [number, number] => [Math.cos(d * Math.PI / 180), Math.sin(d * Math.PI / 180)];
    let { state } = updateTelemetry(initialTelemetry(), sample());
    state = updateTelemetry(state, sample({ time: 0.2, input: dir(20) })).state;
    expect(state.turnStarted).toBeNull();
    state = updateTelemetry(state, sample({ time: 0.3, input: dir(40) })).state;
    expect(state.turnStarted).toBeCloseTo(0.2);
    state = updateTelemetry(state, sample({ time: 0.4, input: dir(100) })).state;
    expect(state.turnStarted).toBeCloseTo(0.3);
  });

  it('매 스텝 터치를 중복 없이 최근 1초 창으로 집계한다', () => {
    const a = updateTelemetry(initialTelemetry(), sample({ touches: 2 }));
    const b = updateTelemetry(a.state, sample({ time: 0.5, touches: 1 }));
    expect(b.metrics.touchesPerSecond).toBe(3);
    const c = updateTelemetry(b.state, sample({ time: 1.1 }));
    expect(c.metrics.touchesPerSecond).toBe(1);
    expect(a.state.touchTimes).toEqual([0.1, 0.1]);
  });

  it('헤비 터치·소유 상실은 사건당 한 번이고 슛·패스는 제외한다', () => {
    const a = updateTelemetry(initialTelemetry(), sample());
    const b = updateTelemetry(a.state, sample({ time: 0.2, owned: false, heavyTouches: 1 }));
    const c = updateTelemetry(b.state, sample({ time: 0.3, owned: false }));
    expect(c.metrics).toMatchObject({ losses: 1, heavyTouches: 1 });
    expect(updateTelemetry(a.state, sample({ time: 0.2, owned: false, intentionalKick: true })).metrics.losses).toBe(0);
    expect(updateTelemetry(a.state, sample({ time: 0.2, owned: false, controlled: '0:8' })).metrics.losses).toBe(0);
  });

  it('최근 그래프는 시뮬레이션 5초만 유지한다', () => {
    const rows = [{ time: 1 }, { time: 1.9 }, { time: 2 }, { time: 7 }];
    expect(recentHistory(rows, 7)).toEqual([{ time: 2 }, { time: 7 }]);
    expect(rows).toHaveLength(4);
  });

  it('CSV는 입력·중첩 상태·따옴표·줄바꿈과 열의 합집합을 보존한다', () => {
    expect(recordsToCsv([])).toBe('');
    const csv = recordsToCsv([{ time: 1, input: { move: [1, 0] }, note: 'a,"b"\nc' }, { time: 2, state: { owner: null } }]);
    expect(csv).toContain('"time","input","note","state"\r\n');
    expect(csv).not.toContain('\\r\\n');
    expect(csv).toContain('"{""move"":[1,0]}"');
    expect(csv).toContain('"a,""b""\nc"');
    expect(csv).toContain('"{""owner"":null}"');
  });
});

const original = parameterSnapshot();
afterEach(() => {
  Object.assign(DRIBBLE, original.DRIBBLE);
  Object.assign(MOTION_SELECT, original.MOTION_SELECT);
});

it('파라미터는 즉시 바뀌고 범위·회전 한계 순서·과거 스냅샷을 보존한다', () => {
  const before = parameterSnapshot();
  setParameter('leadWalk', 0.6);
  expect(DRIBBLE.leadWalk).toBe(0.6);
  expect(before.DRIBBLE.leadWalk).toBe(original.DRIBBLE.leadWalk);
  setParameter('windup', 0.25);
  expect(MOTION_SELECT.windup).toBe(0.25);
  setParameter('touchPeriod', 0);
  expect(DRIBBLE.touchPeriod).toBe(0.1);
  setParameter('turnMin', 3);
  expect(DRIBBLE.turnMax).toBeGreaterThanOrEqual(DRIBBLE.turnMin);
  setParameter('turnMax', 1);
  expect(DRIBBLE.turnMin).toBeLessThanOrEqual(DRIBBLE.turnMax);
  setParameter('reach', NaN);
  expect(DRIBBLE.reach).toBe(original.DRIBBLE.reach);
});

describe('실제 Match로 시나리오 검증', () => {
  for (const scenario of PLAYGROUND_SCENARIOS) {
    it(`${scenario.label}: 인원 격리·유한 상태·R 리셋`, () => {
      const { match } = simulation(318, { practice: true, kickMotion: true });
      const scenarios = new PlaygroundScenarios(match);
      scenarios.reset(scenario.id);
      const count = { free: 1, duel: 2, pressure: 4, receive: 2, slide: 2, keeper: 2, passing: 2, commands: 3, cross: 3, contact: 2, clearance: 2 }[scenario.id];
      expect(match.players).toHaveLength(count);
      expect(match.teams.flat()).toHaveLength(count);
      const active = new Set(match.players);
      const cmd = command();
      cmd.move.set(1, 0, 0);
      const start = match.controlled.pos.clone();
      for (let i = 0; i < 4 / PHYSICS.step; i++) {
        match.update(PHYSICS.step, cmd);
        for (const p of match.players) expect(p.pos.toArray().every(Number.isFinite)).toBe(true);
        expect(match.ball.position.toArray().every(Number.isFinite)).toBe(true);
        match.events.length = 0;
      }
      scenarios.reset();
      expect(match.controlled.pos.toArray()).toEqual(start.toArray());
      expect(match.elapsed).toBe(0);
      expect(match.events).toHaveLength(0);
      expect(new Set(match.players)).toEqual(active);
      expect(match.players.every((p) => p.tackleCooldown === 0 && p.tackleTimer === 0)).toBe(true);
      expect(match.controlled.facingLock).toBe(0);
      // 받기 시나리오는 초기화 직후 동료가 새 패스 동작에 들어가므로 그 facingLock은 정상이다.
      expect(match.players.some((p) => match.kicking(p))).toBe(scenario.id === 'receive');
      expect(match.score).toEqual([0, 0]);
      expect(match.rules.fouls).toEqual([0, 0]);
      expect(match.players.filter((p) => p.isKeeper)).toHaveLength(scenario.id === 'keeper' ? 1 : 0);
    });
  }

  it('15m 동료 패스를 실제 킥·받기·첫 드리블 경로로 받는다', () => {
    const { match } = simulation(318, { practice: true, kickMotion: true });
    new PlaygroundScenarios(match).reset('receive');
    const p = match.controlled;
    expect(p.pos.distanceTo(match.ball.owner!.pos)).toBe(15);
    const cmd = command();
    let received = false;
    for (let i = 0; i < 5 / PHYSICS.step; i++) {
      match.update(PHYSICS.step, cmd);
      if (match.ball.owner === p) { received = true; break; }
      match.events.length = 0;
    }
    expect(match.stats.passes[0]).toBe(1);
    expect(received).toBe(true);
    const start = p.pos.x;
    cmd.move.set(1, 0, 0);
    for (let i = 0; i < 1 / PHYSICS.step; i++) match.update(PHYSICS.step, cmd);
    expect(p.pos.x - start).toBeGreaterThan(2);
    expect(match.ball.owner).toBe(p);
  });

  it('빈 경기장 아웃과 자책골에서도 없는 상대의 재개 인원을 찾지 않는다', () => {
    for (const goal of [false, true]) {
      const { match } = simulation(318, { practice: true });
      new PlaygroundScenarios(match).reset('free');
      match.ball.owner = null;
      match.ball.body.position.set(goal ? -53 : 0, 0.11, goal ? 0 : 36);
      expect(() => {
        for (let i = 0; i < 30; i++) match.update(PHYSICS.step, command());
      }).not.toThrow();
      expect(['out', 'goal']).toContain(match.phase);
    }
  });

  it('reach 슬라이더 상한에서도 멀어진 공을 반대 방향으로 쫓지 않는다', () => {
    const { match } = simulation(318, { practice: true });
    new PlaygroundScenarios(match).reset('free');
    setParameter('reach', 1.5);
    match.ball.body.position.set(-17, 0.11, 0);
    const move = command().move.set(0, 0, -1);
    match.guideDribble(match.controlled, move);
    expect(move.toArray().every(Number.isFinite)).toBe(true);
    expect(move.x).toBeGreaterThan(0);
    expect(move.length()).toBeCloseTo(1);
  });

  it('키퍼가 잡은 뒤 받을 동료가 없어도 안전하게 공을 보유한다', () => {
    const { match } = simulation(318, { practice: true, kickMotion: true });
    new PlaygroundScenarios(match).reset('keeper');
    const keeper = match.players.find((p) => p.isKeeper)!;
    match.ball.body.position.set(keeper.pos.x, 0.6, keeper.pos.z);
    match.gainPossession(keeper);
    expect(() => {
      for (let i = 0; i < 5 / PHYSICS.step; i++) match.update(PHYSICS.step, command());
    }).not.toThrow();
    expect(match.ball.owner).toBe(keeper);
    expect(match.ball.position.toArray().every(Number.isFinite)).toBe(true);
  });

  it('리셋은 같은 AI·난수·터치 상태로 같은 입력 결과를 만든다', () => {
    const { match } = simulation(318, { practice: true });
    const scenarios = new PlaygroundScenarios(match);
    const run = () => {
      scenarios.reset('pressure');
      const cmd = command();
      cmd.move.set(1, 0, 0);
      for (let i = 0; i < 120; i++) { match.update(PHYSICS.step, cmd); match.events.length = 0; }
      return { players: match.players.map((p) => p.pos.toArray()), ball: match.ball.position.toArray(), velocity: match.ball.velocity.toArray() };
    };
    expect(run()).toEqual(run());
  });
});
