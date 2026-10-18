import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import { Input } from '../src/core/Input';
import { TouchControls } from '../src/ui/TouchControls';
import { Menu } from '../src/ui/Menu';
import * as THREE from 'three';
import { SKILLS, SkillInput } from '../src/gameplay/Skills';

let win: HappyWindow;
let coarse: boolean;
let media: EventTarget;
beforeEach(() => {
  win = new HappyWindow();
  coarse = true;
  media = new win.EventTarget() as unknown as EventTarget;
  Object.defineProperty(media, 'matches', { get: () => coarse });
  vi.spyOn(win, 'matchMedia').mockReturnValue(media as unknown as ReturnType<typeof win.matchMedia>);
  Object.defineProperties(win, { innerWidth: { value: 844, configurable: true }, innerHeight: { value: 390, configurable: true } });
  Object.defineProperty(win.HTMLElement.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', win.document);
  document.body.innerHTML = '<div id="overlay" class="hidden"></div>';
});
afterEach(async () => { await win.happyDOM.abort(); vi.unstubAllGlobals(); });

function pointer(target: Element, type: string, id: number, x: number, y: number, pointerType = 'touch') {
  target.dispatchEvent(new win.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, clientX: x, clientY: y, pointerType }) as unknown as Event);
}
function ui() {
  const input = new Input();
  const cancel = vi.fn(), detect = vi.fn(), suspend = vi.fn();
  const controls = new TouchControls(input, cancel, detect, suspend);
  controls.update(true, 'attack');
  const pad = document.querySelector('.touch-move')!;
  const shoot = document.querySelector('[data-touch="shoot"]')!;
  return { controls, input, cancel, detect, suspend, pad, shoot };
}

it('coarse 기기는 시작부터 터치 HUD를 표시하고 메뉴에서는 조작을 숨긴다', () => {
  const { controls, detect } = ui();
  expect(controls.detected).toBe(true);
  expect(detect).toHaveBeenCalledOnce();
  expect(document.documentElement.classList.contains('touch-device')).toBe(true);
  expect(document.querySelector('#touch-controls')!.classList.contains('hidden')).toBe(false);
  controls.update(false, 'attack');
  expect(document.querySelector('#touch-controls')!.classList.contains('hidden')).toBe(true);
});

it('fine 기기는 첫 터치에서 한 번만 감지하며 마우스 입력만으로는 켜지지 않는다', () => {
  coarse = false;
  const { controls, detect } = ui();
  pointer(document.body, 'pointerdown', 1, 100, 200, 'mouse');
  expect(controls.detected).toBe(false);
  pointer(document.body, 'pointerdown', 2, 100, 200);
  expect(controls.detected).toBe(true);
  pointer(document.body, 'pointerdown', 3, 100, 200);
  expect(detect).toHaveBeenCalledOnce();
});

it('coarse 미디어 쿼리 변경도 터치 조작을 켠다', () => {
  coarse = false;
  const { controls } = ui();
  coarse = true;
  const event = new win.Event('change');
  Object.defineProperty(event, 'matches', { value: true });
  media.dispatchEvent(event as unknown as Event);
  expect(controls.detected).toBe(true);
});

it('DOM 포인터의 조이스틱+슛 입력과 캡처 뒤 스와이프 release가 같은 Input으로 이어진다', () => {
  const { input, pad, shoot } = ui();
  pointer(pad, 'pointerdown', 1, 120, 230);
  pointer(pad, 'pointermove', 1, 172, 230);
  pointer(shoot, 'pointerdown', 2, 740, 210);
  expect(input.moveAxis().x).toBe(1);
  expect(input.button('shoot').held).toBe(true);
  expect(shoot.setPointerCapture).toHaveBeenCalledWith(2);
  input.endFrame();
  pointer(shoot, 'pointerup', 2, 740, 165);
  expect(input.button('shoot').released).toBe(true);
  expect(input.isDown('modifier')).toBe(true);
  pointer(shoot, 'lostpointercapture', 2, 740, 165);
  expect(input.moveAxis().x).toBe(1);
  expect(input.isDown('modifier')).toBe(true);
  pointer(pad, 'pointerup', 1, 172, 230);
  expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
});

