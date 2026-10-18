import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { MATCH, VISUAL } from '../src/config';
import { SKILLS } from '../src/gameplay/Skills';
import { simulation } from './helpers';

afterEach(() => vi.unstubAllGlobals());

it('메뉴에서 고른 시간은 저장·재로드되고 잘못된 저장 값은 기본 시간으로 돌아간다', async () => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) });
  vi.resetModules();
  const first = await import('../src/core/Settings');
  first.setDuration(480);
  vi.resetModules();
  expect((await import('../src/core/Settings')).settings.duration).toBe(480);
  data.set('snapshoot-classic:settings', JSON.stringify({ duration: -10 }));
  vi.resetModules();
  expect((await import('../src/core/Settings')).settings.duration).toBe(MATCH.durationSeconds);
});

it('공은 블롭만 쓰고 선수 그림자는 거리 경계의 작은 진동에 유지된다', () => {
  const { match } = simulation();
  const ball = match.ball;
  ball.object.traverse((node) => { expect(node.castShadow).toBe(false); });
  expect(ball.shadow.visible).toBe(true);
  const p = match.controlled;
  const mesh = new THREE.Mesh();
  p.model.root.add(mesh);
  p.syncVisual(1 / 60, 0);
  expect(mesh.castShadow).toBe(true);
  for (const offset of [0.5, -0.5, 1, -1]) {
    p.syncVisual(1 / 60, VISUAL.shadowDistance + offset);
    expect(mesh.castShadow).toBe(true);
  }
  p.syncVisual(1 / 60, VISUAL.shadowDistance + VISUAL.shadowHysteresis + 1);
  expect(mesh.castShadow).toBe(false);
  p.syncVisual(1 / 60, VISUAL.shadowDistance - 1);
  expect(mesh.castShadow).toBe(false);
  p.syncVisual(1 / 60, VISUAL.shadowDistance - VISUAL.shadowHysteresis - 1);
  expect(mesh.castShadow).toBe(true);
});

it.each(['stars', 'distance', 'height', 'busy'] as const)('개인기 시작 실패는 %s 이벤트만 추가한다', (reason) => {
  const { match } = simulation();
  const p = match.controlled;
  p.pos.set(0, 0, 0);
  p.actionLock = p.kickCooldown = p.stunned = 0;
  Object.defineProperty(p, 'profile', { value: { ...p.profile, skill: reason === 'stars' ? 1 : 5 }, configurable: true });
  match.ball.reset(reason === 'distance' ? 3 : 0.4, 0);
  match.ball.owner = p;
  if (reason === 'height') match.ball.body.position.y = 2;
  if (reason === 'busy') p.actionLock = 1;
  const position = match.ball.position.clone();
  const velocity = match.ball.velocity.clone();
  const actionLock = p.actionLock;
  const def = SKILLS.find((s) => s.id === 'roulette_r')!;
  expect(match.skills.start(p, def)).toBe(false);
  expect(match.events.at(-1)).toMatchObject({ type: 'skillFail', id: def.id, player: p, reason });
  expect(match.ball.position).toEqual(position);
  expect(match.ball.velocity).toEqual(velocity);
  expect(p.actionLock).toBe(actionLock);
  expect(match.skills.isActive(p)).toBe(false);
});
