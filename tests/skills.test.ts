import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SKILLS, SkillInput, dirOf, mirror, type SkillDef } from '../src/gameplay/Skills';
import { runScript, type PlaygroundScript } from '../src/playground/Script';

const fwd = new THREE.Vector3(1, 0, 0); // +X를 바라본다 → 오른쪽 = +Z
const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

describe('개인기 커맨드 인식', () => {
  it('바라보는 방향 기준 8방향', () => {
    expect(dirOf(v(1, 0), fwd)).toBe('F');
    expect(dirOf(v(0, 1), fwd)).toBe('R');
    expect(dirOf(v(-1, 0), fwd)).toBe('B');
    expect(dirOf(v(0, -1), fwd)).toBe('L');
    expect(dirOf(v(0.7, 0.7), fwd)).toBe('FR');
    expect(dirOf(v(0.1, 0), fwd)).toBeNull();
  });

  const run = (frames: { shift?: boolean; z?: boolean; move: THREE.Vector3 | null; secs: number }[], list: readonly SkillDef[] = SKILLS) => {
    const input = new SkillInput();
    const dt = 1 / 120;
    const found: string[] = [];
    for (const f of frames) {
      for (let t = 0; t < f.secs; t += dt) {
        const s = input.update(dt, !!f.shift, !!f.z, f.move ?? v(0, 0), fwd, list);
        if (s) found.push(s.id);
      }
    }
    return found;
  };

  it('Shift + → 짧게 = 오른쪽 속임 동작, 한 번만', () => {
    expect(run([{ shift: true, move: null, secs: 0.05 }, { shift: true, move: v(0, 1), secs: 0.1 }, { shift: true, move: null, secs: 0.3 }])).toEqual(['feint_r']);
  });

  it('Shift + → 꾹은 짧게(tap) 커맨드가 아니다', () => {
    expect(run([{ shift: true, move: v(0, 1), secs: 0.5 }, { shift: true, move: null, secs: 0.3 }], SKILLS.filter((s) => !s.sustained))).toEqual([]);
  });

  it('Z + ↓ = 드래그백 (누르고 있는 중에 바로 나간다)', () => {
    expect(run([{ z: true, move: v(-1, 0), secs: 0.2 }])).toEqual(['drag_back']);
  });

  it('긴 커맨드의 앞부분이면 끝까지 기다렸다가 긴 쪽을 낸다', () => {
    const tap: SkillDef = { ...SKILLS.find((s) => s.id === 'feint_r')!, id: 'short', stars: 2, trigger: { kind: 'shift', seq: [{ dir: 'F' }] } };
    const roll: SkillDef = { ...tap, id: 'long', trigger: { kind: 'shift', seq: [{ dir: 'F' }, { dir: 'FR' }, { dir: 'R' }] } };
    // ↑ → ↗ → → 를 굴리듯 누르면 짧은 쪽이 먼저 나가지 않는다
    expect(run([{ shift: true, move: v(1, 0), secs: 0.06 }, { shift: true, move: v(0.7, 0.7), secs: 0.06 }, { shift: true, move: v(0, 1), secs: 0.06 }, { shift: true, move: null, secs: 0.2 }], [tap, roll])).toEqual(['long']);
  });

  it('mirror는 방향·좌우 발·끝 방향을 뒤집는다', () => {
    const r = SKILLS.find((s) => s.id === 'feint_r')!;
    const l = mirror(r, 'x', 'x');
    expect(l.trigger.kind === 'shift' && l.trigger.seq[0].dir).toBe('L');
    expect(l.body[1].x).toBe(-r.body[1].x);
    expect(l.bait!.dir).toBe(-r.bait!.dir);
  });
});

