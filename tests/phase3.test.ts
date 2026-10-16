import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BALL, PHYSICS, PITCH } from '../src/config';
import { Random } from '../src/core/Random';
import { settings } from '../src/core/Settings';
import { setActivePhysics } from '../src/physics/presets';
import { command, parkPlayers, simulation } from './helpers';

const defaults = { ...settings };
afterEach(() => { Object.assign(settings, defaults); setActivePhysics('arcade'); });

function duel(seed: number, team: 0 | 1 = 0) {
  const { match, physics } = simulation(seed);
  parkPlayers(match);
  const striker = match.forward(team), keeper = match.teams[1 - team][0];
  const a = striker.attackDir, gx = match.oppGoalX(team);
  striker.actionLock = keeper.actionLock = 0;
  striker.pos.set(gx - a * 25, 0, (seed % 9 - 4) * 0.8);
  striker.facing.set(a, 0, 0);
  keeper.pos.set(gx - a * 0.8, 0, 0);
  keeper.facing.set(-a, 0, 0);
  match.controlled = striker;
  match.ball.reset(striker.pos.x + a * 0.5, striker.pos.z);
  match.ball.owner = match.ball.lastTouch = striker;
  return { match, physics, striker, keeper, a, gx };
}

function oneOnOnes(team: 0 | 1, count = 100) {
  let goals = 0, advances = 0, smothers = 0, blocks = 0;
  for (let seed = 0; seed < count; seed++) {
    const { match, striker, keeper, a, gx } = duel(seed, team);
    const random = new Random(seed + 814), cmd = command();
    const shootDepth = 8 + random.next() * 10;
    const targetZ = (random.next() < 0.5 ? -1 : 1) * (1 + random.next() * 2);
    let shot = false, maxAdvance = 0;
    for (let t = 0; t < 8 / PHYSICS.step && match.phase === 'playing'; t++) {
      cmd.move.set(a, 0, -striker.pos.z * 0.04).normalize();
      cmd.sprint = !shot;
      if (!shot && match.ball.owner === striker && Math.abs(gx - striker.pos.x) < shootDepth) {
        match.shoot(striker, 0.4 + random.next() * 0.35, false,
          new THREE.Vector3(gx - striker.pos.x, 0, targetZ - striker.pos.z).normalize());
        shot = true;
      }
      match.update(PHYSICS.step, cmd);
      maxAdvance = Math.max(maxAdvance, Math.abs(gx - keeper.pos.x));
      for (const e of match.events) {
        if (e.type === 'smother') smothers++;
        if (e.type === 'keeperBlock') blocks++;
      }
      match.events.length = 0;
      if (match.ball.owner === keeper) break;
    }
    if (match.score[team]) goals++;
    if (maxAdvance > 3.5) advances++;
  }
  return { goals, advances, smothers, blocks, attempts: count };
}

it.each([0, 1] as const)('25m 단독 돌파 100시드: 공격 팀 %i 득점률 30~60%%·전진·몸통 블록', (team) => {
  const result = oneOnOnes(team);
  console.info(`1대1 team=${team}: ${JSON.stringify(result)}`);
  expect(result.advances).toBeGreaterThanOrEqual(95);
  expect(result.goals).toBeGreaterThanOrEqual(30);
  expect(result.goals).toBeLessThanOrEqual(60);
  expect(result.blocks).toBeGreaterThan(0);
  expect(result.smothers).toBeGreaterThan(0);
});

function chips(depth: number) {
  let goals = 0;
  for (let seed = 0; seed < 100; seed++) {
    const { match, striker, keeper, gx, a } = duel(seed);
    striker.pos.set(gx - a * 16, 0, 0);
    keeper.pos.set(gx - a * depth, 0, 0);
    match.ball.reset(striker.pos.x + a * 0.5, 0);
    match.chipShot(striker, 0.25, new THREE.Vector3(a, 0, 0));
    striker.actionLock = 60;
    for (let t = 0; t < 5 / PHYSICS.step && match.phase === 'playing'; t++) {
      match.update(PHYSICS.step, command());
      match.events.length = 0;
      if (match.ball.owner === keeper) break;
    }
    if (match.score[0]) goals++;
  }
  return goals;
}

it('같은 칩슛 100시드: 전진한 키퍼가 골문에 선 키퍼보다 더 많이 허용한다', () => {
  const line = chips(0.8), advanced = chips(9);
  console.info(`칩슛: 골문 ${line}/100, 전진 ${advanced}/100`);
  expect(advanced).toBeGreaterThan(line + 15);
});

