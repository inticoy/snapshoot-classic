import { settings } from '../src/core/Settings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import { Playground } from '../src/playground/Playground';
import { DRIBBLE, PHYSICS, PLAYGROUND } from '../src/config';
import { MOTION_SELECT } from '../src/anim/MotionLibrary';
import { parameterSnapshot } from '../src/playground/Parameters';
import { Input } from '../src/core/Input';
import { SKILLS } from '../src/gameplay/Skills';
import { PlaygroundScenarios } from '../src/playground/Scenarios';
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


it.each(['input', 'textarea', 'select', 'div'])('%s 편집 포커스에서는 게임 키와 R을 처리하지 않는다', (tag) => {
  const input = new Input();
  const editor = document.createElement(tag);
  if (tag === 'div') editor.setAttribute('contenteditable', 'true');
  document.body.append(editor);
  editor.focus();
  for (const code of ['ArrowUp', 'KeyD', 'KeyR', 'Space']) {
    const event = new win.KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    editor.dispatchEvent(event as unknown as Event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
  expect(input.isDown('shoot')).toBe(false);
  expect(input.drainPresses()).toEqual([]);
});

const demo = (id: string) => (window as unknown as { __skillDemo(id: string): boolean }).__skillDemo(id);

it('잘못된 시범 id는 상태를 바꾸지 않고 false를 반환한다', () => {
  step();
  expect(demo('missing')).toBe(false);
  expect(pg.records).toHaveLength(1);
});

it('시범은 원래 능력치를 유지하고 스크립트 임시 능력치는 리셋으로 복구한다', () => {
  const p = match.controlled, profile = p.profile;
  expect(demo('roulette_r')).toBe(true);
  expect(p.profile).toBe(profile);
  pg.reset('slide');
  expect(p.profile).toBe(profile);
  pg.run({ scenario: 'free', seed: 42, skill: 1, duration: 0.1, inputs: [] });
  expect(p.profile.skill).toBe(1);
  pg.reset();
  expect(p.profile).toBe(profile);
});

it.each(['reset', 'scenario', 'R', 'script', 'move'])('%s는 반복 시범을 취소한다', (action) => {
  document.querySelector<HTMLInputElement>('#pg-repeat')!.checked = true;
  demo('roulette_r');
  if (action === 'reset') pg.reset();
  if (action === 'scenario') pg.reset('duel');
  if (action === 'R') window.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyR' }) as unknown as Event);
  if (action === 'script') pg.run({ scenario: 'free', seed: 42, duration: 0.1, inputs: [] });
  const start = vi.spyOn(match.skills, 'start');
  for (let i = 0; i < 400; i++) {
    const cmd = command();
    if (action === 'move') cmd.move.set(1, 0, 0);
    match.update(PHYSICS.step, cmd);
    pg.step(PHYSICS.step, cmd);
    match.events.length = 0;
  }
  expect(start).not.toHaveBeenCalled();
});

it('토스트는 같은 시범 이벤트로 연장되지 않고 실시간에 만료된다', () => {
  const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
  demo('roulette_r');
  now.mockReturnValue(2000);
  pg.step(0.001, command());
  expect(document.querySelector('.pg-toast')!.classList.contains('show')).toBe(true);
  now.mockReturnValue(2601);
  pg.step(0.001, command());
  expect(document.querySelector('.pg-toast')!.classList.contains('show')).toBe(false);
});

it('기록은 개인기 방향을 복사하고 실제 스크립트 시드를 보존한다', () => {
  pg.run({ scenario: 'free', seed: 42, duration: 0.1, inputs: [] });
  const cmd = command();
  cmd.skillMove = cmd.move.clone().set(1, 0, 0);
  pg.step(PHYSICS.step, cmd);
  cmd.skillMove.set(0, 0, 1);
  expect(pg.records[0]).toMatchObject({ seed: 42, input: { skillMove: [1, 0, 0] } });
});

it('같은 커맨드의 상위 별 개인기를 줄 아래 안내한다', () => {
  for (const id of ['feint_exit_l', 'feint_exit_r', 'stop_turn_r']) {
    expect(button(`[data-demo="${id}"]`).closest('li')!.textContent).toMatch(/★[45] 선수는/);
  }
});

it('터치 기기는 패널이 접힌 채 시작하고 개인기 스틱 기준으로 안내한다', () => {
  document.body.replaceChildren();
  document.documentElement.classList.add('touch-device');
  pg = new Playground(match, vi.fn(), view);
  expect(document.querySelector<HTMLDetailsElement>('#playground')!.open).toBe(false);
  const panel = document.querySelector('[data-panel="skills"]')!;
  expect(panel.querySelector('.pg-help')!.textContent).toContain('개인기 스틱');
  expect(panel.textContent).not.toContain('Shift');
  expect(panel.querySelector('code')!.textContent).toBe('슛 게이지 중 패스');
});

it('기록은 고정 용량의 시간순 링이며 설정은 변경 시에만 새 스냅샷을 쓴다', () => {
  const seconds = PLAYGROUND.recordSeconds;
  try {
    PLAYGROUND.recordSeconds = PHYSICS.step * 3;
    for (let i = 0; i < 5; i++) step();
    expect(pg.records).toHaveLength(3);
    expect(pg.records.map((r) => r.time)).toEqual([3, 4, 5].map((n) => n * PHYSICS.step));
    expect(pg.records[0].settings).toBe(pg.records[2].settings);
    const before = settings.shootout;
    const previous = pg.records[2].settings;
    try {
      settings.shootout = !before;
      step();
      expect(pg.records[2].settings).not.toBe(previous);
      expect(previous).toMatchObject({ shootout: before });
      expect(pg.records[2].settings).toMatchObject({ shootout: !before });
    } finally { settings.shootout = before; }
    pg.reset();
    expect(pg.records).toHaveLength(0);
  } finally { PLAYGROUND.recordSeconds = seconds; }
});

it.each([
  ['stars', '별이 부족'], ['distance', '너무 멀'], ['height', '너무 높'], ['busy', '동작 중'],
] as const)('개인기 실패 %s 이벤트를 토스트로 표시하고 판정 상태는 바꾸지 않는다', (reason, message) => {
  const before = match.ball.position.clone();
  match.events.push({ type: 'skillFail', id: 'drag_back', player: match.controlled, reason });
  pg.step(PHYSICS.step, command());
  expect(document.querySelector('.pg-toast')!.textContent).toContain(message);
  expect(match.ball.position).toEqual(before);
});

it('직접 입력 방향 시퀀스를 표시하며 공이 멀어도 실패 안내를 낸다', () => {
  const cmd = command();
  cmd.skill = { held: false, pressed: false, released: false };
  pg.step(PHYSICS.step, cmd);
  cmd.skill.held = true;
  cmd.skillMove = cmd.move.clone().set(0, 0, 1);
  pg.step(PHYSICS.step, cmd);
  expect(document.querySelector('#pg-skill-sequence')!.textContent).toContain('→');
  cmd.skill.held = false;
  cmd.skillMove.set(0, 0, 0);
  match.ball.reset(30, 30);
  pg.step(PHYSICS.step, cmd);
  expect(document.querySelector('.pg-toast')!.textContent).toContain('너무 멀');
});


it('시범은 직접 실행과 같은 실제 별 보정 속도·궤적으로 진행한다', () => {
  const def = SKILLS.find((s) => s.starScale && s.stars < match.controlled.profile.skill && !s.sustained)!;
  expect(def).toBeDefined();
  const direct = simulation(318, { practice: true, kickMotion: true }).match;
  new PlaygroundScenarios(direct).reset('free');
  expect(direct.skills.start(direct.controlled, def)).toBe(true);
  expect(demo(def.id)).toBe(true);
  const expected = def.duration / (1 + def.starScale! * (match.controlled.profile.skill - def.stars));
  expect(match.controlled.actionLock).toBeCloseTo(expected);
  expect(match.controlled.actionLock).toBe(direct.controlled.actionLock);
  for (let i = 0; i < Math.ceil(def.duration / PHYSICS.step) + 5; i++) {
    match.update(PHYSICS.step, command());
    direct.update(PHYSICS.step, command());
    expect(match.skills.current(match.controlled)?.id).toBe(direct.skills.current(direct.controlled)?.id);
    expect(match.controlled.pos.toArray()).toEqual(direct.controlled.pos.toArray());
    expect(match.ball.position.toArray()).toEqual(direct.ball.position.toArray());
    match.events.length = direct.events.length = 0;
  }
});

it('별이 부족한 시범은 하위 기술로 바꾸지 않고 필요한 별을 안내한다', () => {
  const profile = match.controlled.profile;
  const def = SKILLS.find((s) => s.stars > profile.skill)!;
  expect(def).toBeDefined();
  document.querySelector<HTMLInputElement>('#pg-repeat')!.checked = true;
  expect(demo(def.id)).toBe(false);
  expect(match.controlled.profile).toBe(profile);
  expect(match.skills.current(match.controlled)).toBeNull();
  expect(document.querySelector('#pg-demo-rating')!.textContent).toContain(`${def.stars}성 이상이 필요해요`);
  const start = vi.spyOn(match.skills, 'start');
  for (let i = 0; i < 200; i++) pg.step(PHYSICS.step, command());
  expect(start).not.toHaveBeenCalled();
});

it('개인기 수비 옵션은 실제 AI로 압박하고 시범·R 뒤 같은 상태를 재현하며 해제할 수 있다', () => {
  const toggle = document.querySelector<HTMLInputElement>('#pg-skill-defender')!;
  toggle.click();
  expect(pg.scenarios.current).toBe('duel');
  expect(match.practiceOpponent).toBe('press');
  expect(match.players).toHaveLength(2);
  const defender = match.players.find((p) => p.team === 1)!;
  const initialDistance = defender.pos.distanceTo(match.controlled.pos);
  const run = () => {
    for (let i = 0; i < 60; i++) {
      match.update(PHYSICS.step, command());
      pg.step(PHYSICS.step, command());
      match.events.length = 0;
    }
    return { players: match.players.map((p) => p.pos.toArray()), ball: match.ball.position.toArray() };
  };
  const first = run();
  expect(defender.pos.distanceTo(match.controlled.pos)).toBeLessThan(initialDistance - 1);
  window.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyR' }) as unknown as Event);
  expect(toggle.checked).toBe(true);
  expect(match.elapsed).toBe(0);
  expect(match.players).toHaveLength(2);
  expect(run()).toEqual(first);
  expect(demo('roulette_r')).toBe(true);
  expect(match.players).toHaveLength(2);
  expect(match.practiceOpponent).toBe('press');
  pg.reset();
  expect(run()).toEqual(first);
  toggle.click();
  expect(pg.scenarios.current).toBe('free');
  expect(match.players).toHaveLength(1);
  expect(demo('roulette_r')).toBe(true);
  expect(match.players).toHaveLength(1);
});
