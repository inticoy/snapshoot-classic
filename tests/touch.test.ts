import { afterEach, expect, it, vi } from 'vitest';
import { GRAPHICS, PHYSICS, PITCH, TOUCH } from '../src/config';
import { Input } from '../src/core/Input';
import { TouchInput, touchBinding, type TouchMode, type TouchSlot } from '../src/core/TouchInput';
import { cycleGraphics, graphicsQuality, settings } from '../src/core/Settings';
import { command, parkPlayers, simulation } from './helpers';

const defaults = { ...settings };
afterEach(() => { Object.assign(settings, defaults); vi.unstubAllGlobals(); });

function controls(onCancel = () => {}) {
  const target = new EventTarget();
  const input = new Input(target as unknown as Window);
  return { target, input, touch: new TouchInput(input, onCancel) };
}

function fixture() {
  const { match } = simulation(42);
  parkPlayers(match);
  const player = match.forward(0);
  player.actionLock = 0;
  player.pos.set(15, 0, 0);
  player.facing.set(1, 0, 0);
  match.ball.reset(15.35, 0);
  match.ball.owner = match.ball.lastTouch = player;
  match.controlled = player;
  const { input, touch } = controls(() => match.cancelUserCharge());
  const cmd = command();
  const step = () => {
    const axis = input.moveAxis();
    cmd.move.set(axis.y, 0, axis.x);
    cmd.sprint = input.isDown('sprint');
    for (const kind of ['shoot', 'pass', 'through', 'lob', 'modifier', 'finesse', 'tackle', 'contain'] as const) cmd[kind] = input.button(kind);
    match.update(PHYSICS.step, cmd);
    input.endFrame();
  };
  return { match, player, input, touch, step };
}

it('플로팅 조이스틱은 데드존·아날로그 크기·대각선 제한을 적용하고 첫 손가락만 따른다', () => {
  const { input, touch } = controls();
  expect(touch.startMove(1, 120, 240)).toBe(true);
  expect(touch.startMove(2, 160, 260)).toBe(false);
  touch.move(1, 122, 240);
  expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
  touch.move(1, 120 + TOUCH.joystickRadius / 2, 240);
  expect(input.moveAxis().x).toBeGreaterThan(0.4);
  expect(input.moveAxis().x).toBeLessThan(0.5);
  touch.move(2, 10, 10);
  expect(input.moveAxis().y).toBe(0);
  touch.move(1, 500, -100);
  expect(Math.hypot(...Object.values(input.moveAxis()))).toBeCloseTo(1, 12);
  expect(input.moveAxis().y).toBeGreaterThan(0);
  touch.end(1, 500, -100);
  expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
  expect(touch.joystick).toBeNull();
});

it('이동+질주+슛 멀티터치는 서로 독립적이며 키보드와 함께 합쳐진다', () => {
  const { target, input, touch } = controls();
  touch.startMove(1, 100, 200);
  touch.move(1, 150, 180);
  touch.startButton(2, 'sprint', 650, 300);
  touch.startButton(3, 'shoot', 750, 230);
  expect(input.button('shoot')).toEqual({ held: true, pressed: true, released: false });
  input.endFrame();
  touch.end(3, 750, 230);
  expect(input.button('shoot')).toEqual({ held: false, pressed: false, released: true });
  expect(input.isDown('sprint')).toBe(true);
  expect(input.moveAxis().x).toBeGreaterThan(0);
  const key = new Event('keydown');
  Object.defineProperties(key, { code: { value: 'KeyE' }, repeat: { value: false } });
  target.dispatchEvent(key);
  touch.end(2, 650, 300);
  expect(input.button('sprint').held).toBe(true);
  expect(input.button('sprint').released).toBe(false);
  touch.reset();
  expect(input.isDown('sprint')).toBe(true);
  const up = new Event('keyup');
  Object.defineProperty(up, 'code', { value: 'KeyE' });
  target.dispatchEvent(up);
  expect(input.button('sprint')).toEqual({ held: false, pressed: true, released: true });
});

