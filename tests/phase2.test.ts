import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { BALL, GOAL, PHYSICS, PITCH } from '../src/config';
import { pitchMarkings } from '../src/data/PitchMarkings';
import { FORMATION_433 } from '../src/data/Formation';
import { TEAMS } from '../src/data/Teams';
import { CameraRig } from '../src/camera/CameraRig';
import { playerDetailPanel } from '../src/ui/Menu';
import { command, simulation } from './helpers';

it('105×68m 경기장, 12cm 라인과 규격 골문·센터 서클을 사용한다', () => {
  const markings = pitchMarkings();
  expect(markings.find((m) => m.name === 'boundary')).toEqual({ kind: 'rect', name: 'boundary', x: -52.5, z: -34, width: 105, height: 68 });
  expect(markings.find((m) => m.name === 'halfway')).toMatchObject({ x: 0, z: -34, endX: 0, endZ: 34 });
  expect(markings.find((m) => m.name === 'center')).toMatchObject({ x: 0, z: 0, radius: 9.15 });
  expect(PITCH.lineWidth).toBe(0.12);
  expect(GOAL).toMatchObject({ width: 7.32, height: 2.44 });
  expect(PITCH.flagHeight).toBeGreaterThanOrEqual(1.5);
});

it('양쪽 박스 16.5×40.32m, 골 에어리어 5.5×18.32m, 스팟 11m 좌표가 일치한다', () => {
  const markings = pitchMarkings();
  for (const side of [-1, 1]) {
    const atEnd = markings.filter((m) => Math.sign(m.x) === side);
    expect(atEnd.find((m) => m.name === 'penaltyArea')).toMatchObject({ x: side < 0 ? -52.5 : 36, z: -20.16, width: 16.5, height: 40.32 });
    expect(atEnd.find((m) => m.name === 'goalArea')).toMatchObject({ x: side < 0 ? -52.5 : 47, z: -9.16, width: 5.5, height: 18.32 });
    expect(atEnd.find((m) => m.name === 'penaltySpot')).toMatchObject({ x: side * 41.5, z: 0 });
  }
});

it('페널티 아크의 모든 점은 박스 밖에 있고 양 끝은 박스 경계에 닿는다', () => {
  const arcs = pitchMarkings().filter((m) => m.kind === 'arc' && m.name === 'penaltyArc');
  expect(arcs).toHaveLength(2);
  for (const arc of arcs) {
    if (arc.kind !== 'arc') throw new Error('arc');
    expect(arc.radius).toBe(9.15);
    for (let i = 0; i <= 100; i++) {
      const angle = arc.start + (arc.end - arc.start) * i / 100;
      const x = arc.x + arc.radius * Math.cos(angle);
      expect(Math.abs(x)).toBeLessThanOrEqual(36 + 1e-10);
      if (i === 0 || i === 100) expect(Math.abs(x)).toBeCloseTo(36, 10);
    }
  }
});

it('네 코너는 반지름 1m 사분원이고 모든 점이 경기장 안쪽에 있다', () => {
  const corners = pitchMarkings().filter((m) => m.kind === 'arc' && m.name === 'cornerArc');
  expect(corners).toHaveLength(4);
  for (const arc of corners) {
    if (arc.kind !== 'arc') throw new Error('arc');
    expect(arc.radius).toBe(1);
    expect(arc.end - arc.start).toBeCloseTo(Math.PI / 2, 12);
    for (let i = 0; i <= 100; i++) {
      const angle = arc.start + (arc.end - arc.start) * i / 100;
      const x = arc.x + Math.cos(angle), z = arc.z + Math.sin(angle);
      expect(Math.abs(x)).toBeLessThanOrEqual(52.5 + 1e-10);
      expect(Math.abs(z)).toBeLessThanOrEqual(34 + 1e-10);
    }
  }
});

it('골대 충돌체의 안쪽 간격 7.32m와 크로스바 아래 높이 2.44m가 시각 치수와 같다', () => {
  const { match } = simulation();
  for (const goal of match.goals) {
    const [left, right, bar] = goal.postBodies;
    expect(right.position.z - left.position.z - GOAL.postRadius * 2).toBeCloseTo(7.32);
    expect(bar.position.y - GOAL.postRadius).toBeCloseTo(2.44);
  }
});

it('양 팀 11명은 슬롯·고유 등번호·주발/약발·능력치가 있고 상세에 노출된다', () => {
  expect(FORMATION_433.map((s) => s.label)).toEqual(['GK', 'LB', 'LCB', 'RCB', 'RB', 'LCM', 'CM', 'RCM', 'LW', 'ST', 'RW']);
  const { match } = simulation();
  for (const team of [0, 1] as const) {
    expect(match.teams[team]).toHaveLength(11);
    expect(new Set(TEAMS[team].players.map((p) => p.number)).size).toBe(11);
    for (const [i, p] of TEAMS[team].players.entries()) {
      expect(['L', 'R']).toContain(p.foot);
      expect(p.weakFoot).toBeGreaterThanOrEqual(1);
      expect(p.weakFoot).toBeLessThanOrEqual(5);
      expect(Object.values(p.stats).every((v) => v >= 1 && v <= 99)).toBe(true);
      expect(playerDetailPanel(team, i)).toContain(p.short);
    }
    const cb = match.teams[team][2].profile.stats;
    const wing = match.teams[team][8].profile.stats;
    expect(cb.defAwareness).toBeGreaterThan(wing.defAwareness + 30);
    expect(wing.acceleration).toBeGreaterThan(cb.acceleration);
  }
});