it('개인기 스틱을 위·대각선·오른쪽으로 굴리면 이동 중에도 스텝오버를 인식한다', () => {
  const { input, pad } = ui();
  const skill = document.querySelector('.touch-skill')!;
  const recognizer = new SkillInput();
  const facing = new THREE.Vector3(1, 0, 0);
  const found: string[] = [];
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      const axis = input.skillAxis();
      const result = recognizer.update(1 / 120, input.isDown('skill'), false, new THREE.Vector3(axis.y, 0, axis.x), facing, SKILLS);
      if (result) found.push(result.id);
      input.endFrame();
    }
  };
  pointer(pad, 'pointerdown', 1, 100, 230);
  pointer(pad, 'pointermove', 1, 150, 230);
  pointer(skill, 'pointerdown', 2, 590, 325);
  pointer(skill, 'pointermove', 2, 590, 285);
  step(7);
  pointer(skill, 'pointermove', 2, 618, 297);
  step(7);
  pointer(skill, 'pointermove', 2, 630, 325);
  step(20);
  expect(found).toEqual(['step_over_r']);
  expect(input.moveAxis().x).toBeGreaterThan(0.9);
  pointer(skill, 'pointerup', 2, 630, 325);
  step(1);
  expect(input.isDown('skill')).toBe(false);
  expect(input.skillAxis()).toEqual(input.moveAxis());
});

it('개인기 스틱의 짧은 탭과 길게 유지가 다른 커맨드가 된다', () => {
  const { input } = ui();
  const skill = document.querySelector('.touch-skill')!;
  const facing = new THREE.Vector3(1, 0, 0);
  const list = SKILLS.filter((s) => s.id === 'feint_r' || s.id === 'side_step_r');
  const run = (frames: number, recognizer: SkillInput) => {
    let result: string | undefined;
    for (let i = 0; i < frames; i++) {
      const axis = input.skillAxis();
      result ??= recognizer.update(1 / 120, input.isDown('skill'), false, new THREE.Vector3(axis.y, 0, axis.x), facing, list)?.id;
      input.endFrame();
    }
    return result;
  };
  const tap = new SkillInput();
  pointer(skill, 'pointerdown', 1, 590, 325);
  pointer(skill, 'pointermove', 1, 630, 325);
  expect(run(10, tap)).toBeUndefined();
  pointer(skill, 'pointerup', 1, 630, 325);
  expect(run(1, tap)).toBe('feint_r');

  const hold = new SkillInput();
  pointer(skill, 'pointerdown', 2, 590, 325);
  pointer(skill, 'pointermove', 2, 630, 325);
  expect(run(50, hold)).toBe('side_step_r');
  pointer(skill, 'pointerup', 2, 630, 325);
  expect(input.skillAxis()).toEqual({ x: 0, y: 0 });
});

it.each(['pointercancel', 'lostpointercapture'])('%s는 멀티터치와 차지를 함께 취소한다', (type) => {
  const { input, cancel, pad, shoot } = ui();
  pointer(pad, 'pointerdown', 1, 120, 230);
  pointer(pad, 'pointermove', 1, 172, 230);
  pointer(shoot, 'pointerdown', 2, 740, 210);
  pointer(shoot, type, 2, 740, 210);
  expect(cancel).toHaveBeenCalledOnce();
  expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
  expect(input.button('shoot')).toEqual({ held: false, pressed: false, released: false });
  expect(document.querySelectorAll('.held').length).toBe(0);
});

it.each(['blur', 'portrait', 'hidden'])('%s 전환은 입력을 초기화하고 경기 중단을 요청한다', (kind) => {
  const { input, suspend, shoot } = ui();
  pointer(shoot, 'pointerdown', 2, 740, 210);
  if (kind === 'blur') win.dispatchEvent(new win.Event('blur'));
  else if (kind === 'portrait') {
    Object.defineProperties(win, { innerWidth: { value: 390 }, innerHeight: { value: 844 } });
    win.dispatchEvent(new win.Event('resize'));
    expect(document.querySelector('#touch-controls')!.classList.contains('hidden')).toBe(true);
  } else {
    Object.defineProperty(win.document, 'hidden', { value: true });
    win.document.dispatchEvent(new win.Event('visibilitychange'));
  }
  expect(suspend).toHaveBeenCalledOnce();
  expect(input.button('shoot')).toEqual({ held: false, pressed: false, released: false });
});

it('DOM 공격/수비·세트피스 전환은 라벨과 보이는 버튼을 갱신한다', () => {
  const { controls, input } = ui();
  const label = (slot: string) => document.querySelector(`[data-touch="${slot}"]`)!;
  controls.update(true, 'defence');
  expect(label('shoot').textContent).toBe('압박');
  expect(label('through').textContent).toBe('태클');
  expect(label('through').classList.contains('hidden')).toBe(false);
  expect(label('lob').classList.contains('hidden')).toBe(true);
  expect(document.querySelector('[data-touch="support"]')).toBeNull();
  pointer(label('through'), 'pointerdown', 2, 700, 210);
  expect(input.button('tackle').pressed).toBe(true);
  controls.update(true, 'throwin');
  expect(label('pass').textContent).toBe('짧은 스로인');
  expect(label('lob').textContent).toBe('롱 스로인');
  expect(label('shoot').classList.contains('hidden')).toBe(true);
  expect(label('sprint').classList.contains('hidden')).toBe(true);
});