it('같은 동작의 두 손가락 중 마지막 손가락을 뗄 때만 release가 생긴다', () => {
  const { input, touch } = controls();
  touch.startButton(1, 'shoot', 700, 200);
  touch.startButton(2, 'shoot', 700, 200);
  input.endFrame();
  touch.end(1, 700, 200);
  expect(input.button('shoot')).toEqual({ held: true, pressed: false, released: false });
  touch.end(2, 700, 200);
  expect(input.button('shoot').released).toBe(true);
});

it.each([
  ['attack', 'shoot', 'shoot', '슛'], ['attack', 'pass', 'pass', '패스'],
  ['attack', 'through', 'through', '스루'], ['attack', 'lob', 'lob', '로빙'],
  ['defence', 'shoot', 'shoot', '압박'], ['defence', 'pass', 'pass', '선수 변경'],
  ['defence', 'through', 'tackle', '스탠딩 태클'], ['defence', 'lob', 'lob', '슬라이딩'],
  ['throwin', 'pass', 'pass', '짧은 스로인'], ['throwin', 'lob', 'lob', '롱 스로인'],
  ['corner', 'lob', 'lob', '크로스'], ['goalkick', 'lob', 'lob', '롱킥'],
] as const)('%s의 %s 버튼은 키보드와 같은 %s 명령을 만든다', (mode, slot, action, label) => {
  const { input, touch } = controls();
  touch.setMode(mode as TouchMode);
  expect(touchBinding(mode, slot as TouchSlot)).toEqual({ action, label });
  touch.startButton(7, slot, 700, 200);
  expect(input.button(action).pressed).toBe(true);
  touch.end(7, 700, 200);
  expect(input.button(action).released).toBe(true);
});

it.each([
  [0, -45, 'chip'], [45, 0, 'finesse'], [-45, 0, 'finesse'], [4, -5, 'normal'], [0, 45, 'normal'],
] as const)('슛을 %s,%s로 스와이프하면 실제 경기에서 %s 슛이 한 번 발생한다', (dx, dy, kind) => {
  const { match, input, touch, step } = fixture();
  touch.startButton(2, 'shoot', 740, 210);
  for (let i = 0; i < 36; i++) step();
  expect(match.charge?.value).toBeGreaterThan(0.3);
  touch.end(2, 740 + dx, 210 + dy);
  // 포인터를 뗀 뒤 다음 렌더 프레임까지 제스처가 유지된다.
  expect(input.isDown('modifier')).toBe(kind === 'chip');
  expect(input.isDown('finesse')).toBe(kind === 'finesse');
  step();
  expect(match.stats.shots[0]).toBe(1);
  expect(match.events.some((e) => e.type === 'kick')).toBe(true);
  expect(match.events.filter((e) => e.type === 'kick')).toMatchObject([
    { kind: kind === 'chip' ? 'chipShot' : kind === 'finesse' ? 'finesseShot' : 'shot' },
  ]);
  expect(input.isDown('modifier')).toBe(false);
  expect(input.isDown('finesse')).toBe(false);
  for (let i = 0; i < 10; i++) step();
  expect(match.stats.shots[0]).toBe(1);
});

it('조이스틱 이동으로 실제 선수가 움직이며 슛을 동시에 차지할 수 있다', () => {
  const { player, match, input, touch, step } = fixture();
  const start = player.pos.clone();
  touch.startMove(1, 120, 230);
  touch.move(1, 120, 170);
  touch.startButton(2, 'shoot', 740, 210);
  for (let i = 0; i < 36; i++) step();
  expect(player.pos.distanceTo(start)).toBeGreaterThan(0.2);
  expect(match.charge?.value).toBeGreaterThan(0.3);
  touch.end(2, 740, 210);
  step();
  expect(match.stats.shots[0]).toBe(1);
  expect(input.moveAxis().y).toBe(1);
});

