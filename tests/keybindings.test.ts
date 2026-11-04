import { afterEach, expect, it } from 'vitest';
import { ACTION_KEYS, Input, boundLabel } from '../src/core/Input';
import { bindKey, settings } from '../src/core/Settings';

afterEach(() => bindKey(null));

function keyInput() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const input = new Input({ addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h; }, document: {} } as unknown as Window);
  const press = (code: string) => handlers.keydown({ code, repeat: false, target: null, preventDefault() {} });
  return { input, press };
}

it('슛을 J로 바꾸면 J가 슛이 되고 D는 더 이상 슛이 아니다', () => {
  bindKey('shoot', 'KeyJ');
  expect(ACTION_KEYS.shoot).toEqual(['KeyJ']);
  const { input, press } = keyInput();
  press('KeyD');
  expect(input.isDown('shoot')).toBe(false);
  press('KeyJ');
  expect(input.button('shoot').pressed).toBe(true);
  // 키보드 킥(연타 판정)도 새 키를 본다
  expect(input.keyboardKick()).toBe(true);
});

it('다른 동작이 쓰던 키를 고르면 두 동작의 키를 맞바꾼다, 기본 배치로 되돌릴 수 있다', () => {
  bindKey('shoot', 'KeyS');
  expect(ACTION_KEYS.shoot).toEqual(['KeyS']);
  expect(ACTION_KEYS.pass).toEqual(['KeyD']);
  expect(settings.keyBindings).toEqual({ shoot: 'KeyS', pass: 'KeyD' });
  bindKey(null);
  expect(ACTION_KEYS.shoot).toEqual(['KeyD']);
  expect(ACTION_KEYS.pass).toEqual(['KeyS']);
});

it('이동·메뉴 키는 줄 수 없다', () => {
  bindKey('shoot', 'ArrowUp');
  bindKey('pass', 'Escape');
  expect(ACTION_KEYS.shoot).toEqual(['KeyD']);
  expect(ACTION_KEYS.pass).toEqual(['KeyS']);
});

it('안내 문구의 기본 글자는 바꾼 키 글자로 보인다', () => {
  bindKey('finesse', 'KeyX');
  bindKey('tackle', 'KeyB');
  expect(boundLabel('Z')).toBe('X');
  expect(boundLabel('Space')).toBe('B');
  expect(boundLabel('←→')).toBe('←→');
});
