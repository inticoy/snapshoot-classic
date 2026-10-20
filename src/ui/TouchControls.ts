import { Input } from '../core/Input';
import { TouchInput, swipeHint, touchBinding, visibleSlots, type TouchMode, type TouchSlot } from '../core/TouchInput';

// 동료 압박·견제는 버튼을 줄이려고 모바일에서 뺐다. 나머지는 스와이프로 낸다
const SLOTS: TouchSlot[] = ['shoot', 'pass', 'through', 'lob', 'sprint', 'pause'];

/** 포인터 캡처로 버튼 바깥 스와이프와 손가락별 입력 수명을 보존한다. */
export class TouchControls {
  private readonly root = document.createElement('div');
  private readonly stick = document.createElement('div');
  private readonly pad = document.createElement('div');
  private readonly skillZ = document.createElement('button');
  private readonly skillPad = document.createElement('div');
  private readonly buttons = new Map<TouchSlot, HTMLButtonElement>();
  private readonly activePointers = new Map<number, HTMLElement>();
  private readonly touch: TouchInput;
  private enabled = false;
  private playing = false;
  private visible = false;
  private readonly coarse = window.matchMedia('(pointer: coarse)');

  constructor(input: Input, onCancel: () => void, private readonly onDetect: () => void, onSuspend: () => void) {
    this.touch = new TouchInput(input, onCancel);
    this.root.id = 'touch-controls';
    this.root.className = 'hidden';
    this.pad.className = 'touch-move';
    this.pad.setAttribute('aria-label', '이동 조이스틱');
    this.stick.className = 'touch-stick hidden';
    this.stick.innerHTML = '<i></i>';
    this.root.append(this.pad, this.stick);
    this.skillPad.className = 'touch-skill';
    this.skillPad.setAttribute('role', 'button');
    this.skillPad.setAttribute('aria-label', '개인기 스틱: 누른 채 8방향으로 움직이기');
    this.skillPad.textContent = '개인기';
    this.root.append(this.skillPad);
    this.skillZ.type = 'button';
    this.skillZ.className = 'touch-skill-z';
    this.skillZ.textContent = 'Z 모드';
    this.skillZ.setAttribute('aria-label', '개인기 스틱 Z 모드');
    this.skillZ.setAttribute('aria-pressed', 'false');
    this.skillZ.onclick = () => {
      const z = this.touch.toggleSkillZ();
      this.skillZ.setAttribute('aria-pressed', String(z));
      this.skillPad.textContent = z ? '개인기 Z' : '개인기';
    };
    this.root.append(this.skillZ);
    for (const slot of SLOTS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.touch = slot;
      button.className = `touch-button touch-${slot}`;
      this.buttons.set(slot, button);
      this.root.append(button);
      this.bind(button, slot);
    }
    this.bind(this.pad);
    this.bind(this.skillPad, undefined, true);
    const guide = document.createElement('div');
    guide.id = 'rotate-guide';
    guide.setAttribute('role', 'status');
    guide.innerHTML = '<b>↻</b><span>가로로 돌리면 더 편해요</span><small>두 손으로 조이스틱과 버튼을 함께 써요</small>';
    document.body.append(this.root, guide);
    // iOS: 길게 누르면 뜨는 텍스트 선택·돋보기·공유 메뉴를 경기 화면 전체에서 막는다
    const blockGesture = (event: Event) => {
      if (this.enabled && !(event.target instanceof HTMLInputElement)) event.preventDefault();
    };
    document.addEventListener('selectstart', blockGesture);
    document.addEventListener('contextmenu', blockGesture);
    this.root.addEventListener('touchstart', blockGesture, { passive: false });
    this.renderLabels();
    const detect = () => {
      if (this.enabled) return;
      this.enabled = true;
      document.documentElement.classList.add('touch-device');
      this.onDetect();
      this.refreshVisibility();
    };
    if (this.coarse.matches) detect();
    this.coarse.addEventListener('change', (event) => { if (event.matches) detect(); });
    window.addEventListener('pointerdown', (event) => { if (event.pointerType === 'touch') detect(); }, { capture: true });
    const suspend = () => {
      this.reset();
      if (this.enabled && this.playing) onSuspend();
    };
    window.addEventListener('blur', suspend);
    document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
    window.addEventListener('resize', () => {
      this.reset();
      if (this.enabled && window.innerHeight > window.innerWidth && this.playing) onSuspend();
      this.refreshVisibility();
    });
  }

