import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BALL, GOAL, PHYSICS, PITCH } from '../src/config';
import { settings, type AssistLevel, type MoveAssist } from '../src/core/Settings';
import { setActivePhysics } from '../src/physics/presets';
import { command, parkPlayers, simulation } from './helpers';

const defaults = { ...settings };
afterEach(() => { Object.assign(settings, defaults); setActivePhysics('arcade'); });

function passTrials(assist: AssistLevel, moving: boolean, moveAssist: MoveAssist = 'high'): number {
  settings.passAssist = assist;
  settings.moveAssist = moveAssist;
  let successes = 0;
  for (let seed = 0; seed < 100; seed++) {
    const { match } = simulation(seed);
    parkPlayers(match);
    const passer = match.forward(0);
    const receiver = match.teams[0].find((p) => p.slot.label === 'CM')!;
    passer.actionLock = receiver.actionLock = 0;
    passer.pos.set(-6, 0, 0);
    receiver.pos.set(6, 0, 0);
    passer.facing.set(1, 0, 0);
    receiver.facing.set(-1, 0, 0);
    match.controlled = passer;
    match.ball.reset(-5.65, 0);
    match.ball.owner = passer;
    // 보조 입력은 동료 방향에서 45° 벗어나고, 수동은 11.65m에 맞는 방향/게이지다.
    const aim = new THREE.Vector3(1, 0, assist === 'assisted' ? 1 : 0).normalize();
    match.pass(passer, aim, 'short', assist === 'manual' ? (11.65 - 6) / 26 : 0.5);
    expect(match.passTarget).toBe(receiver);
    const cmd = command();
    for (let i = 0; i < 4 / PHYSICS.step; i++) {
      if (moving) cmd.move.set(match.ball.position.x - receiver.pos.x, 0, match.ball.position.z - receiver.pos.z).normalize();
      match.update(PHYSICS.step, cmd);
      if (match.ball.owner) break;
    }
    if (match.ball.owner === receiver && match.stats.passesDone[0] === 1) successes++;
  }
  return successes;
}

describe('패스와 방향 입력 중 받기', () => {
  it('보조: 입력이 45° 어긋나도 100회 중 90회 이상 동료가 소유한다', () => {
    const count = passTrials('assisted', false);
    console.info(`보조 45° 패스: ${count}/100`);
    expect(count).toBeGreaterThanOrEqual(90);
  });
  it('수동: 정확한 방향과 세기로 100회 중 90회 이상 도달한다', () => {
    const count = passTrials('manual', false);
    console.info(`수동 패스: ${count}/100`);
    expect(count).toBeGreaterThanOrEqual(90);
  });
  it('세미: 동료를 향한 입력과 중간 게이지로 90% 이상 도달한다', () => {
    const count = passTrials('semi', false);
    console.info(`세미 패스: ${count}/100`);
    expect(count).toBeGreaterThanOrEqual(90);
  });
  it.each(['semi', 'manual'] as const)('%s: 보정 범위 밖 45° 입력은 동료에게 강제로 꺾지 않는다', (assist) => {
    const { match } = simulation(10);
    parkPlayers(match);
    const passer = match.forward(0);
    passer.pos.set(-6, 0, 0);
    passer.facing.set(1, 0, 0);
    match.teams[0].find((p) => p.slot.label === 'CM')!.pos.set(6, 0, 0);
    match.ball.reset(-5.65, 0);
    const r = match.kicks.pass(passer, new THREE.Vector3(1, 0, 1).normalize(), 'short', (11.65 - 6) / 26, assist);
    expect(r.receiver).toBeNull();
    const angle = Math.atan2(r.vel.z, r.vel.x) * 180 / Math.PI;
    expect(angle).toBeGreaterThan(40);
    expect(angle).toBeLessThan(50);
  });
  it.each(['none', 'low', 'high'] as const)('이동 보조 %s: 계속 공 쪽으로 입력해도 90%% 이상 받는다', (moveAssist) => {
    const count = passTrials('assisted', true, moveAssist);
    console.info(`방향 입력 중 받기 (${moveAssist}): ${count}/100`);
    expect(count).toBeGreaterThanOrEqual(90);
  });
});

