/**
 * 키 배치: FC 온라인(넥슨) 키보드 기본 배치 기준
 *  공격  방향키 이동 · E 질주 · S 짧은 패스 · W 스루 패스 · A 로빙 패스 · D 슛
 *        Z+D 감아차기 · Q+D 칩슛 · Q+W 로빙 스루 패스
 *  수비  W(꾹) 키퍼 돌진 · S 선수 변경 · D(꾹) 압박 · Q(꾹) 동료 압박 · C(꾹) 견제 · Space 스탠딩 태클 · A 슬라이딩 태클
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

  private readonly virtual = new Map<string, Set<Action>>();
  private readonly virtualPressed = new Set<Action>();
  private readonly virtualReleased = new Set<Action>();
  private readonly pulses = new Set<Action>();
  private touchAxis = { x: 0, y: 0 };

  /** 포인터마다 소스를 분리해 한 손을 떼어도 다른 손/키보드 입력을 유지한다. */
  setActions(source: string, actions: Action[]): void {
    const before = new Set(Object.keys(ACTION_KEYS).filter((a) => this.isDown(a as Action)) as Action[]);
    if (actions.length) this.virtual.set(source, new Set(actions));
    else this.virtual.delete(source);
    for (const action of Object.keys(ACTION_KEYS) as Action[]) {
      const held = this.isDown(action);
      if (held && !before.has(action)) this.virtualPressed.add(action);
      if (!held && before.has(action)) this.virtualReleased.add(action);
    }
  }

  /** 뗄 때 결정한 스와이프 보조키를 다음 고정 스텝까지 보존한다. */
  pulse(action: Action): void { this.pulses.add(action); }

  /** 한 프레임짜리 누름 (스와이프로 결정되는 태클 등) */
  tap(action: Action): void {
    this.pulses.add(action);
    this.virtualPressed.add(action);
  }

  setMove(x: number, y: number): void {
    const scale = Math.max(1, Math.hypot(x, y));
    this.touchAxis = { x: x / scale, y: y / scale };
  }

  /** 취소는 킥의 release가 아니다. 호출 측에서도 진행 중인 차지를 취소한다. */
  clearVirtual(): void {
    this.clearVirtualActions();
    this.setMove(0, 0);
  }

  clearVirtualActions(): void {
    this.virtual.clear();
    this.virtualPressed.clear();
    this.virtualReleased.clear();
    this.pulses.clear();
  }

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
    if (ACTION_KEYS[action].some((k) => this.down.has(k)) || this.pulses.has(action)) return true;
    for (const actions of this.virtual.values()) if (actions.has(action)) return true;
    return false;
  }

  wasPressed(action: Action): boolean {
    return ACTION_KEYS[action].some((k) => this.pressedQueue.has(k)) || this.virtualPressed.has(action);
  }

  wasReleased(action: Action): boolean {
    return (ACTION_KEYS[action].some((k) => this.releasedQueue.has(k)) || this.virtualReleased.has(action)) && !this.isDown(action);
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
    x += this.touchAxis.x;
    y += this.touchAxis.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** 한 번의 게임 스텝이 엣지를 소비한 뒤 호출 */
  endFrame(): void {
    this.pressedQueue.clear();
    this.releasedQueue.clear();
    this.virtualPressed.clear();
    this.virtualReleased.clear();
    this.pulses.clear();
  }
}
