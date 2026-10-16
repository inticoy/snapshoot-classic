/**
 * 키 배치: FC 온라인(넥슨) 키보드 기본 배치 기준
 *  공격  방향키 이동 · E 질주 · S 짧은 패스 · W 스루 패스 · A 로빙 패스 · D 슛
 *        Z+D 감아차기 · Q+D 칩슛 · Q+W 로빙 스루 패스
 *  수비  S 선수 변경 · D(꾹) 압박 · Q(꾹) 동료 압박 · C(꾹) 견제 · Space 스탠딩 태클 · A 슬라이딩 태클
 */
export type Action =
  | 'shoot'
  | 'pass'
  | 'through'
  | 'lob'
  | 'sprint'
  | 'modifier'
  | 'finesse'
  | 'contain'
  | 'tackle'
  | 'pause'
  | 'camera'
  | 'confirm'
  | 'back';

export const ACTION_KEYS: Record<Action, string[]> = {
  shoot: ['KeyD'],
  pass: ['KeyS'],
  through: ['KeyW'],
  lob: ['KeyA'],
  sprint: ['KeyE'],
  modifier: ['KeyQ'], // 공격: 칩슛/로빙 스루 보조키 / 수비: 동료 압박
  finesse: ['KeyZ'], // 공격: 감아차기 보조키
  contain: ['KeyC'], // 수비: 견제
  tackle: ['Space'], // 수비: 스탠딩 태클
  pause: ['Escape', 'KeyP'],
  camera: ['KeyV'],
  confirm: ['Enter'],
  back: ['Escape', 'Backspace'],
};

const MOVE_KEYS = {
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
};

const GAME_KEYS = new Set([...Object.values(ACTION_KEYS).flat(), ...Object.values(MOVE_KEYS).flat()]);

export interface ButtonState {
  held: boolean;
  pressed: boolean;
  released: boolean;
}

/**
 * 키보드 상태. 프레임 단위로 pressed / released 엣지를 제공한다.
 * 고정 스텝 루프에서 엣지를 놓치지 않도록 consume 방식으로 처리한다.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressedQueue = new Set<string>();
  private readonly releasedQueue = new Set<string>();
  /** 메뉴 조작용: 눌린 순서 그대로 (같은 키 연타도 보존) */
  private readonly pressOrder: string[] = [];

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressedQueue.add(e.code);
      this.pressOrder.push(e.code);
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedQueue.add(e.code);
    });
    target.addEventListener('blur', () => {
      for (const code of this.down) this.releasedQueue.add(code);
      this.down.clear();
    });
  }

  isDown(action: Action): boolean {
    return ACTION_KEYS[action].some((k) => this.down.has(k));
  }

  wasPressed(action: Action): boolean {
    return ACTION_KEYS[action].some((k) => this.pressedQueue.has(k));
  }

  wasReleased(action: Action): boolean {
    return ACTION_KEYS[action].some((k) => this.releasedQueue.has(k)) && !this.isDown(action);
  }

  /** 이번 프레임까지 눌린 키들을 순서대로 꺼낸다 */
  drainPresses(): string[] {
    return this.pressOrder.splice(0);
  }

  button(action: Action): ButtonState {
    return { held: this.isDown(action), pressed: this.wasPressed(action), released: this.wasReleased(action) };
  }

  /** 화면 기준 이동 입력. x = 오른쪽, y = 위쪽 (-1..1), 대각선 정규화 */
  moveAxis(): { x: number; y: number } {
    const has = (keys: string[]) => keys.some((k) => this.down.has(k));
    let x = (has(MOVE_KEYS.right) ? 1 : 0) - (has(MOVE_KEYS.left) ? 1 : 0);
    let y = (has(MOVE_KEYS.up) ? 1 : 0) - (has(MOVE_KEYS.down) ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** 한 번의 게임 스텝이 엣지를 소비한 뒤 호출 */
  endFrame(): void {
    this.pressedQueue.clear();
    this.releasedQueue.clear();
  }
}