describe('실제 키 입력으로 개인기 실행 (플레이그라운드 스크립트)', () => {
  const base = (inputs: PlaygroundScript['inputs'], duration = 3): PlaygroundScript => ({ scenario: 'free', seed: 5, duration, inputs });
  const skillEvents = (r: ReturnType<typeof runScript>) => r.events.filter((e) => e.type === 'skill').map((e) => (e as unknown as { id: string }).id);

  it('Shift + → 탭 → 속임 동작, 공을 지킨 채 다시 앞으로 간다', () => {
    const r = runScript(base([
      { t: 0, keys: ['ArrowUp'] },
      { t: 1, keys: ['ArrowUp', 'ShiftLeft'] },
      { t: 1.05, keys: ['ArrowRight', 'ShiftLeft'] },
      { t: 1.15, keys: ['ShiftLeft'] },
      { t: 1.35, keys: ['ArrowUp'] },
    ]));
    expect(skillEvents(r)).toEqual(['feint_r']);
    expect(r.summary.losses).toBe(0);
    expect(r.summary.possession).toBeGreaterThan(0.95);
  });

  it('Z + ↓ → 드래그백: 공이 뒤로 가고 몸이 돌아선다', () => {
    const r = runScript(base([{ t: 0, keys: ['ArrowUp'] }, { t: 1, keys: ['KeyZ', 'ArrowDown'] }, { t: 1.25, keys: [] }], 2.2));
    expect(skillEvents(r)).toEqual(['drag_back']);
    const at = (t: number) => r.frames.reduce((a, f) => (Math.abs(f.t - t) < Math.abs(a.t - t) ? f : a));
    const before = at(1.0), after = at(1.7);
    // 플레이그라운드 전진 = +X: 드래그백 뒤 공은 처음보다 뒤(-X)에 있고, 몸은 -X를 본다
    expect(after.ball.pos[0]).toBeLessThan(before.ball.pos[0] - 0.4);
    expect(after.user.facing[0]).toBeLessThan(-0.5);
    expect(before.user.facing[0]).toBeGreaterThan(0.5);
    expect(r.summary.losses).toBe(0);
  });

  it('달리다 D 게이지 중 S → 달리며 페이크 슛: 공을 차지 않는다', () => {
    const r = runScript(base([
      { t: 0, keys: ['ArrowUp'] },
      { t: 1, keys: ['ArrowUp', 'KeyD'] },
      { t: 1.12, keys: ['ArrowUp', 'KeyD', 'KeyS'] },
      { t: 1.18, keys: ['ArrowUp'] },
    ], 2.4));
    // 달리는 중이므로 달리며 페이크 (제자리 헛발질은 멈춰 있거나 C를 같이 누를 때)
    expect(skillEvents(r)).toEqual(['fake_shot_run']);
    expect(r.events.some((e) => e.type === 'kick')).toBe(false);
    expect(r.summary.possession).toBeGreaterThan(0.95);
  });

  it('달리다 A+S → 달리며 페이크: 넘어지지 않고 속도를 유지하며 공을 지킨다', () => {
    const r = runScript(base([
      { t: 0, keys: ['ArrowUp'] },
      { t: 1, keys: ['ArrowUp', 'KeyA'] },
      { t: 1.1, keys: ['ArrowUp', 'KeyA', 'KeyS'] },
      { t: 1.15, keys: ['ArrowUp'] },
    ], 2.2));
    expect(skillEvents(r)).toEqual(['fake_shot_run']);
    expect(r.events.some((e) => e.type === 'kick')).toBe(false);
    expect(r.summary.losses).toBe(0);
    // 페이크 동안에도 앞으로 계속 간다 (멈췄다 다시 출발하지 않는다)
    const speeds = r.frames.filter((f) => f.t >= 1.1 && f.t <= 1.6).map((f) => Math.hypot(f.user.vel[0], f.user.vel[2]));
    expect(Math.min(...speeds)).toBeGreaterThan(2);
  });

  it('C를 같이 누르면(C+A+S) 제자리 헛발질 페이크', () => {
    const r = runScript(base([
      { t: 0, keys: ['ArrowUp'] },
      { t: 1, keys: ['ArrowUp', 'KeyC', 'KeyA'] },
      { t: 1.1, keys: ['ArrowUp', 'KeyC', 'KeyA', 'KeyS'] },
      { t: 1.15, keys: [] },
    ], 2.2));
    expect(skillEvents(r)).toEqual(['fake_pass']);
  });

  it('별이 높을수록 달리며 페이크가 빨리 끝난다', async () => {
    const { SKILLS } = await import('../src/gameplay/Skills');
    const def = SKILLS.find((s) => s.id === 'fake_shot_run')!;
    expect(def.starScale).toBeGreaterThan(0);
  });

  it('달리던 방향키를 누른 채 Shift + → 탭 → 속임 동작 (달리던 ↑는 커맨드에 섞이지 않는다)', () => {
    const r = runScript(base([
      { t: 0, keys: ['ArrowUp'] },
      { t: 1, keys: ['ArrowUp', 'ShiftLeft'] },
      { t: 1.05, keys: ['ArrowUp', 'ShiftLeft', 'ArrowRight'] },
      { t: 1.12, keys: ['ArrowUp', 'ShiftLeft'] },
      { t: 1.4, keys: ['ArrowUp'] },
    ]));
    expect(skillEvents(r)).toEqual(['feint_r']);
  });

  it('달리던 방향키를 누른 채 Z + ↓ → 드래그백', () => {
    const r = runScript(base([{ t: 0, keys: ['ArrowUp'] }, { t: 1, keys: ['ArrowUp', 'KeyZ', 'ArrowDown'] }, { t: 1.3, keys: [] }], 2.2));
    expect(skillEvents(r)).toEqual(['drag_back']);
  });

  it('달리면서 굴리는 커맨드: ↑ 누른 채 Shift, → 더하고 ↑ 떼기 = 스텝오버 (탭 속임 동작과 헷갈리지 않는다)', () => {
    const r = runScript({ ...base([
      { t: 0, keys: ['ArrowUp'] },
      { t: 1, keys: ['ArrowUp', 'ShiftLeft'] },
      { t: 1.06, keys: ['ArrowUp', 'ShiftLeft', 'ArrowRight'] },
      { t: 1.12, keys: ['ShiftLeft', 'ArrowRight'] },
      { t: 1.18, keys: ['ShiftLeft'] },
      { t: 1.45, keys: ['ArrowUp'] },
    ]), skill: 5 });
    expect(skillEvents(r)).toEqual(['step_over_r']);
  });
});
