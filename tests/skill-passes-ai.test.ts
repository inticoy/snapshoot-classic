import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PASS, PHYSICS, SKILL_AI } from '../src/config';
import { SKILLS } from '../src/gameplay/Skills';
import { type PassKind } from '../src/gameplay/Kicks';
import { type AssistLevel } from '../src/core/Settings';
import { runScript } from '../src/playground/Script';
import { simulation, parkPlayers, command } from './helpers';

const pairs: [PassKind, PassKind, string][] = [['short', 'driven', 'KeyS'], ['through', 'drivenThrough', 'KeyW'], ['lob', 'lowLob', 'KeyA']];
function passSetup(seed = 7) {
  const { match } = simulation(seed);
  parkPlayers(match);
  const p = match.teams[0].find((p) => p.slot.label === 'CM')!;
  const mate = match.forward(0);
  p.actionLock = 0; p.pos.set(-15, 0, 0); p.facing.set(1, 0, 0);
  mate.pos.set(1, 0, 0); mate.vel.set(0, 0, 0);
  match.ball.reset(-14.6, 0); match.ball.owner = p;
  return { match, p, mate };
}
describe('Z 패스 3종', () => {
  for (const assist of ['assisted', 'semi', 'manual'] as AssistLevel[]) {
    it.each(pairs)(`${assist}: %s → %s 속도·높이·수신자 보존`, (base, driven) => {
      const { match, p } = passSetup();
      match.random.reset(42);
      const normal = match.kicks.pass(p, new THREE.Vector3(1, 0, 0), base, 0.55, assist);
      match.random.reset(42);
      const fast = match.kicks.pass(p, new THREE.Vector3(1, 0, 0), driven, 0.55, assist);
      const vh = (r: typeof fast) => Math.hypot(r.vel.x, r.vel.z);
      expect(vh(fast) / vh(normal)).toBeCloseTo(driven === 'lowLob' ? 1 / PASS.lowLobTime : PASS.drivenSpeed, 8);
      expect(fast.vel.y).toBeLessThan(normal.vel.y);
      expect(fast.receiver).toBe(normal.receiver);
      if (assist !== 'manual') expect(fast.receiver).not.toBeNull();
      else expect(Math.abs(Math.atan2(fast.vel.z, fast.vel.x))).toBeLessThan(0.2);
    });
  }
  it.each(pairs)('%s → %s: 100시드 방향 오차는 15% 증가', (base, driven) => {
    let normalError = 0, fastError = 0, normalSpeed = 0, fastSpeed = 0, normalY = 0, fastY = 0;
    const { match, p } = passSetup();
    for (let seed = 0; seed < 100; seed++) {
      match.random.reset(seed);
      const normal = match.kicks.pass(p, new THREE.Vector3(1, 0, 0), base, 0.55, 'manual');
      match.random.reset(seed);
      const fast = match.kicks.pass(p, new THREE.Vector3(1, 0, 0), driven, 0.55, 'manual');
      normalError += Math.atan2(normal.vel.z, normal.vel.x) ** 2;
      fastError += Math.atan2(fast.vel.z, fast.vel.x) ** 2;
      normalSpeed += Math.hypot(normal.vel.x, normal.vel.z); fastSpeed += Math.hypot(fast.vel.x, fast.vel.z);
      normalY += normal.vel.y; fastY += fast.vel.y;
    }
    expect(Math.sqrt(fastError / normalError)).toBeCloseTo(1.15, 8);
    console.info(`skill-pass ${driven}: speed=${(normalSpeed / 100).toFixed(3)}→${(fastSpeed / 100).toFixed(3)}m/s vy=${(normalY / 100).toFixed(3)}→${(fastY / 100).toFixed(3)}m/s error×${Math.sqrt(fastError / normalError).toFixed(3)}`);
  });
  it.each(pairs)('실제 Z+키: %s → %s', (_base, driven, key) => {
    const run = (z: boolean) => runScript({ scenario: 'free', seed: 5, duration: 1.5, sampleHz: 120, inputs: [
      { t: 0, keys: [] }, { t: 0.5, keys: ['ArrowUp', key, ...(z ? ['KeyZ'] : [])] }, { t: 0.75, keys: [] },
    ] });
    const a = run(false), b = run(true);
    expect(b.events.filter((e) => e.type === 'kick')).toHaveLength(1);
    expect(b.events.filter((e) => e.type === 'skill')).toHaveLength(0);
    const frame = (r: typeof a) => r.frames.find((f) => f.t + 1e-6 >= r.events.find((e) => e.type === 'kick')!.t)!;
    const normal = frame(a).ball.vel, fast = frame(b).ball.vel;
    expect(Math.hypot(fast[0], fast[2])).toBeGreaterThan(Math.hypot(normal[0], normal[2]) * 1.15);
    expect(fast[1]).toBeLessThan(normal[1]);
    if (driven === 'lowLob') expect(fast[1]).toBeGreaterThan(1);
  });
});