  get detected(): boolean { return this.enabled; }

  update(playing: boolean, mode: TouchMode): void {
    this.playing = playing;
    if (this.touch.mode !== mode) {
      this.touch.setMode(mode);
      for (const [id, element] of this.activePointers) {
        if (element !== this.pad && element.dataset.touch !== 'sprint' && element.dataset.touch !== 'pause') {
          this.activePointers.delete(id);
          element.classList.remove('held');
        }
      }
      this.renderLabels();
      this.drawStick();
    }
    this.refreshVisibility();
  }

  private refreshVisibility(): void {
    const visible = this.enabled && this.playing && window.innerWidth >= window.innerHeight;
    if (this.visible && !visible) this.reset();
    this.visible = visible;
    this.root.classList.toggle('hidden', !visible);
  }

  private renderLabels(): void {
    const mode = this.touch.mode;
    this.root.dataset.mode = mode;
    const shown = visibleSlots(mode);
    this.skillPad.classList.toggle('hidden', mode !== 'attack');
    this.skillZ.classList.toggle('hidden', mode !== 'attack');
    for (const [slot, button] of this.buttons) {
      const { label } = touchBinding(mode, slot);
      const hint = swipeHint(mode, slot);
      button.textContent = slot === 'through' && mode === 'defence' ? '태클' : label;
      button.dataset.hint = hint;
      button.setAttribute('aria-label', hint ? `${label} (${hint})` : label);
      button.classList.toggle('hidden', !shown.includes(slot));
    }
  }

  private bind(element: HTMLElement, slot?: TouchSlot, skill = false): void {
    element.addEventListener('contextmenu', (event) => event.preventDefault());
    element.addEventListener('pointerdown', (event) => {
      if (!this.visible || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      const accepted = skill
        ? this.touch.startSkill(event.pointerId, event.clientX, event.clientY)
        : slot
        ? this.touch.startButton(event.pointerId, slot, event.clientX, event.clientY)
        : this.touch.startMove(event.pointerId, event.clientX, event.clientY);
      if (!accepted) return;
      this.activePointers.set(event.pointerId, element);
      element.setPointerCapture(event.pointerId);
      element.classList.add('held');
      this.drawStick();
    });
    element.addEventListener('pointermove', (event) => {
      this.touch.move(event.pointerId, event.clientX, event.clientY);
      this.drawStick();
    });
    element.addEventListener('pointerup', (event) => {
      this.touch.end(event.pointerId, event.clientX, event.clientY);
      this.activePointers.delete(event.pointerId);
      if (![...this.activePointers.values()].includes(element)) element.classList.remove('held');
      this.drawStick();
    });
    const cancel = (event: PointerEvent) => {
      // pointerup 뒤 자동 캡처 해제는 정상 종료이며, 브라우저 제스처에 의한 취소만 초기화한다.
      if (this.activePointers.has(event.pointerId)) this.reset();
    };
    element.addEventListener('pointercancel', cancel);
    element.addEventListener('lostpointercapture', cancel);
  }

  /** R 리셋도 누른 포인터를 해제해 이전 시나리오의 입력을 넘기지 않는다. */
  reset(): void {
    this.touch.reset();
    this.activePointers.clear();
    this.root.querySelectorAll('.held').forEach((el) => el.classList.remove('held'));
    this.drawStick();
  }

  private drawStick(): void {
    const stick = this.touch.joystick;
    this.stick.classList.toggle('hidden', !stick);
    if (!stick) return;
    this.stick.style.left = `${stick.x}px`;
    this.stick.style.top = `${stick.y}px`;
    (this.stick.firstElementChild as HTMLElement).style.transform = `translate(${stick.dx}px, ${stick.dy}px)`;
  }
}
