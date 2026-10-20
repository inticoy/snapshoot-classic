import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { Input } from '../src/core/Input';
import { CommandDecoder, encodeCommand } from '../src/net/CommandCodec';
import { PlaygroundScenarios } from '../src/playground/Scenarios';
import { scriptCommand } from '../src/playground/Script';
import { SKILLS, SkillInput } from '../src/gameplay/Skills';
import { simulation } from './helpers';

const step = PHYSICS.step;
const setup = (kickMotion: boolean) => {
  const { match } = simulation(3, { practice: true, kickMotion });
  new PlaygroundScenarios(match).reset('passing', 3, 'stand');
  const input = new Input({ addEventListener() {} } as unknown as Window);
  const tick = (keys: string[] = []) => {
    input.setVirtualKeys(keys);
    match.update(step, scriptCommand(input));
    input.endFrame();
  };
  return { match, tick };
};

it.each(['KeyS', 'KeyW', 'KeyA', 'KeyD'])('%s 단타는 release 틱에 킥 또는 준비 동작을 시작한다', (key) => {
  for (const motion of [false, true]) {
    const { match, tick } = setup(motion);
    const p = match.controlled;
    tick([key]);
    expect(match.kicking(p)).toBe(false);
    tick();
    expect(match.charge).toBeNull();
    if (motion) {
      expect(match.kicking(p)).toBe(true);
      expect(match.events.filter((e) => e.type === 'kick')).toHaveLength(0);
    } else {
      expect(match.events.filter((e) => e.type === 'kick')).toHaveLength(1);
      expect(match.pendingUserKick).toBeNull();
    }
  }
});

it.each([['KeyS', 'short', 'dink'], ['KeyW', 'through', 'dinkThrough'], ['KeyA', 'lob', 'lowLob'], ['KeyD', 'shot', 'drivenShot']])(
  '%s 두 번째 탭은 접촉 전 종류만 바꾸고 킥을 늦추지 않는다', (key, single, double) => {
    const run = (upgrade: boolean) => {
      const { match, tick } = setup(true);
      tick([key]); tick();
      const p = match.controlled;
      let contact = 0;
      for (let i = 0; i < 120; i++) {
        tick(upgrade && i === 0 ? [key] : []);
        if (match.events.some((e) => e.type === 'kick' && e.player === p)) { contact = i; break; }
      }
      expect(match.pendingUserKick).toBeNull();
      return { contact, kicks: match.events.filter((e) => e.type === 'kick') };
    };
    const a = run(false), b = run(true);
    expect(a.kicks).toHaveLength(1);
    expect(b.kicks).toHaveLength(1);
    expect(a.kicks[0].kind).toBe(single);
    expect(b.kicks[0].kind).toBe(double);
    expect(b.contact).toBe(a.contact);
  },
);

it('접촉 뒤 연타는 동작 없는 즉시 킥을 소급해서 바꾸지 않는다', () => {
  const { match, tick } = setup(false);
  const p = match.controlled;
  tick(['KeyD']); tick(); tick(['KeyD']); tick();
  const kicks = match.events.filter((e) => e.type === 'kick' && e.player === p);
  expect(kicks).toHaveLength(1);
  expect(kicks[0]).toMatchObject({ type: 'kick', kind: 'shot' });
});

it.each([false, true])('기존 6바이트 명령으로 두 경기는 동일하게 재생한다 (더블탭=%s)', (double) => {
  const run = () => {
    const { match } = setup(true);
    const input = new Input({ addEventListener() {} } as unknown as Window);
    const decoder = new CommandDecoder();
    const kicks: { tick: number; kind?: string; velocity?: number[] }[] = [];
    for (let i = 0; i < 80; i++) {
      input.setVirtualKeys(i === 0 || double && i === 3 ? ['KeyD'] : []);
      const bytes = encodeCommand(scriptCommand(input));
      expect(bytes).toHaveLength(6);
      match.update(step, decoder.decode(bytes)); input.endFrame();
      for (const e of match.events) if (e.type === 'kick') kicks.push({ tick: i, kind: e.kind, velocity: e.velocity });
      match.events.length = 0;
    }
    return { kicks, ball: match.ball.body.position.toArray() };
  };
  const a = run();
  expect(a.kicks).toHaveLength(1);
  expect(a.kicks[0].kind).toBe(double ? 'drivenShot' : 'shot');
  expect(run()).toEqual(a);
});

it.each([[1, 1], [1, -1], [-1, 1], [-1, -1]])('대각선 (%s, %s) 달리던 입력을 같은 스냅 기준으로 제외하고 새 탭을 인식한다', (x, z) => {
  const input = new SkillInput();
  const move = new THREE.Vector3(x, 0, z).normalize();
  const facing = move.clone();
  const list = SKILLS.filter((s) => s.id === 'feint_r');
  input.update(step, false, false, move, facing, list);
  input.update(step, true, false, move, facing, list);
  expect(input.directions).toEqual([]);
  // 시작 때 ±X로 스냅했다. 몸이 돌아도 시퀀스 기준은 그대로여야 한다.
  facing.set(0, 0, z);
  input.update(step, true, false, new THREE.Vector3(0, 0, x), facing, list);
  expect(input.update(step, true, false, new THREE.Vector3(), facing, list)?.id).toBe('feint_r');
});

it('달리던 대각선을 포함해 읽어도 오래 누른 키를 짧은 탭으로 세지 않는다', () => {
  const input = new SkillInput(true);
  const move = new THREE.Vector3(1, 0, 1).normalize();
  const tap = { ...SKILLS.find((s) => s.id === 'feint_r')!, trigger: { kind: 'shift' as const, seq: [{ dir: 'FR' as const, tap: true }] } };
  input.update(0.4, false, false, move, move, [tap]);
  input.update(step, true, false, move, move, [tap]);
  expect(input.update(step, false, false, new THREE.Vector3(), move, [tap])).toBeNull();
});
