import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { MOTION_CATALOG } from '../src/data/MotionCatalog';
import { MOTION_SELECT, selectMotion } from '../src/anim/MotionLibrary';
import { command, parkPlayers, simulation } from './helpers';

const deg = (d: number) => (d * Math.PI) / 180;

describe('동작 라이브러리', () => {
  it('킥 종류마다 왼발·오른발 동작이 모두 있다 (좌우 반전 포함)', () => {
    for (const kind of ['pass', 'lob', 'shot'] as const) {
      const sides = new Set(MOTION_CATALOG.filter((e) => e.kind === kind).map((e) => e.side));
      expect(sides.has('L') && sides.has('R'), kind).toBe(true);
    }
    expect(MOTION_CATALOG.some((e) => e.kind === 'dive' && e.side === 'L')).toBe(true);
    expect(MOTION_CATALOG.some((e) => e.kind === 'dive' && e.side === 'R')).toBe(true);
    for (const e of MOTION_CATALOG) {
      expect(e.key, e.id).toBeGreaterThanOrEqual(0);
      expect(e.key, e.id).toBeLessThanOrEqual(e.duration + 1e-6);
    }
  });

  it('정면 근처 정지 패스는 모션캡처, 질주 중 옆 패스는 GRF를 고른다', () => {
    const front = selectMotion(MOTION_CATALOG, { kind: 'pass', speed: 'idle', angle: deg(10), foot: 'R' })!;
    expect(front.entry.source).toBe('mocap');
    const side = selectMotion(MOTION_CATALOG, { kind: 'pass', speed: 'sprint', angle: deg(90), foot: 'R' })!;
    expect(side.entry.source).toBe('grf');
    expect(side.entry.speed).toBe('sprint');
    // 고른 동작의 공 방향이 원하는 방향과 가깝다
    expect(Math.abs(side.entry.ballAngle - deg(90))).toBeLessThan(deg(35));
  });

  it('좌우 대칭인 상황에서는 서로 좌우 반전된 동작을 고른다', () => {
    for (const kind of ['pass', 'lob', 'shot'] as const) {
      const l = selectMotion(MOTION_CATALOG, { kind, speed: 'walk', angle: deg(30), foot: 'L' })!;
      const r = selectMotion(MOTION_CATALOG, { kind, speed: 'walk', angle: deg(-30), foot: 'R' })!;
      expect(r.entry.id.replace('~m', ''), kind).toBe(l.entry.id.replace('~m', ''));
      expect(r.entry.side).not.toBe(l.entry.side);
    }
  });
});

describe('킥 동작 타이밍', () => {
  it('패스는 동작 시작 뒤 터치 순간에 나가고, 그 사이 공은 발 앞에 있다', () => {
    const { match } = simulation(3, { kickMotion: true, userControl: false });
    parkPlayers(match);
    const p = match.teams[0].find((q) => q.slot.label === 'CM')!;
    const mate = match.forward(0);
    p.actionLock = mate.actionLock = 0;
    p.pos.set(-10, 0, 0);
    mate.pos.set(2, 0, 0);
    p.facing.set(1, 0, 0);
    match.ball.reset(-9.65, 0);
    match.ball.owner = match.ball.lastTouch = p;
    match.pass(p, new THREE.Vector3(1, 0, 0), 'short', 0.5);
    expect(match.kicking(p)).toBe(true);
    expect(match.stats.passes[0]).toBe(0);
    const cmd = command();
    let t = 0;
    while (match.kicking(p) && t < 1) {
      match.update(PHYSICS.step, cmd);
      t += PHYSICS.step;
      if (match.kicking(p)) expect(match.ball.owner).toBe(p);
    }
    expect(t).toBeGreaterThan(0.05);
    expect(t).toBeLessThanOrEqual(MOTION_SELECT.windup + PHYSICS.step * 2);
    expect(match.stats.passes[0]).toBe(1);
    expect(match.ball.owner).toBeNull();
    expect(match.ball.velocity.x).toBeGreaterThan(3);
  });

  it('킥 동작을 켠 AI 대 AI 4분 × 2경기: 멈춤 없이 끝나고 패스·슛이 이어진다', () => {
    let shots = 0;
    for (const seed of [7, 42]) {
      const { match } = simulation(seed, { kickMotion: true, userControl: false });
      const cmd = command();
      for (let i = 0; i < 330 / PHYSICS.step && match.phase !== 'fulltime'; i++) {
        match.update(PHYSICS.step, cmd);
        match.events.length = 0;
      }
      expect(match.phase).toBe('fulltime');
      expect(match.stats.passes[0] + match.stats.passes[1]).toBeGreaterThan(80);
      shots += match.stats.shots[0] + match.stats.shots[1];
    }
    expect(shots).toBeGreaterThan(0);
  });
    const cmd = command();
    for (let i = 0; i < 330 / PHYSICS.step && match.phase !== 'fulltime'; i++) {
      match.update(PHYSICS.step, cmd);
      match.events.length = 0;
    }
    expect(match.phase).toBe('fulltime');
    expect(match.stats.passes[0] + match.stats.passes[1]).toBeGreaterThan(80);
    expect(match.stats.shots[0] + match.stats.shots[1]).toBeGreaterThan(0);
  });
});
