import { afterEach, expect, it, vi } from 'vitest';
import { BALL, PHYSICS, PITCH } from '../src/config';
import { command, parkPlayers, simulation } from './helpers';
import { Input, type Action } from '../src/core/Input';
import { cycleAssist, cycleMoveAssist, settings, togglePhysicsPreset } from '../src/core/Settings';
import { activePhysics, PRESETS, setActivePhysics } from '../src/physics/presets';

const defaults = { ...settings };
afterEach(() => { Object.assign(settings, defaults); setActivePhysics('arcade'); vi.unstubAllGlobals(); });

function keyboard() {
  const target = new EventTarget();
  const input = new Input(target as unknown as Window);
  const key = (type: string, code: string) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { code: { value: code }, repeat: { value: false } });
    target.dispatchEvent(event);
    return event;
  };
  return { target, input, key };
}

it('FC 키 배치의 공격·수비·보조키가 고정 스텝 사이 눌림/뗌을 유지한다', () => {
  const { input, key } = keyboard();
  const keys: [string, Action][] = [
    ['KeyD', 'shoot'], ['KeyS', 'pass'], ['KeyW', 'through'], ['KeyA', 'lob'],
    ['KeyE', 'sprint'], ['KeyQ', 'modifier'], ['KeyZ', 'finesse'], ['KeyC', 'contain'], ['Space', 'tackle'],
  ];
  for (const [code, action] of keys) {
    expect(key('keydown', code).defaultPrevented).toBe(true);
    expect(input.button(action)).toEqual({ held: true, pressed: true, released: false });
    input.endFrame();
    expect(input.button(action)).toEqual({ held: true, pressed: false, released: false });
    key('keyup', code);
    expect(input.button(action)).toEqual({ held: false, pressed: false, released: true });
    input.endFrame();
  }
});

it('대각선 이동 정규화, 메뉴 입력 순서와 포커스 이탈 시 키 해제가 유지된다', () => {
  const { target, input, key } = keyboard();
  key('keydown', 'ArrowUp');
  key('keydown', 'ArrowRight');
  expect(Math.hypot(...Object.values(input.moveAxis()))).toBeCloseTo(1, 12);
  key('keydown', 'KeyD');
  expect(input.drainPresses()).toEqual(['ArrowUp', 'ArrowRight', 'KeyD']);
  expect(input.drainPresses()).toEqual([]);
  target.dispatchEvent(new Event('blur'));
  expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
  expect(input.button('shoot').held).toBe(false);
  expect(input.button('shoot').released).toBe(true);
});

it('보조 3단계·이동 보조·물리 전환 설정이 저장되고 역방향 순환한다', () => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', { setItem: (key: string, value: string) => saved.set(key, value) });
  Object.assign(settings, { passAssist: 'assisted', shotAssist: 'assisted', moveAssist: 'high', physicsPreset: 'arcade' });
  cycleAssist('passAssist', 1);
  expect(settings.passAssist).toBe('semi');
  cycleAssist('passAssist', 1);
  expect(settings.passAssist).toBe('manual');
  cycleAssist('passAssist', 1);
  expect(settings.passAssist).toBe('assisted');
  cycleAssist('shotAssist', -1);
  expect(settings.shotAssist).toBe('manual');
  cycleMoveAssist(1);
  expect(settings.moveAssist).toBe('none');
  cycleMoveAssist(-1);
  expect(settings.moveAssist).toBe('high');
  expect(togglePhysicsPreset()).toBe('real');
  expect(activePhysics()).toBe(PRESETS.real);
  expect(JSON.parse(saved.get('snapshoot-classic:settings')!)).toEqual(settings);
  expect(togglePhysicsPreset()).toBe('arcade');
  expect(activePhysics()).toBe(PRESETS.arcade);
});

it('D 차지·뗌 입력으로 슛 → 득점 → 상대 킥오프까지 이어진다', () => {
  const { input, key } = keyboard();
  const { match } = simulation(42);
  parkPlayers(match);
  const shooter = match.forward(0);
  shooter.actionLock = 0;
  shooter.pos.set(PITCH.halfL - 7, 0, 0);
  shooter.facing.set(1, 0, 0);
  match.ball.reset(PITCH.halfL - 6.65, 0);
  match.ball.owner = match.ball.lastTouch = shooter;
  match.controlled = shooter;
  const cmd = command();
  const step = () => {
    cmd.shoot = input.button('shoot');
    match.update(PHYSICS.step, cmd);
    input.endFrame();
  };
  key('keydown', 'KeyD');
  for (let i = 0; i < 36; i++) step();
  expect(match.charge?.value).toBeGreaterThan(0.3);
  key('keyup', 'KeyD');
  step();
  expect(match.stats.shots[0]).toBe(1);
  expect(match.ball.owner).toBeNull();
  for (let i = 0; i < 2 / PHYSICS.step && match.score[0] === 0; i++) step();
  expect(match.score).toEqual([1, 0]);
  expect(match.phase).toBe('goal');
  expect(match.events.some((e) => e.type === 'goal' && e.scorer === shooter)).toBe(true);
  for (let i = 0; i < 4 / PHYSICS.step && match.phase === 'goal'; i++) step();
  expect(match.phase).toBe('kickoff');
  expect(match.ball.owner?.team).toBe(1);
  expect(match.ball.position.y).toBeCloseTo(BALL.radius, 2);
});