describe('AI의 별·정면 1:1 조건', () => {
  function duel(stars: number, dx = 1.8, dz = 0, crowd = false) {
    const { match, p } = passSetup();
    Object.defineProperty(p, 'profile', { value: { ...p.profile, skill: stars }, configurable: true });
    const foe = match.teams[1].find((q) => !q.isKeeper)!;
    foe.pos.copy(p.pos).add(new THREE.Vector3(dx, 0, dz));
    if (crowd) match.teams[1].find((q) => q !== foe && !q.isKeeper)!.pos.copy(p.pos).add(new THREE.Vector3(1.5, 0, 0.8));
    const next = vi.spyOn(match.random, 'next').mockReturnValue(0.01);
    const start = vi.spyOn(match.skills, 'start');
    match.ai.reset();
    match.ai.update(PHYSICS.step);
    next.mockRestore();
    return { match, p, start };
  }
  it.each([2, 3])('별 %i 선수는 정면 2m 내 수비 1명에게 허용된 기술을 쓴다', (stars) => {
    const { match, p, start } = duel(stars);
    expect(start).toHaveBeenCalledOnce();
    expect(match.skills.current(p)!.stars).toBeLessThanOrEqual(stars);
    expect(match.events.filter((e) => e.type === 'skill')).toHaveLength(1);
  });
  it.each([[1, 1.8, 0, false], [3, -1.8, 0, false], [3, 0, 1.8, false], [3, 2.1, 0, false], [3, 1.8, 0, true]])('별 %i·수비 (%f, %f)·밀집 %s이면 개인기 없음', (stars, dx, dz, crowd) => {
    expect(duel(stars as number, dx as number, dz as number, crowd as boolean).match.events.some((e) => e.type === 'skill')).toBe(false);
  });
  it('1,000개 독립 시드에서 낮은 빈도로 사용하고 별 제한을 넘지 않는다', () => {
    let used = 0;
    const { match, p } = passSetup();
    Object.defineProperty(p, 'profile', { value: { ...p.profile, skill: 3 }, configurable: true });
    const foe = match.teams[1].find((q) => !q.isKeeper)!;
    foe.pos.copy(p.pos).add(new THREE.Vector3(1.8, 0, 0));
    for (let seed = 0; seed < 1000; seed++) {
      match.skills.clear(); match.events.length = 0; p.actionLock = p.kickCooldown = 0;
      p.vel.set(0, 0, 0); p.facing.set(1, 0, 0);
      match.ball.reset(-14.6, 0); match.ball.owner = p;
      match.ai.reset(); match.random.reset(seed); match.ai.update(PHYSICS.step);
      for (const event of match.events) if (event.type === 'skill') {
        used++;
        expect(SKILLS.find((s) => s.id === event.id)!.stars).toBeLessThanOrEqual(3);
      }
    }
    console.info(`skill-ai: ${used}/1000 decisions, chance=${SKILL_AI.chance}`);
    expect(used).toBeGreaterThan(15); expect(used).toBeLessThan(60);
  });
  it('동작 중에는 패스·슛 결정을 다시 하지 않으며 연속 사용을 제한한다', () => {
    const { match, p } = duel(3);
    const pass = vi.spyOn(match, 'pass'); const shoot = vi.spyOn(match, 'shoot');
    const cmd = command();
    for (let i = 0; i < 30; i++) match.update(PHYSICS.step, cmd);
    expect(pass.mock.calls.filter(([q]) => q === p)).toHaveLength(0);
    expect(shoot.mock.calls.filter(([q]) => q === p)).toHaveLength(0);
    expect(match.events.filter((e) => e.type === 'skill')).toHaveLength(1);
  });
});