it('골 결정력이 높은 공격수가 수비수보다 실제 궤적의 유효슈팅 비율이 높다', () => {
  const attempts = 400;
  const rates: number[] = [];
  for (const role of ['FWD', 'DEF'] as const) {
    const { match, physics } = simulation(194);
    parkPlayers(match);
    const shooter = role === 'FWD' ? match.forward(0) : match.teams[0].find((p) => p.slot.label === 'LCB')!;
    shooter.pos.set(PITCH.halfL - 9, 0, 0);
    shooter.facing.set(1, 0, 0);
    let hits = 0;
    for (let i = 0; i < attempts; i++) {
      match.ball.reset(PITCH.halfL - 8.65, 0);
      const r = match.kicks.shot(shooter, 0.75, false, new THREE.Vector3(1, 0, 0.29), 'assisted');
      match.ball.kick(r.vel, r.spin, shooter);
      for (let step = 0; step < 2 / PHYSICS.step; step++) {
        const before = match.ball.position.clone();
        physics.step(PHYSICS.step);
        const after = match.ball.position;
        // 골라인을 지나는 순간을 보간해 실제 공 전체가 골문 안에 드는지 측정한다.
        if (after.x >= PITCH.halfL) {
          const t = (PITCH.halfL - before.x) / (after.x - before.x);
          const y = before.y + (after.y - before.y) * t;
          const z = before.z + (after.z - before.z) * t;
          if (y + BALL.radius < GOAL.height && Math.abs(z) + BALL.radius < GOAL.width / 2) hits++;
          break;
        }
        if (match.ball.velocity.x < 0) break;
      }
    }
    console.info(`${role} 유효슈팅: ${hits}/${attempts}`);
    rates.push(hits / attempts);
  }
  expect(rates[0]).toBeGreaterThanOrEqual(0.65);
  expect(rates[1]).toBeGreaterThanOrEqual(0.3);
  expect(rates[0] - rates[1]).toBeGreaterThan(0.05);
});

describe('양쪽 진영의 세트피스 판정과 AI 재개', () => {
  for (const side of [-1, 1] as const) {
    it.each(['throwin', 'corner', 'goalkick'] as const)(`${side} 방향 %s 판정 후 4초 안에 재개`, (kind) => {
      const { match } = simulation(12, { userControl: false });
      parkPlayers(match);
      const defender = side > 0 ? 1 : 0;
      const lastTeam = kind === 'corner' ? defender : 1 - defender;
      match.ball.lastTouch = match.teams[lastTeam][1];
      if (kind === 'throwin') match.ball.position.set(3, BALL.radius, side * (PITCH.halfW + BALL.radius + 0.01));
      else match.ball.position.set(side * (PITCH.halfL + BALL.radius + 0.01), BALL.radius, 8);
      match.update(PHYSICS.step, command());
      const expectedTeam = kind === 'goalkick' ? defender : 1 - lastTeam;
      expect(match.phase).toBe('out');
      expect(match.setPieces.current).toMatchObject({ kind, team: expectedTeam });
      let resumed = false;
      for (let i = 0; i < 4 / PHYSICS.step; i++) {
        match.update(PHYSICS.step, command());
        if (match.phase === 'playing') { resumed = true; break; }
      }
      expect(resumed).toBe(true);
      expect(match.setPieces.current).toBeNull();
      expect(match.ball.speed()).toBeGreaterThan(3);
      expect(match.ball.lastTouch?.kickCooldown).toBeGreaterThan(0.7);
      expect(match.events.some((e) => e.type === 'restart' && e.kind === kind)).toBe(true);
    });
  }
  it('공 전체가 터치라인을 넘기 전에는 아웃이 아니다', () => {
    const { match } = simulation();
    match.ball.owner = null;
    match.ball.position.set(0, BALL.radius, PITCH.halfW + BALL.radius - 0.001);
    expect(match.setPieces.checkOut()).toBe(false);
  });
});
