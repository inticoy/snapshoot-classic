import * as THREE from 'three';
import { expect, it } from 'vitest';
import { Input } from '../src/core/Input';
import { GamepadInput, PAD } from '../src/core/Gamepad';
import { SKILLS, SkillInput } from '../src/gameplay/Skills';

/** 표준 매핑 패드 흉내: 버튼 17개, 축 4개 */
function fakePad() {
  const pad = {
    connected: true, mapping: 'standard' as GamepadMappingType, id: 'test',
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
  const press = (i: number, on = true) => { pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; };
  return { pad, press };
}
function setup() {
  const input = new Input({ addEventListener() {} } as unknown as Window);
  const { pad, press } = fakePad();
  let list: (typeof pad | null)[] = [pad];
  const gp = new GamepadInput(input, () => list as never);
  return { input, pad, press, gp, unplug: () => { list = [null]; } };
}
const dt = 1 / 120;

it('A·B·RT가 패스·슛·질주 버튼이 되고, 누름·뗌 순간이 한 번씩 잡힌다', () => {
  const { input, press, gp } = setup();
  press(0); press(7);
  gp.poll(dt);
  expect(input.button('pass')).toEqual({ held: true, pressed: true, released: false });
  expect(input.isDown('sprint')).toBe(true);
  input.endFrame();
  gp.poll(dt);
  expect(input.button('pass')).toEqual({ held: true, pressed: false, released: false });
  press(0, false); press(1);
  gp.poll(dt);
  expect(input.button('pass').released).toBe(true);
  expect(input.button('shoot').pressed).toBe(true);
});

it('왼쪽 스틱은 데드존 밖을 0..1로 늘려 이동하고, 스틱을 놓으면 멈춘다', () => {
  const { input, pad, gp } = setup();
  pad.axes = [0.1, -0.1, 0, 0];
  gp.poll(dt);
  expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
  pad.axes = [0, -1, 0, 0]; // 위
  gp.poll(dt);
  expect(input.moveAxis().y).toBeCloseTo(1, 5);
  pad.axes = [0, 0, 0, 0];
  gp.poll(dt);
  expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
});

it('십자키·A·B는 메뉴 조작 키로도 들어간다 (누른 순간 한 번)', () => {
  const { input, press, gp } = setup();
  press(13);
  gp.poll(dt); gp.poll(dt);
  press(0);
  gp.poll(dt);
  expect(input.drainPresses()).toEqual(['ArrowDown', 'Enter']);
});

/** 오른쪽 스틱으로 방향을 차례로 튕긴다 (각 방향 frames 프레임, 사이에 gap 프레임 가운데) */
function flick(dirs: [number, number][], frames = 8, gap = 8) {
  const { input, pad, gp } = setup();
  const recognizer = new SkillInput();
  const facing = new THREE.Vector3(1, 0, 0);
  const found: string[] = [];
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      gp.poll(dt);
      const axis = input.skillAxis();
      const r = recognizer.update(dt, input.isDown('skill'), input.isDown('finesse'), new THREE.Vector3(axis.y, 0, axis.x), facing, SKILLS);
      if (r) found.push(r.id);
      input.endFrame();
    }
  };
  for (const [x, y] of dirs) {
    pad.axes = [0, 0, x, -y];
    step(frames);
    pad.axes = [0, 0, 0, 0];
    step(gap);
  }
  step(Math.ceil(PAD.skillGrace / dt) + 30);
  return { found, input };
}

it('오른쪽 스틱 ↓↑↑ 튕기기 = 레인보우 (스틱을 놓는 사이에도 한 커맨드로 이어진다)', () => {
  const { found, input } = flick([[0, -1], [0, 1], [0, 1]]);
  expect(found).toEqual(['rainbow']);
  // 다 놓고 나면 개인기 보조키도 뗀 상태
  expect(input.isDown('skill')).toBe(false);
});

it('오른쪽 스틱 → ↗ ↑ 굴리기 = 리버스 스텝오버', () => {
  const s = Math.SQRT1_2;
  const { found } = flick([[1, 0], [s, s], [0, 1]], 7, 0);
  expect(found).toEqual(['reverse_step_over_r']);
});

it('RB를 쥔 채 오른쪽 스틱 = Z 개인기 (Shift 개인기 대신)', () => {
  const { input, pad, press, gp } = setup();
  press(5);
  pad.axes = [0, 0, 0, 1]; // 아래
  gp.poll(dt);
  expect(input.isDown('finesse')).toBe(true);
  expect(input.isDown('skill')).toBe(false);
  expect(input.skillAxis().y).toBeLessThan(-0.9);
});

it('패드를 빼면 누르던 버튼·이동·개인기를 모두 뗀다', () => {
  const { input, pad, press, gp, unplug } = setup();
  press(7); pad.axes = [1, 0, 0, 1];
  gp.poll(dt);
  expect(input.isDown('sprint')).toBe(true);
  unplug();
  gp.poll(dt);
  expect(input.isDown('sprint')).toBe(false);
  expect(input.isDown('skill')).toBe(false);
  expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
  expect(gp.active).toBe(false);
});