describe('키퍼 물리와 판단 경계', () => {
  it('확률 선방에 실패한 슛도 실제 몸에 맞으면 반사되고 마지막 터치가 바뀐다', () => {
    const { match, keeper, striker, gx, physics } = duel(8);
    keeper.actionLock = 60;
    keeper.pos.set(gx - 2, 0, 0);
    match.ball.owner = null;
    match.ball.position.set(gx - 4, 1.15, 0);
    match.ball.velocity.set(25, 0, 0);
    match.ball.newShot(striker);
    match.ball.shot!.saveRolled = true;
    for (let i = 0; i < 30; i++) match.update(PHYSICS.step, command());
    expect(match.events.some((e) => e.type === 'keeperBlock' && e.keeper === keeper)).toBe(true);
    expect(match.ball.lastTouch).toBe(keeper);
    expect(match.ball.velocity.x).toBeLessThan(0);
    expect(match.ball.shot).toBeNull();
    expect(match.stats.onTarget[0]).toBe(1);
    expect(physics.world.bodies.filter((b) => b.material?.name === 'keeper')).toHaveLength(2);
  });

  it('발밑 다이빙 중 충돌체가 내려가고 회전하며 이동한다', () => {
    const { match, keeper } = duel(1);
    keeper.startDive(new THREE.Vector3(-6, 0, 0), 1, 'smother');
    const collider = match.keepers.bodies.find((b) => b.player === keeper)!;
    const before = keeper.pos.x;
    for (let i = 0; i < 24; i++) match.update(PHYSICS.step, command());
    expect(collider.body.position.y).toBeLessThan(0.4);
    expect(Math.abs(collider.body.quaternion.x) + Math.abs(collider.body.quaternion.z)).toBeGreaterThan(0.5);
    expect(keeper.pos.x).toBeLessThan(before - 0.5);
    expect(collider.body.position.x).toBeCloseTo(keeper.pos.x, 5);
    expect(keeper.model.current).toBe('smother');
    match.startKickoff(0);
    expect(keeper.diveTimer).toBe(0);
    expect(collider.body.collisionFilterMask).toBe(0);
  });

  it('크로스 착지점을 향해 전진하고, 빈 공간에서는 캐치·혼잡할 때는 펀칭한다', () => {
    for (const crowded of [false, true]) {
      const { match, keeper, gx, striker } = duel(4);
      match.ball.owner = null;
      match.ball.lastTouch = striker;
      keeper.pos.set(gx - 2, 0, 0);
      match.ball.position.set(gx - 5, 4, 0);
      match.ball.velocity.set(0, -1, 0);
      for (let i = 0; i < 48; i++) match.update(PHYSICS.step, command());
      expect(keeper.pos.x).toBeLessThan(gx - 2.5);
      keeper.vel.set(0, 0, 0);
      match.ball.position.set(keeper.pos.x, 2.2, keeper.pos.z);
      match.ball.velocity.set(0, -3, 0);
      if (crowded) {
        match.teams[0][1].pos.copy(keeper.pos).z += 1.3;
        match.teams[1][1].pos.copy(keeper.pos).z -= 1.3;
      }
      match.random.next = () => 0;
      match.update(PHYSICS.step, command());
      expect(match.events.some((e) => e.type === 'cross' && e.caught === !crowded)).toBe(true);
      if (crowded) {
        expect(match.ball.owner).toBeNull();
        expect(match.ball.velocity.x).toBeLessThan(-5);
      } else expect(match.ball.owner).toBe(keeper);
    }
  });

  it('박스 밖 슛은 손으로 잡지 않으며 소유 중인 공은 자기 키퍼 몸에 튕기지 않는다', () => {
    const { match, keeper, striker, gx } = duel(3);
    keeper.pos.set(gx - PITCH.boxDepth - 2, 0, 0);
    keeper.actionLock = 60;
    match.ball.reset(keeper.pos.x - 0.6, 0);
    match.ball.velocity.set(2, 0, 0);
    match.ball.newShot(striker);
    match.ball.shot!.saveRolled = true;
    for (let i = 0; i < 3; i++) match.update(PHYSICS.step, command());
    expect(match.events.some((e) => e.type === 'save')).toBe(false);
    match.ball.owner = keeper;
    match.ball.position.set(keeper.pos.x, 1.15, 0);
    for (let i = 0; i < 30; i++) match.update(PHYSICS.step, command());
    expect(match.ball.owner).toBe(keeper);
    expect(match.keepers.bodies.find((b) => b.player === keeper)!.body.collisionFilterMask).toBe(0);
  });

  it('위치 선정·반응 속도가 높은 키퍼가 먼저 전진한다', () => {
    const depths = [20, 95].map((skill) => {
      const { match, keeper, gx } = duel(1);
      // 공유 팀 데이터가 다른 테스트에 영향을 주지 않도록 프로필 사본을 주입한다.
      Object.defineProperty(keeper, 'profile', { value: { ...keeper.profile, stats: { ...keeper.profile.stats, positioning: skill, reflexes: skill } } });
      for (let i = 0; i < 60; i++) match.update(PHYSICS.step, command());
      return Math.abs(gx - keeper.pos.x);
    });
    expect(depths[1]).toBeGreaterThan(depths[0] + 0.2);
  });
});

it('수비 W 꾹/해제는 홈 키퍼만 돌진시키고 공격 W·Q+W는 기존 스루 패스다', () => {
  const { match, striker } = duel(10, 1);
  match.controlled = match.forward(0);
  const cmd = command();
  cmd.through.held = cmd.through.pressed = true;
  const home = match.teams[0][0];
  home.actionLock = 0;
  home.pos.set(-PITCH.halfL + 0.8, 0, 0);
  match.update(PHYSICS.step, cmd);
  expect(match.keeperRush).toBe(true);
  expect(home.keeperAdvancing).toBe(true);
  expect(match.charge).toBeNull();
  cmd.through.held = cmd.through.pressed = false;
  cmd.through.released = true;
  striker.pos.set(0, 0, 0);
  match.ball.position.set(0, BALL.radius, 0);
  match.update(PHYSICS.step, cmd);
  expect(match.keeperRush).toBe(false);
  expect(home.keeperAdvancing).toBe(false);

  for (const lofted of [false, true]) {
    const test = duel(22);
    const c = command();
    c.through.held = c.through.pressed = true;
    c.modifier.held = lofted;
    test.match.update(PHYSICS.step, c);
    expect(test.match.charge?.kind).toBe('through');
    c.through.held = c.through.pressed = false;
    c.through.released = true;
    test.match.update(PHYSICS.step, c);
    expect(test.match.keeperRush).toBe(false);
    expect(test.match.stats.passes[0]).toBe(1);
    expect(test.match.ball.velocity.y > 2).toBe(lofted);
  }
});