it('터치 메뉴 좌우 버튼·뒤로 버튼과 기존 키보드 조작이 같은 설정을 변경한다', () => {
  const menu = new Menu();
  let value = 1;
  const back = vi.fn(), select = vi.fn();
  menu.open({ eyebrow: '', title: 'TEST', panel: () => '', onBack: back,
    items: [
      { id: 'setting', label: '설정 값', value: () => String(value), onLeft: () => value--, onRight: () => value++ },
      { id: 'select', label: '선택', onSelect: select },
    ],
  });
  document.querySelector<HTMLButtonElement>('[data-dir="left"]')!.click();
  expect(value).toBe(0);
  document.querySelector<HTMLButtonElement>('[data-dir="right"]')!.click();
  expect(value).toBe(1);
  menu.handleKey('ArrowRight');
  expect(value).toBe(2);
  // 터치 pointerenter가 화면을 다시 그려 클릭 대상을 없애지 않는다.
  const target = document.querySelectorAll<HTMLButtonElement>('.menu-select')[1];
  pointer(target, 'pointerenter', 1, 20, 100);
  expect(target.isConnected).toBe(true);
  target.click();
  expect(select).toHaveBeenCalledOnce();
  menu.handleKey('ArrowUp');
  menu.handleKey('ArrowLeft');
  expect(value).toBe(1);
  document.querySelector<HTMLButtonElement>('.menu-back')!.click();
  expect(back).toHaveBeenCalledOnce();
  menu.handleKey('Escape');
  expect(back).toHaveBeenCalledTimes(2);
});

it('같은 버튼의 멀티터치에서 한 손의 정상 캡처 해제는 남은 손을 취소하지 않는다', () => {
  const { input, cancel, shoot } = ui();
  pointer(shoot, 'pointerdown', 1, 740, 210);
  pointer(shoot, 'pointerdown', 2, 745, 210);
  input.endFrame();
  pointer(shoot, 'pointerup', 1, 740, 210);
  pointer(shoot, 'lostpointercapture', 1, 740, 210);
  expect(input.button('shoot').held).toBe(true);
  expect(shoot.classList.contains('held')).toBe(true);
  expect(cancel).not.toHaveBeenCalled();
  pointer(shoot, 'pointerup', 2, 745, 210);
  expect(input.button('shoot').released).toBe(true);
});

it('공격 모드는 슛·패스·질주만 보이고 스와이프 안내를 단다', () => {
  ui();
  const shown = [...document.querySelectorAll('.touch-button:not(.hidden)')].map((b) => (b as HTMLElement).dataset.touch);
  expect(shown.sort()).toEqual(['pass', 'pause', 'shoot', 'sprint']);
  expect((document.querySelector('[data-touch="pass"]') as HTMLElement).dataset.hint).toBe('↑스루 ↓로빙');
});

it('Z 모드 스틱은 드래그백 커맨드를 내고 해제·취소 뒤 Z 입력을 남기지 않는다', () => {
  const { input, controls } = ui();
  const toggle = document.querySelector<HTMLButtonElement>('.touch-skill-z')!;
  toggle.click();
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  const skill = document.querySelector('.touch-skill')!;
  const recognizer = new SkillInput();
  const facing = new THREE.Vector3(1, 0, 0);
  let found: string | undefined;
  const tick = () => {
    const axis = input.skillAxis();
    found ??= recognizer.update(1 / 120, input.isDown('skill'), input.isDown('finesse'), new THREE.Vector3(axis.y, 0, axis.x), facing, SKILLS)?.id;
    input.endFrame();
  };
  tick();
  pointer(skill, 'pointerdown', 1, 590, 325);
  tick();
  pointer(skill, 'pointermove', 1, 590, 365);
  for (let i = 0; i < 50; i++) tick();
  pointer(skill, 'pointerup', 1, 590, 365);
  tick();
  expect(found).toBe('drag_back');
  expect(input.isDown('finesse')).toBe(false);
  pointer(skill, 'pointerdown', 2, 590, 325);
  controls.reset();
  expect(input.isDown('finesse')).toBe(false);
});
