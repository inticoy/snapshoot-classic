import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SKILLS, SkillInput, type Dir, type SkillDef } from '../src/gameplay/Skills';
import { runScript } from '../src/playground/Script';
import { COMMANDS, skillScript } from './fixtures/skill-commands';
import { simulation, parkPlayers } from './helpers';

const dt = 1 / 120;
const directions: Dir[] = ['F', 'FR', 'R', 'BR', 'B', 'BL', 'L', 'FL'];

describe('1차 커맨드 전수 교차 검사', () => {
  it.each(COMMANDS.filter((c) => !c.fake))('$id만 정확히 한 번 인식', (c) => {
    for (const yaw of [0, Math.PI / 2, -Math.PI * 0.7]) {
      const input = new SkillInput();
      const found: string[] = [];
      const facing = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const right = new THREE.Vector3(-facing.z, 0, facing.x);
      const tick = (dir: Dir | null, secs: number, modifier = true) => {
        const angle = dir ? directions.indexOf(dir) * Math.PI / 4 : 0;
        const move = dir ? facing.clone().multiplyScalar(Math.cos(angle)).addScaledVector(right, Math.sin(angle)) : new THREE.Vector3();
        for (let t = 0; t < secs - 1e-9; t += dt) {
          const def = input.update(dt, modifier && !c.modifier, modifier && !!c.modifier, move, facing, SKILLS);
          if (def) found.push(def.id);
        }
      };
      tick(null, 0.05);
      for (const [i, dir] of c.dirs.entries()) {
        if (i && c.dirs[i - 1] === dir) tick(null, 0.05);
        tick(dir, c.hold ? 1.8 : 0.06);
      }
      tick(null, 0.3, false);
      expect(found, `${c.id} yaw=${yaw}`).toEqual([c.id]);
    }
  });
  it('힐 플릭의 탭을 길게 누르거나 끊어진 커맨드는 발동하지 않는다', () => {
    const input = new SkillInput();
    const fwd = new THREE.Vector3(1, 0, 0);
    const found = [];
    for (const [move, duration] of [[fwd, 0.5], [fwd.clone().negate(), 0.1], [new THREE.Vector3(), 0.6]] as const) {
      for (let t = 0; t < duration; t += dt) {
        const def = input.update(dt, true, false, move, fwd, SKILLS);
        if (def) found.push(def.id);
      }
    }
    expect(found).toEqual([]);
  });
});

describe('실제 Input → Match → 물리 개인기 전수', () => {
  it.each(COMMANDS)('$id: 이벤트 1회·소유 유지·종료 방향', (c) => {
    const def = SKILLS.find((s) => s.id === c.id)!;
    const r = runScript(skillScript(c));
    const events = r.events.filter((e) => e.type === 'skill');
    expect(events.map((e) => e.id)).toEqual([c.id]);
    expect(r.summary.losses).toBe(0);
    expect(r.summary.possession).toBeGreaterThan(0.99);
    const endTime = events[0].t + def.duration - dt;
    const end = r.frames.find((f) => f.t + 1e-6 >= endTime)!;
    // 입력을 떼고 종료한 순간의 몸·공 벡터를 시작(+X) 기준 의도와 비교한다.
    const expected = new THREE.Vector3(Math.cos(def.exit.dir), 0, Math.sin(def.exit.dir));
    if (!c.hold) {
      expect(new THREE.Vector3(...end.user.facing).dot(expected)).toBeGreaterThan(0.95);
      if (def.exit.speed > 1) expect(new THREE.Vector3(...end.ball.vel).setY(0).normalize().dot(expected)).toBeGreaterThan(0.9);
    } else {
      const sign = c.id.endsWith('_r') ? 1 : -1;
      const beforeRelease = r.frames.find((f) => f.t >= 2.25)!;
      expect(beforeRelease.user.pos[2] * sign).toBeGreaterThan(1.4);
      expect(beforeRelease.ball.pos[2] * sign).toBeGreaterThan(1.4);
      const afterRelease = r.frames.find((f) => f.t >= 2.4)!;
      expect(afterRelease.user.facing[0]).toBeGreaterThan(0.95);
      expect(Math.abs(afterRelease.user.vel[2])).toBeLessThan(0.5);
    }
    if (c.id === 'ball_lift') expect(Math.max(...r.frames.map((f) => f.ball.pos[1]))).toBeGreaterThan(0.7);
  });
  it('사이드 스텝은 오래 누를수록 옆으로 더 가며 방향을 바꾸면 끝난다', () => {
    const c = COMMANDS.find((c) => c.id === 'side_step_r')!;
    const short = runScript(skillScript(c, 0.6));
    const long = runScript(skillScript(c, 2.4));
    expect(long.frames.at(-1)!.user.pos[2] - short.frames.at(-1)!.user.pos[2]).toBeGreaterThan(1.5);
    const script = skillScript(c, 2.4);
    script.inputs.push({ t: 1.4, keys: ['ShiftLeft', 'ArrowUp'] });
    script.inputs.sort((a, b) => a.t - b.t);
    const changed = runScript(script);
    expect(changed.events.filter((e) => e.type === 'skill').map((e) => e.id)).toEqual(['side_step_r']);
    const at = (t: number) => changed.frames.find((f) => f.t >= t)!;
    expect(at(1.6).user.pos[2] - at(1.4).user.pos[2]).toBeLessThan(0.2);
  });
  it('선수 별 제한과 같은 커맨드 하위 후보', () => {
    const { match } = simulation(); parkPlayers(match);
    const p = match.controlled;
    p.actionLock = 0; p.pos.set(0, 0, 0); p.facing.set(1, 0, 0);
    match.ball.reset(0.4, 0); match.ball.owner = p;
    const original = p.profile;
    Object.defineProperty(p, 'profile', { value: { ...original, skill: 1 }, configurable: true });
    expect(match.startSkill(p, 'step_over_r')).toBe(false);
    Object.defineProperty(p, 'profile', { value: { ...original, skill: 2 }, configurable: true });
    expect(match.startSkill(p, 'heel_flick')).toBe(false);
    const low = SKILLS.find((s) => s.id === 'feint_exit_l')!;
    const high: SkillDef = { ...low, id: 'future_high', stars: 5 };
    Object.defineProperty(p, 'profile', { value: { ...original, skill: 3 }, configurable: true });
    expect(match.skills.start(p, high)).toBe(true);
    expect(match.skills.current(p)?.id).toBe(low.id);
  });
});
