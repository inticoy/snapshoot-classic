import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runScript, runScriptAsync, validateScript, type PlaygroundScript } from '../src/playground/Script';

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
  expect(result.summary.opponentTackles).toBe(result.summary.tackleAttempts);
  expect(result.summary.userTackles).toBe(0);
});

it('연습 압박 수비는 움직이는 소유자의 공 쪽에 접근해도 몸 간격 0.6m를 지킨다', () => {
  const script = still('pressure');
  script.inputs = [{ t: 0, keys: ['ArrowUp'] }, { t: 1.5, keys: ['ArrowLeft', 'KeyE'] }, { t: 3, keys: ['ArrowUp', 'KeyE'] }];
  const result = runScript(script);
  expect(result.frames.flatMap((f) => f.opponents.map((o) => o.dist)).every((d) => d >= 0.6)).toBe(true);
  expect(result.summary.nearestOpponent).not.toBeNull();
  expect(result.summary.nearestOpponent!).toBeGreaterThanOrEqual(0.6);
});

it('상대가 없으면 최단 거리는 null이고 사용자 슬라이딩은 사용자 태클로 센다', () => {
  const free = runScript(still('free'));
  expect(free.summary.nearestOpponent).toBeNull();
  expect(free.summary.firstWithin2m).toBeNull();
  const slide = runScript({ ...still('slide'), duration: 4, inputs: [{ t: 0, keys: ['ArrowUp'] }, { t: 1, keys: ['ArrowUp'], tap: ['KeyA'] }, { t: 2, keys: [] }] });
  expect(slide.summary.userTackles).toBe(1);
  expect(slide.summary.opponentTackles).toBe(0);
  expect(slide.summary.tackleAttempts).toBe(1);
});

it('개인기 요약은 실행된 id별 횟수를 센다', () => {
  const script = { ...still('free'), seed: 5, duration: 3, inputs: [
    { t: 0, keys: ['ArrowUp'] },
    { t: 1, keys: ['ArrowUp', 'ShiftLeft'] },
    { t: 1.05, keys: ['ArrowRight', 'ShiftLeft'] },
    { t: 1.15, keys: ['ShiftLeft'] },
    { t: 1.35, keys: ['ArrowUp'] },
  ] };
  const result = runScript(script);
  expect(result.summary.skills).toEqual({ feint_r: 1 });
  expect(result.events.filter((event) => event.type === 'skill')).toHaveLength(1);
  const drag = runScript({ ...still('free'), seed: 5, duration: 2.2, inputs: [
    { t: 0, keys: ['ArrowUp'] }, { t: 1, keys: ['KeyZ', 'ArrowDown'] }, { t: 1.25, keys: [] },
  ] });
  expect(drag.summary.skills).toEqual({ drag_back: 1 });
  expect(runScript(still('free')).summary.skills).toEqual({});
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
    const numbers = [summary.possession, ...Object.values(summary.progress), ...Object.values(summary.alignment), summary.touches, summary.losses, summary.tackleAttempts, summary.userTackles, summary.opponentTackles, summary.tackleSuccesses, ...Object.values(summary.skills)];
    if (summary.nearestOpponent !== null) numbers.push(summary.nearestOpponent);
    expect(numbers.every(Number.isFinite), file).toBe(true);
    expect(summary.tackleAttempts, file).toBe(summary.userTackles + summary.opponentTackles);
  }
});

it('잘못된 키와 파라미터를 거절하고 유효한 상대 조작을 허용한다', () => {
  expect(() => validateScript({ ...still('duel'), inputs: [{ t: 0, keys: ['KeyM'] }] })).toThrow('keys 키가 올바르지 않아요');
  expect(() => validateScript({ ...still('duel'), params: { 'DRIBBLE.touchPeriod': 99 } })).toThrow('파라미터 값을 확인해요: DRIBBLE.touchPeriod');
  expect(runScript({ ...still('duel'), control: 'opponent' }).frames[0].user.pos).toBeDefined();
});

it('청크 실행은 양보 중 파라미터를 복원하며 동기 실행과 프레임·이벤트·요약이 같다', async () => {
  const { DRIBBLE } = await import('../src/config');
  const original = DRIBBLE.leadWalk;
  const script = { ...still('pressure'), params: { 'DRIBBLE.leadWalk': 0.6 } };
  const expected = runScript(script);
  const progress: number[] = [];
  let yielded = false;
  const timer = setTimeout(() => { yielded = true; }, 0);
  try {
    const actual = await runScriptAsync(script, (value) => {
      expect(DRIBBLE.leadWalk).toBe(original);
      progress.push(value);
    });
    expect(yielded).toBe(true);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBeGreaterThan(2);
    expect(actual).toEqual(expected);
  } finally { clearTimeout(timer); }
});
