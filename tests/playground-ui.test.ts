import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import { Playground } from '../src/playground/Playground';
import { DRIBBLE, PHYSICS } from '../src/config';
import { MOTION_SELECT } from '../src/anim/MotionLibrary';
import { parameterSnapshot } from '../src/playground/Parameters';
import { Input } from '../src/core/Input';
import { command, simulation } from './helpers';

let win: HappyWindow;
let pg: Playground;
let match: ReturnType<typeof simulation>['match'];
const original = parameterSnapshot();
beforeEach(() => {
  // 모델·물리를 먼저 만들고 화면 패널에만 DOM을 제공한다. WebGL·캔버스 렌더링 검증을 대신하지 않는다.
  match = simulation(318, { practice: true, kickMotion: true }).match;
  win = new HappyWindow();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', win.document);
  vi.stubGlobal('HTMLInputElement', win.HTMLInputElement);
  vi.stubGlobal('HTMLTextAreaElement', win.HTMLTextAreaElement);
  vi.spyOn(win.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  } as never);
  view = { setSpeed: vi.fn(), setCloseUp: vi.fn() };
  pg = new Playground(match, vi.fn(), view);
});
afterEach(async () => {
  Object.assign(DRIBBLE, original.DRIBBLE);
  Object.assign(MOTION_SELECT, original.MOTION_SELECT);
  await win.happyDOM.abort();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
let view: { setSpeed: ReturnType<typeof vi.fn>; setCloseUp: ReturnType<typeof vi.fn> };
const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;
const step = () => {
  const cmd = command();
  cmd.move.set(1, 0, 0);
  match.update(PHYSICS.step, cmd);
  pg.step(PHYSICS.step, cmd);
  match.events.length = 0;
};

it('6개 버튼은 같은 Match의 시나리오를 바꾸고 R은 기록까지 초기화한다', () => {
  for (const id of ['duel', 'pressure', 'receive', 'slide', 'keeper', 'free']) {
    button(`[data-scenario="${id}"]`).click();
    expect(pg.scenarios.current).toBe(id);
    expect(button(`[data-scenario="${id}"]`).getAttribute('aria-pressed')).toBe('true');
  }
  step();
  expect(pg.records).toHaveLength(1);
  window.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyR' }) as unknown as Event);
  expect(match.elapsed).toBe(0);
  expect(pg.records).toHaveLength(0);
  expect(pg.latest).toBeNull();
});

it('슬라이더는 즉시 적용되고 기록된 과거 파라미터는 바뀌지 않는다', () => {
  step();
  const previous = pg.records[0];
  const input = document.querySelector<HTMLInputElement>('[data-param="leadWalk"]')!;
  input.value = '0.6';
  input.dispatchEvent(new win.Event('input') as unknown as Event);
  expect(DRIBBLE.leadWalk).toBe(0.6);
  step();
  expect(previous.parameters).toMatchObject({ DRIBBLE: { leadWalk: original.DRIBBLE.leadWalk } });
  expect(pg.records[1].parameters).toMatchObject({ DRIBBLE: { leadWalk: 0.6 } });
  button('#pg-reset').click();
  expect(DRIBBLE.leadWalk).toBe(0.6);
  button('#pg-defaults').click();
  expect(parameterSnapshot()).toEqual(original);
});

it('슬라이더 방향키는 경기 이동 입력으로 새지 않으며 일반 방향키는 계속 동작한다', () => {
  const input = new Input();
  document.querySelector('[data-param="leadWalk"]')!.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }) as unknown as Event);
  expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
  window.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'ArrowRight' }) as unknown as Event);
  expect(input.moveAxis()).toEqual({ x: 1, y: 0 });
});

it('기록은 매 스텝 입력·선수·공·설정을 담고 수치 패널은 주기적으로 갱신된다', () => {
  for (let i = 0; i < 30; i++) step();
  expect(pg.records).toHaveLength(30);
  expect(pg.records[0]).toMatchObject({ input: { move: [1, 0], sprint: false }, state: { controlled: expect.any(String), players: expect.any(Array), ballPosition: expect.any(Array) }, settings: { moveAssist: expect.any(String) } });
  expect(document.querySelector('[data-metric="playerSpeed"]')!.textContent).not.toBe('—');
  expect(pg.records[29].time).toBeCloseTo(30 * PHYSICS.step);
  expect(pg.latest?.playerSpeed).toBeGreaterThan(1);
});

it('스크립트 실행은 결과를 노출하고 같은 입력을 화면 Match에 재생한다', () => {
  const result = pg.run({ scenario: 'duel', seed: 42, duration: 1, opponent: 'stand', inputs: [{ t: 0, keys: ['ArrowUp'] }] });
  expect(result.frames.length).toBeGreaterThan(1);
  expect(button('#pg-script-download').disabled).toBe(false);
  expect(pg.scenarios.current).toBe('duel');
  const cmd = pg.commandForStep()!;
  expect(cmd.move.x).toBe(1);
  match.update(PHYSICS.step, cmd);
  pg.endScriptStep();
  expect(match.elapsed).toBeCloseTo(PHYSICS.step);
  expect(match.practiceOpponent).toBe('stand');
});

it('Tab은 상대 수비수 조작을 전환하고 상대 모드 선택을 유지한다', () => {
  button('[data-scenario="duel"]').click();
  document.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Tab', bubbles: true }) as unknown as Event);
  expect(match.controlled.team).toBe(1);
  expect(match.practiceControlLocked).toBe(true);
  const select = document.querySelector<HTMLSelectElement>('#pg-opponent')!;
  select.value = 'stand';
  select.dispatchEvent(new win.Event('change') as unknown as Event);
  expect(match.practiceOpponent).toBe('stand');
});

describe('개인기 탭', () => {
  it('목록에 헛다리·위아래·마르세유·사포가 커맨드와 함께 있고 ▶로 시범을 낸다', () => {
    const text = document.querySelector('[data-panel="skills"]')!.textContent!;
    for (const nick of ['헛다리', '위아래', '마르세유', '사포']) expect(text).toContain(nick);
    expect(text).toContain('Shift + ↑↓ (짧게)');
    button('[data-demo="roulette_r"]').click();
    expect(match.skills.current(match.controlled)?.id).toBe('roulette_r');
    match.update(PHYSICS.step, command());
    pg.step(PHYSICS.step, command());
    expect(document.querySelector('#pg-last-skill')!.textContent).toBe('오른쪽 룰렛');
  });

  it('느린 화면·카메라 버튼이 화면 조작으로 이어지고, 다른 탭으로 가면 원래대로', () => {
    button('[data-speed="0.25"]').click();
    expect(view.setSpeed).toHaveBeenLastCalledWith(0.25);
    button('[data-view="front"]').click();
    expect(view.setCloseUp.mock.lastCall![0].angle).toBeCloseTo(Math.PI / 2);
    button('[data-tab="drills"]').click();
    expect(view.setSpeed).toHaveBeenLastCalledWith(1);
    expect(view.setCloseUp).toHaveBeenLastCalledWith(null, false);
  });
});

