import { TOUCH } from '../config';
import { Input, type Action } from './Input';

export type TouchMode = 'attack' | 'defence' | 'throwin' | 'corner' | 'goalkick';
export type TouchSlot = 'shoot' | 'pass' | 'through' | 'lob' | 'sprint' | 'support' | 'contain' | 'pause';

export function touchBinding(mode: TouchMode, slot: TouchSlot): { label: string; action: Action } {
  if (slot === 'pause') return { label: '일시정지', action: 'pause' };
  if (slot === 'sprint') return { label: '질주', action: 'sprint' };
  if (slot === 'support') return { label: '동료 압박', action: 'modifier' };
  if (slot === 'contain') return { label: '견제', action: 'contain' };
  if (mode === 'defence') {
    if (slot === 'shoot') return { label: '압박', action: 'shoot' };
    if (slot === 'pass') return { label: '선수 변경', action: 'pass' };
    if (slot === 'through') return { label: '스탠딩 태클', action: 'tackle' };
    return { label: '슬라이딩', action: 'lob' };
  }
  if (slot === 'pass') return { label: mode === 'throwin' ? '짧은 스로인' : '패스', action: 'pass' };
  if (slot === 'lob') return { label: mode === 'throwin' ? '롱 스로인' : mode === 'corner' ? '크로스' : mode === 'goalkick' ? '롱킥' : '로빙', action: 'lob' };
  return { label: slot === 'shoot' ? '슛' : '스루', action: slot };
}

interface Contact { x: number; y: number; slot?: TouchSlot; action?: Action }

/** DOM과 분리해 멀티터치/취소/스와이프를 실제 경기 시뮬레이션에서도 검증한다. */
export class TouchInput {
  private readonly contacts = new Map<number, Contact>();
  private moveId: number | null = null;
  private buttonUsed = false;
  mode: TouchMode = 'attack';
  joystick: { x: number; y: number; dx: number; dy: number } | null = null;

  constructor(private readonly input: Input, private readonly onCancel: () => void) {}

  startMove(id: number, x: number, y: number): boolean {
    if (this.moveId !== null || this.contacts.has(id)) return false;
    this.moveId = id;
    this.contacts.set(id, { x, y });
    this.joystick = { x, y, dx: 0, dy: 0 };
    return true;
  }

  startButton(id: number, slot: TouchSlot, x: number, y: number): boolean {
    if (this.contacts.has(id)) return false;
    const { action } = touchBinding(this.mode, slot);
    this.buttonUsed = true;
    this.contacts.set(id, { x, y, slot, action });
    this.input.setActions(`touch:${id}`, [action]);
    return true;
  }

  move(id: number, x: number, y: number): void {
    const start = this.contacts.get(id);
    if (!start || id !== this.moveId) return;
    const dx = (x - start.x) / TOUCH.joystickRadius;
    const dy = (y - start.y) / TOUCH.joystickRadius;
    const length = Math.hypot(dx, dy);
    const amount = Math.min(1, Math.max(0, (length - TOUCH.deadZone) / (1 - TOUCH.deadZone)));
    this.input.setMove(length ? dx / length * amount : 0, length ? -dy / length * amount : 0);
    this.joystick = { x: start.x, y: start.y, dx: dx / Math.max(1, length) * TOUCH.joystickRadius, dy: dy / Math.max(1, length) * TOUCH.joystickRadius };
  }

  end(id: number, x: number, y: number): void {
    const start = this.contacts.get(id);
    if (!start) return;
    if (id === this.moveId) {
      this.moveId = null;
      this.joystick = null;
      this.input.setMove(0, 0);
    } else {
      if (start.slot === 'shoot' && this.mode === 'attack') {
        const dx = x - start.x, dy = y - start.y;
        if (-dy >= TOUCH.swipeDistance && -dy > Math.abs(dx)) this.input.pulse('modifier');
        else if (Math.abs(dx) >= TOUCH.swipeDistance && Math.abs(dx) >= Math.abs(dy)) this.input.pulse('finesse');
      }
      this.input.setActions(`touch:${id}`, []);
    }
    this.contacts.delete(id);
  }

  setMode(mode: TouchMode): void {
    if (this.mode === mode) return;
    // 공 소유권이 바뀌면 기존 버튼을 새 태클/슛으로 오해하지 않게 끊는다.
    const hadButton = this.buttonUsed;
    this.buttonUsed = false;
    for (const [id, contact] of this.contacts) {
      if (id !== this.moveId && contact.slot !== 'sprint' && contact.slot !== 'pause') this.contacts.delete(id);
    }
    this.input.clearVirtualActions();
    for (const [id, contact] of this.contacts) {
      if (contact.action) this.input.setActions(`touch:${id}`, [contact.action]);
    }
    this.buttonUsed = [...this.contacts.values()].some((contact) => !!contact.action);
    if (hadButton) this.onCancel();
    this.mode = mode;
  }

  reset(): void {
    const hadButton = this.buttonUsed;
    this.buttonUsed = false;
    this.contacts.clear();
    this.moveId = null;
    this.joystick = null;
    this.input.clearVirtual();
    if (hadButton) this.onCancel();
  }
}