it('포인터 취소·회전·메뉴 진입의 공통 초기화는 진행 중인 차지를 발사하지 않는다', () => {
  const { match, input, touch, step } = fixture();
  touch.startMove(1, 120, 230);
  touch.move(1, 160, 230);
  touch.startButton(2, 'shoot', 740, 210);
  for (let i = 0; i < 24; i++) step();
  touch.reset();
  expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
  expect(input.button('shoot')).toEqual({ held: false, pressed: false, released: false });
  step();
  expect(match.charge).toBeNull();
  expect(match.stats.shots[0]).toBe(0);
  touch.end(2, 740, 160);
  step();
  expect(match.stats.shots[0]).toBe(0);
});

it('공격/수비 전환은 누르던 버튼만 취소하고 조이스틱 이동을 유지한다', () => {
  const { input, touch } = controls();
  touch.startMove(1, 120, 230);
  touch.move(1, 170, 230);
  const axis = input.moveAxis();
  touch.startButton(2, 'through', 740, 210);
  touch.startButton(4, 'sprint', 640, 210);
  touch.setMode('defence');
  expect(input.isDown('sprint')).toBe(true);
  expect(input.moveAxis()).toEqual(axis);
  expect(input.button('through')).toEqual({ held: false, pressed: false, released: false });
  expect(input.button('tackle').pressed).toBe(false);
  touch.end(2, 740, 210);
  touch.startButton(3, 'through', 740, 210);
  expect(input.button('tackle').pressed).toBe(true);
});

it('짧은 탭도 고정 스텝 사이 엣지를 보존해 한 번의 슛을 만든다', () => {
  const { match, touch, step } = fixture();
  touch.startButton(2, 'shoot', 740, 210);
  touch.end(2, 740, 210);
  step();
  expect(match.stats.shots[0]).toBe(1);
});

it('모바일/저코어 자동 품질과 수동 품질을 순환·저장하며 렌더 예산을 낮춘다', () => {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { setItem });
  settings.graphicsQuality = 'auto';
  expect(graphicsQuality(true, 8)).toBe('low');
  expect(graphicsQuality(false, 4)).toBe('low');
  expect(graphicsQuality(false, 8)).toBe('high');
  cycleGraphics(1);
  expect(graphicsQuality(false, 8)).toBe('low');
  cycleGraphics(1);
  expect(graphicsQuality(true, 2)).toBe('high');
  cycleGraphics(1);
  expect(settings.graphicsQuality).toBe('auto');
  cycleGraphics(-1);
  expect(settings.graphicsQuality).toBe('high');
  expect(JSON.parse(setItem.mock.calls.at(-1)![1]).graphicsQuality).toBe('high');
  expect(GRAPHICS.low.shadowSize ** 2 / GRAPHICS.high.shadowSize ** 2).toBe(0.25);
  expect(GRAPHICS.low.crowdDensity).toBe(0.25);
  expect(GRAPHICS.low.pixelRatio).toBe(1.75);
});

it.each(['pass', 'through', 'lob'] as const)('터치 %s 차지·뗌이 실제 패스와 kick 이벤트를 만든다', (slot) => {
  const { match, touch, step } = fixture();
  touch.startButton(2, slot, 700, 210);
  for (let i = 0; i < 24; i++) step();
  expect(match.charge?.kind).toBe(slot);
  touch.end(2, 700, 210);
  step();
  expect(match.stats.passes[0]).toBe(1);
  expect(match.ball.owner).toBeNull();
  expect(match.events.some((event) => event.type === 'kick')).toBe(true);
});

