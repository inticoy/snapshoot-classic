export type Action = 'shoot' | 'pass' | 'finesse' | 'sprint' | 'switch' | 'pause' | 'camera' | 'start';

const ACTION_KEYS: Record<Action, string[]> = {
  shoot: ['KeyJ', 'Space'],
  pass: ['KeyK'],
  finesse: ['KeyL'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  switch: ['KeyQ'],
  pause: ['KeyP', 'Escape'],
  camera: ['KeyC'],
  start: ['Enter'],
};

const MOVE_KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
};

const GAME_KEYS = new Set([...Object.values(ACTION_KEYS).flat(), ...Object.values(MOVE_KEYS).flat()]);

/**
 * 키보드 상태. 프레임 단위로 pressed / released 엣지를 제공한다.
 * 고정 스텝 루프에서 엣지를 놓치지 않도록 consume 방식으로 처리한다.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressedQueue = new Set<string>();
  private readonly releasedQueue = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressedQueue.add(e.code);
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