it.each([0, 1] as const)('팀 %i 킥오프에서 키커와 옆 선수만 중앙에 있고 나머지는 자기 진영·상대는 서클 밖이다', (team) => {
  const { match } = simulation();
  match.startKickoff(team);
  const taker = match.forward(team);
  expect(taker.slot.label).toBe('ST');
  expect(match.ball.owner).toBe(taker);
  for (const p of match.players) {
    expect(p.pos.x * p.attackDir).toBeLessThanOrEqual(0);
    if (p !== taker && p !== match.kickoffPartner(team)) expect(p.pos.length()).toBeGreaterThanOrEqual(9.15);
    for (const q of match.players) if (q !== p) expect(p.pos.distanceTo(q.pos)).toBeGreaterThan(0.84);
  }
});

for (const end of [-1, 1]) {
  for (const side of [-1, 1]) {
    it.each(['corner', 'goalkick', 'throwin'] as const)(`${end}/${side} %s에서 22명이 겹치거나 경기장 밖에 배치되지 않는다`, (kind) => {
      const { match } = simulation(12, { userControl: false });
      match.phase = 'playing';
      match.ball.owner = null;
      const defending = end > 0 ? 1 : 0;
      match.ball.lastTouch = match.teams[kind === 'corner' ? defending : 1 - defending][1];
      match.ball.position.set(kind === 'throwin' ? end * 20 : end * (PITCH.halfL + 1), BALL.radius, kind === 'throwin' ? side * (PITCH.halfW + 1) : side * 12);
      expect(match.setPieces.checkOut()).toBe(true);
      for (let i = 0; i < 150 && !match.setPieces.current?.ready; i++) match.update(PHYSICS.step, command());
      expect(match.phase).toBe('setpiece');
      const sp = match.setPieces.current!;
      for (const p of match.players) {
        if (p !== sp.taker) {
          expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(52.5);
          expect(Math.abs(p.pos.z)).toBeLessThanOrEqual(34);
        }
        for (const q of match.players) if (q !== p) expect(p.pos.distanceTo(q.pos)).toBeGreaterThan(0.84);
        if (kind === 'goalkick' && p.team !== sp.team) expect(Math.abs(p.pos.x - match.ownGoalX(sp.team))).toBeGreaterThanOrEqual(16.5);
      }
    });
  }
}

it('풀백은 오버랩하고 윙어·미드필더는 각자 폭을 유지한다', () => {
  const { match } = simulation();
  match.ball.position.set(10, BALL.radius, 6);
  for (const team of [0, 1] as const) {
    const targets = new Map(match.teams[team].map((p) => [p.slot.label, match.ai.formationTarget(p, true, new THREE.Vector3())]));
    expect(targets.get('LB')!.x * match.teams[team][0].attackDir).toBeGreaterThan(targets.get('LCB')!.x * match.teams[team][0].attackDir);
    expect(Math.abs(targets.get('LW')!.z)).toBeGreaterThan(20);
    expect(Math.abs(targets.get('RW')!.z)).toBeGreaterThan(20);
    expect(targets.get('LCM')!.distanceTo(targets.get('RCM')!)).toBeGreaterThan(20);
    expect(targets.get('LW')!.distanceTo(targets.get('ST')!)).toBeGreaterThan(20);
  }
});

it.each([16 / 9, 844 / 390])('중계 카메라 %f 화면에서 중앙·네 코너의 공과 주변 20m를 따라간다', (aspect) => {
  const rig = new CameraRig(aspect);
  rig.resize(aspect);
  for (const x of [-52, 0, 52]) {
    for (const z of [-33, 0, 33]) {
      const focus = new THREE.Vector3(x, 0, z);
      for (let i = 0; i < 180; i++) rig.update(1 / 60, focus, focus, null);
      rig.camera.updateMatrixWorld(true);
      const projected = focus.clone().project(rig.camera);
      expect(Math.abs(projected.x)).toBeLessThan(0.8);
      expect(Math.abs(projected.y)).toBeLessThan(0.6);
      for (const offset of [-10, 10]) {
        const near = focus.clone().add(new THREE.Vector3(offset, 0, 0)).project(rig.camera);
        expect(Math.abs(near.x)).toBeLessThan(1);
      }
    }
  }
});

it('넓은 경기장에서 20초 연속 질주해도 스태미나가 남고 휴식하면 회복한다', () => {
  const p = simulation().match.forward(0);
  const direction = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < 20 / PHYSICS.step; i++) p.steer(direction, true, false, PHYSICS.step);
  expect(p.stamina).toBeGreaterThan(0.2);
  expect(p.stamina).toBeLessThan(0.5);
  for (let i = 0; i < 40 / PHYSICS.step; i++) p.steer(new THREE.Vector3(), false, false, PHYSICS.step);
  expect(p.stamina).toBe(1);
});

it('먼 선수는 위치를 매 프레임, 애니메이션을 30Hz로 갱신하고 액션은 60Hz로 유지한다', () => {
  const p = simulation().match.forward(0);
  const update = vi.spyOn(p.model, 'update');
  for (let i = 0; i < 60; i++) { p.pos.x = i; p.syncVisual(1 / 60, 100); expect(p.model.root.position.x).toBe(i); }
  expect(update).toHaveBeenCalledTimes(30);
  expect(update.mock.calls.reduce((sum, [dt]) => sum + dt, 0)).toBeCloseTo(1);
  update.mockClear();
  p.playAction('kick', 1);
  for (let i = 0; i < 30; i++) p.syncVisual(1 / 60, 100);
  expect(update).toHaveBeenCalledTimes(30);
});
