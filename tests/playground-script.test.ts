import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runScript, validateScript, type PlaygroundScript } from '../src/playground/Script';

const still = (scenario: PlaygroundScript['scenario'], opponent: PlaygroundScript['opponent'] = 'press'): PlaygroundScript => ({ scenario, seed: 318, duration: 6, opponent, inputs: [] });

it('같은 스크립트는 프레임·사건·요약이 완전히 같다', () => {
  const script = still('pressure');
  script.inputs = [{ t: 0, keys: ['ArrowUp'] }, { t: 1.2, keys: ['ArrowRight', 'KeyE'] }, { t: 2, tap: ['KeyD'] }];
  expect(runScript(script)).toEqual(runScript(script));
});

it('duel 압박은 정지한 소유자에게 3초 안에 1.5m 접근하고 6초 안에 태클한다', () => {
  const result = runScript(still('duel'));
  expect(result.frames.some((f) => f.t <= 3 && f.opponents[0].dist <= 1.5)).toBe(true);
  expect(result.summary.tackleAttempts).toBeGreaterThanOrEqual(1);
});

it('pressure 압박은 4초 안에 2명이 4m 안에 들어온다', () => {
  const result = runScript(still('pressure'));
  expect(result.frames.some((f) => f.t <= 4 && f.opponents.filter((o) => o.dist <= 4).length >= 2)).toBe(true);
});

it('stand 모드의 수비수는 움직이지 않는다', () => {
  const result = runScript(still('pressure', 'stand'));
  const initial = result.frames[0].opponents.map((o) => o.pos);
  for (const frame of result.frames) expect(frame.opponents.map((o) => o.pos)).toEqual(initial);
  expect(result.summary.tackleAttempts).toBe(0);
});

it('예제 전부 실행되고 요약 수치가 유한하다', () => {
  for (const file of readdirSync('playground/scripts').filter((name) => name.endsWith('.json'))) {
    const result = runScript(JSON.parse(readFileSync(`playground/scripts/${file}`, 'utf8')));
    expect(result.frames.length, file).toBeGreaterThan(1);
    const summary = result.summary;
    const numbers = [summary.possession, ...Object.values(summary.progress), ...Object.values(summary.alignment), summary.touches, summary.losses, summary.nearestOpponent, summary.tackleAttempts, summary.tackleSuccesses];
    expect(numbers.every(Number.isFinite), file).toBe(true);
  }
});

it('잘못된 키와 파라미터를 거절하고 유효한 상대 조작을 허용한다', () => {
  expect(() => validateScript({ ...still('duel'), inputs: [{ t: 0, keys: ['KeyM'] }] })).toThrow();
  expect(() => validateScript({ ...still('duel'), params: { 'DRIBBLE.touchPeriod': 99 } })).toThrow();
  expect(runScript({ ...still('duel'), control: 'opponent' }).frames[0].user.pos).toBeDefined();
});
