import { Input } from '../core/Input';
import { TouchInput, touchBinding, type TouchMode, type TouchSlot } from '../core/TouchInput';

const SLOTS: TouchSlot[] = ['shoot', 'pass', 'through', 'lob', 'sprint', 'support', 'contain', 'pause'];

/** 포인터 캡처로 버튼 바깥 스와이프와 손가락별 입력 수명을 보존한다. */
export class TouchControls {
  private readonly root = document.createElement('div');
  private readonly stick = document.createElement('div');
  private readonly pad = document.createElement('div');
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
    const guide = document.createElement('div');
    guide.id = 'rotate-guide';
    guide.setAttribute('role', 'status');
    guide.innerHTML = '<b>↻</b><span>가로로 돌려주세요</span><small>두 손으로 조이스틱과 버튼을 함께 조작하세요</small>';
    document.body.append(this.root, guide);
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
    for (const [slot, button] of this.buttons) {
      const { label } = touchBinding(mode, slot);
      button.textContent = label;
      button.setAttribute('aria-label', label);
      button.classList.toggle('hidden', (slot === 'support' || slot === 'contain') && mode !== 'defence'
        || (slot === 'shoot' || slot === 'through') && mode !== 'attack' && mode !== 'defence');
    }
  }

  private bind(element: HTMLElement, slot?: TouchSlot): void {
    element.addEventListener('contextmenu', (event) => event.preventDefault());
    element.addEventListener('pointerdown', (event) => {
      if (!this.visible || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      const accepted = slot
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

  private reset(): void {
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
