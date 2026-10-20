import { TOUCH } from '../config';
import { Input, type Action } from './Input';

export type TouchMode = 'attack' | 'defence' | 'throwin' | 'corner' | 'goalkick' | 'freekick' | 'indirect' | 'penalty' | 'keeper';
export type TouchSlot = 'shoot' | 'pass' | 'through' | 'lob' | 'sprint' | 'pause';

export function touchBinding(mode: TouchMode, slot: TouchSlot): { label: string; action: Action } {
  if (slot === 'pause') return { label: '일시정지', action: 'pause' };
  if (slot === 'sprint') return { label: '질주', action: 'sprint' };
  if (mode === 'defence') {
    if (slot === 'shoot') return { label: '압박', action: 'shoot' };
    if (slot === 'pass') return { label: '선수 변경', action: 'pass' };
    if (slot === 'through') return { label: '스탠딩 태클', action: 'tackle' };
    return { label: '슬라이딩', action: 'lob' };
  }
  if (slot === 'pass') return { label: mode === 'throwin' ? '짧은 스로인' : '패스', action: 'pass' };
  if (slot === 'lob') return { label: mode === 'throwin' ? '롱 스로인' : mode === 'corner' ? '크로스' : mode === 'goalkick' || mode === 'freekick' || mode === 'indirect' ? '롱킥' : '로빙', action: 'lob' };
  return { label: slot === 'shoot' ? '슛' : '스루', action: slot };
}

interface Contact { x: number; y: number; slot?: TouchSlot; action?: Action; flicked?: boolean }

/** 화면에 보이는 버튼. 나머지 동작은 스와이프로 낸다 (FIFA 모바일식) */
export function visibleSlots(mode: TouchMode): TouchSlot[] {
  if (mode === 'attack') return ['shoot', 'pass', 'sprint', 'pause'];
  if (mode === 'defence') return ['shoot', 'pass', 'through', 'sprint', 'pause'];
  if (mode === 'freekick') return ['shoot', 'pass', 'lob', 'pause'];
  // PK: 조이스틱 위/아래로 구석을 고르고 슛 / 상대 PK: 조이스틱으로 다이빙 방향만
  if (mode === 'penalty') return ['shoot', 'pause'];
  if (mode === 'keeper') return ['pause'];
  return ['pass', 'lob', 'pause'];
}

/** 버튼 아래 작게 표시하는 스와이프 안내 */
export function swipeHint(mode: TouchMode, slot: TouchSlot): string {
  if (mode === 'attack' && slot === 'pass') return '↑스루 ↓로빙';
  if (mode === 'attack' && slot === 'shoot') return '↑칩슛 ↔감아';
  if (mode === 'defence' && slot === 'shoot') return '밀면 슬라이딩';
  if (mode === 'freekick' && slot === 'shoot') return '↔감아차기';
  if (mode === 'penalty' && slot === 'shoot') return '꾹 눌러 조절';
  return '';
}

/** DOM과 분리해 멀티터치/취소/스와이프를 실제 경기 시뮬레이션에서도 검증한다. */
export class TouchInput {
  private readonly contacts = new Map<number, Contact>();
  private moveId: number | null = null;
  private skillId: number | null = null;
  private buttonUsed = false;
  mode: TouchMode = 'attack';
  skillZ = false;

  toggleSkillZ(): boolean {
    this.skillZ = !this.skillZ;
    if (this.skillId !== null) this.input.setActions(`touch:${this.skillId}`, [this.skillZ ? 'finesse' : 'skill']);
    return this.skillZ;
  }
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

  startSkill(id: number, x: number, y: number): boolean {
    if (this.skillId !== null || this.contacts.has(id) || this.mode !== 'attack') return false;
    this.skillId = id;
    const action = this.skillZ ? 'finesse' : 'skill';
    this.buttonUsed = true;
    this.contacts.set(id, { x, y, action });
    this.input.setActions(`touch:${id}`, [action]);
    this.input.setSkillMove(0, 0);
    return true;
  }

  move(id: number, x: number, y: number): void {
    const start = this.contacts.get(id);
    if (!start) return;
    if (id === this.skillId) {
      const dx = (x - start.x) / TOUCH.skillRadius;
      const dy = (start.y - y) / TOUCH.skillRadius;
      const length = Math.hypot(dx, dy);
      this.input.setSkillMove(length >= TOUCH.skillDeadZone ? dx / Math.max(1, length) : 0, length >= TOUCH.skillDeadZone ? dy / Math.max(1, length) : 0);
      return;
    }
    if (id !== this.moveId) {
      this.swipe(id, start, x - start.x, y - start.y);
      return;
    }
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
    if (id === this.skillId) {
      this.skillId = null;
      this.input.clearSkillMove();
      this.input.setActions(`touch:${id}`, []);
    } else if (id === this.moveId) {
      this.moveId = null;
      this.joystick = null;
      this.input.setMove(0, 0);
    } else {
      if (start.slot === 'shoot' && (this.mode === 'attack' || this.mode === 'freekick')) {
        const dx = x - start.x, dy = y - start.y;
        if (-dy >= TOUCH.swipeDistance && -dy > Math.abs(dx)) this.input.pulse('modifier');
        else if (Math.abs(dx) >= TOUCH.swipeDistance && Math.abs(dx) >= Math.abs(dy)) this.input.pulse('finesse');
      }
      this.input.setActions(`touch:${id}`, []);
    }
    this.contacts.delete(id);
  }

  /** 누른 채 미는 동작: 패스 → 스루/로빙, 압박 → 슬라이딩 */
  private swipe(id: number, c: Contact, dx: number, dy: number): void {
    const far = Math.hypot(dx, dy) >= TOUCH.swipeDistance;
    if (this.mode === 'attack' && c.slot === 'pass') {
      // 한 번 정한 킥은 손가락을 되돌려도 유지한다 (중간 해제로 오발사 방지)
      if (far && Math.abs(dy) > Math.abs(dx)) this.input.setActions(`touch:${id}`, ['pass', dy < 0 ? 'through' : 'lob']);
    } else if (this.mode === 'defence' && c.slot === 'shoot' && far && !c.flicked) {
      c.flicked = true;
      this.input.tap('lob');
    }
  }

  setMode(mode: TouchMode): void {
    if (this.mode === mode) return;
    // 공 소유권이 바뀌면 기존 버튼을 새 태클/슛으로 오해하지 않게 끊는다.
    const hadButton = this.buttonUsed;
    this.buttonUsed = false;
    for (const [id, contact] of this.contacts) {
      if (id !== this.moveId && contact.slot !== 'sprint' && contact.slot !== 'pause') this.contacts.delete(id);
    }
    this.skillId = null;
    this.input.clearSkillMove();
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
    this.skillId = null;
    this.joystick = null;
    this.input.clearVirtual();
    if (hadButton) this.onCancel();
  }
}