it.each([['through', 'stand'], ['lob', 'slide']] as const)('수비의 %s 터치가 실제 %s 태클을 시작한다', (slot, kind) => {
  const { match, player, touch, step } = fixture();
  const opponent = match.forward(1);
  opponent.pos.set(18, 0, 0);
  match.ball.owner = opponent;
  match.ball.reset(18.35, 0);
  match.ball.owner = opponent;
  touch.setMode('defence');
  const tackle = vi.spyOn(player, 'startTackle');
  touch.startButton(2, slot, 700, 210);
  step();
  expect(tackle).toHaveBeenCalledOnce();
  expect(tackle.mock.calls[0][1]).toBe(kind);
  expect(match.stats.shots[0]).toBe(0);
});

for (const mode of ['throwin', 'corner', 'goalkick'] as const) {
  it.each(['pass', 'lob'] as const)(`사용자 ${mode}의 %s 버튼은 실제 세트피스를 재개한다`, (slot) => {
    const { match, input, touch, step } = fixture();
    match.ball.owner = null;
    if (mode === 'throwin') {
      match.ball.lastTouch = match.teams[1][1];
      match.ball.position.set(3, 0.11, PITCH.halfW + 1);
    } else {
      // +X 코너는 상대 수비의 터치, -X 골킥은 상대 공격의 터치다.
      match.ball.lastTouch = match.teams[1][1];
      match.ball.position.set((mode === 'corner' ? 1 : -1) * (PITCH.halfL + 1), 0.11, 8);
    }
    expect(match.setPieces.checkOut()).toBe(true);
    expect(match.setPieces.current).toMatchObject({ kind: mode, team: 0 });
    for (let i = 0; i < 2 / PHYSICS.step; i++) step();
    expect(match.phase).toBe('setpiece');
    touch.setMode(mode);
    touch.startMove(1, 120, 230);
    touch.move(1, 120, 178);
    touch.startButton(2, slot, 700, 210);
    for (let i = 0; i < 24; i++) step();
    expect(match.charge?.kind).toBe(slot);
    touch.end(2, 700, 210);
    step();
    expect(match.phase).toBe('playing');
    expect(match.setPieces.current).toBeNull();
    expect(match.events.some((event) => event.type === 'restart' && event.kind === mode)).toBe(true);
    expect(match.ball.speed()).toBeGreaterThan(3);
    expect(input.moveAxis().y).toBe(1);
  });
}

it('슛 release 직후 고정 스텝 전에 취소해도 탭이나 스와이프가 뒤늦게 발사되지 않는다', () => {
  const { match, touch, step } = fixture();
  touch.startButton(2, 'shoot', 740, 210);
  for (let i = 0; i < 24; i++) step();
  touch.end(2, 740, 160);
  touch.reset();
  step();
  expect(match.charge).toBeNull();
  expect(match.stats.shots[0]).toBe(0);
});

it.each([[-60, 'through'], [60, 'lob']] as const)('패스 버튼을 누른 채 세로로 밀면(%i px) %s 킥이 된다', (dy, kind) => {
  const { match, touch, step } = fixture();
  touch.startButton(2, 'pass', 700, 210);
  for (let i = 0; i < 6; i++) step();
  touch.move(2, 700, 210 + dy);
  for (let i = 0; i < 12; i++) step();
  expect(match.charge?.kind).toBe(kind);
  touch.move(2, 700, 210); // 되돌려도 유지
  step();
  expect(match.charge?.kind).toBe(kind);
  touch.end(2, 700, 210);
  step();
  expect(match.stats.passes[0]).toBe(1);
});

it('수비 압박 버튼을 밀면 슬라이딩 태클이 한 번 나간다', () => {
  const { match, player, touch, step } = fixture();
  const opponent = match.forward(1);
  opponent.pos.set(18, 0, 0);
  match.ball.reset(18.35, 0);
  match.ball.owner = opponent;
  touch.setMode('defence');
  const tackle = vi.spyOn(player, 'startTackle');
  touch.startButton(2, 'shoot', 700, 210);
  step();
  touch.move(2, 760, 210);
  step();
  touch.move(2, 790, 200);
  step();
  expect(tackle).toHaveBeenCalledOnce();
  expect(tackle.mock.calls[0][1]).toBe('slide');
});
