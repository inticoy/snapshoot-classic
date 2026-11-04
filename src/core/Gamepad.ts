import type { Action, Input } from './Input';

/**
 * 게임패드 (브라우저 표준 매핑, Xbox 표기). FC 콘솔 배치를 키보드(FC 온라인) 동작에 그대로 잇는다.
 *  A 짧은 패스(S) · B 슛(D) · X 로빙(A) · Y 스루(W) · LB 보조(Q) · RB 감아차기·Z 개인기(Z) · LT 견제(C) · RT 질주(E)
 *  L3 파워슛(F) · R3 스탠딩 태클(Space) · View 카메라 · Menu 일시정지
 *  왼쪽 스틱·십자키 이동, 오른쪽 스틱 개인기 (= Shift + 방향, RB를 누른 채면 Z + 방향)
 * 수비 때는 같은 버튼이 키보드처럼 바뀐다 (A 선수 변경 · B 압박 · X 슬라이딩 · LB 동료 압박 · LT 견제).
 */
export const PAD_ACTIONS: Readonly<Record<number, Action>> = {
  0: 'pass', 1: 'shoot', 2: 'lob', 3: 'through', 4: 'modifier', 5: 'finesse', 6: 'contain', 7: 'sprint',
  8: 'camera', 9: 'pause', 10: 'power', 11: 'tackle',
};
/** 메뉴 조작: 눌린 순간 키보드 키처럼 넣는다 */
const PAD_MENU_KEYS: Readonly<Record<number, string>> = { 0: 'Enter', 1: 'Escape', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight' };
const DPAD = { up: 12, down: 13, left: 14, right: 15 };

export const PAD = {
  /** 왼쪽 스틱 반경 데드존 (낡은 패드의 쏠림 무시) */
  moveDeadZone: 0.18,
  /** 오른쪽 스틱: 이만큼 넘게 밀어야 개인기 방향으로 읽는다 */
  skillDeadZone: 0.45,
  /** 오른쪽 스틱을 놓은 뒤에도 이 시간(초)은 개인기 입력을 이어 간다 (↓↑↑ 같은 연속 튕기기가 한 커맨드가 되게) */
  skillGrace: 0.3,
  /** 아날로그 트리거를 눌렀다고 보는 값 */
  trigger: 0.4,
};

type PadLike = Pick<Gamepad, 'buttons' | 'axes' | 'connected' | 'mapping'> & { id?: string };

export class GamepadInput {
  private readonly prev = new Set<number>();
  private grace = 0;
  private moving = false;
  private skilling = false;
  /** 지금 패드를 쓰는 중인지 (HUD 안내용) */
  active = false;

  constructor(private readonly input: Input, private readonly pads: () => readonly (PadLike | null)[] = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : [])) {}

  /** 매 화면 프레임: 패드 상태를 읽어 가상 입력으로 넣는다 */
  poll(dt: number): void {
    const pad = this.pads().find((p): p is PadLike => !!p && p.connected);
    if (!pad) {
      if (this.active) this.release();
      return;
    }
    const down = new Set<number>();
    pad.buttons.forEach((b, i) => { if (b.pressed || b.value > PAD.trigger) down.add(i); });
    for (const i of down) if (!this.prev.has(i) && PAD_MENU_KEYS[i]) this.input.injectPress(PAD_MENU_KEYS[i]);
    this.prev.clear();
    for (const i of down) this.prev.add(i);

    const actions = new Set<Action>();
    for (const i of down) { const a = PAD_ACTIONS[i]; if (a) actions.add(a); }

    // 이동: 왼쪽 스틱(반경 데드존 뒤 0..1로 다시 늘림) + 십자키
    let [x, y] = deadZone(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), PAD.moveDeadZone);
    x += (down.has(DPAD.right) ? 1 : 0) - (down.has(DPAD.left) ? 1 : 0);
    y += (down.has(DPAD.up) ? 1 : 0) - (down.has(DPAD.down) ? 1 : 0);
    const moving = x !== 0 || y !== 0;
    // 터치 조이스틱과 같은 축을 쓰므로, 패드가 움직이고 있거나 방금 멈췄을 때만 쓴다
    if (moving || this.moving) this.input.setMove(x, y);
    this.moving = moving;

    // 개인기: 오른쪽 스틱. 놓아도 잠깐은 보조키를 쥔 것으로 둬 연속 튕기기를 한 커맨드로
    const rx = pad.axes[2] ?? 0, ry = -(pad.axes[3] ?? 0), r = Math.hypot(rx, ry);
    if (r >= PAD.skillDeadZone) {
      this.grace = PAD.skillGrace;
      this.input.setSkillMove(rx / Math.max(1, r), ry / Math.max(1, r));
      this.skilling = true;
    } else if (this.grace > 0) {
      this.grace -= dt;
      this.input.setSkillMove(0, 0);
    } else if (this.skilling) {
      this.input.clearSkillMove();
      this.skilling = false;
    }
    // RB(Z)를 쥐고 있으면 Z 개인기, 아니면 Shift 개인기
    if (this.skilling && !actions.has('finesse')) actions.add('skill');
    this.input.setActions('pad', [...actions]);
    this.active = true;
  }

  /** 패드가 빠지면 누르던 것을 모두 뗀다 */
  private release(): void {
    this.input.setActions('pad', []);
    if (this.moving) this.input.setMove(0, 0);
    if (this.skilling) this.input.clearSkillMove();
    this.prev.clear();
    this.moving = this.skilling = this.active = false;
    this.grace = 0;
  }
}

/** 반경 데드존: 데드존 밖을 0..1로 다시 늘린다 (작게 기울여도 천천히 걷게) */
function deadZone(x: number, y: number, dz: number): [number, number] {
  const len = Math.hypot(x, y);
  if (len < dz) return [0, 0];
  const k = Math.min(1, (len - dz) / (1 - dz)) / len;
  return [x * k, y * k];
}
