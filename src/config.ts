// 모든 단위는 미터, 초, 킬로그램 (실제 스케일)
// 좌표계: X = 경기장 길이 방향(골대가 ±X 끝), Z = 폭 방향, Y = 위

export const PITCH = {
  length: 105,
  width: 68,
  get halfL() {
    return this.length / 2;
  },
  get halfW() {
    return this.width / 2;
  },
  boxDepth: 16.5, // 페널티 박스 깊이
  boxWidth: 40.32,
  centerCircle: 9.15,
  goalAreaDepth: 5.5,
  goalAreaWidth: 18.32,
  penaltySpot: 11,
  penaltyArc: 9.15,
  cornerArc: 1,
  lineWidth: 0.12,
  flagHeight: 1.6,
  // 경기장 바깥 여유 공간 (광고판까지)
  runoffSide: 2,
  runoffEnd: 3,
};

export const GOAL = {
  width: 7.32,
  height: 2.44,
  depth: 1.8,
  postRadius: 0.06,
};

// 공 규격 (FIFA 5호구: 둘레 68~70cm, 410~450g).
// 공기 저항 · 마그누스 · 구름 저항 · 반발 계수는 src/physics/presets.ts 에서 관리한다.
export const BALL = {
  radius: 0.11,
  mass: 0.43,
};

export const PHYSICS = {
  gravity: -9.81, // 초기값. 실제 값은 프리셋의 gravity
  step: 1 / 120, // 게임 로직 고정 스텝
  subSteps: 2, // 물리 서브스텝 (터널링 방지)
};

export const PLAYER = {
  radius: 0.42,
  jogSpeed: 5.6,
  sprintSpeed: 7.9,
  dribbleSpeedFactor: 0.9,
  accel: 16,
  decel: 20,
  turnRate: 11,
  staminaDrain: 0.045, // 넓은 경기장에서도 약 30초 연속 질주 가능 (능력치로 보정)
  staminaRegen: 0.025,
  controlRadius: 0.7,
  dribbleOffset: 0.55,
  kickCooldown: 0.3,
  tackleRange: 1.15,
  tackleDuration: 0.32,
  tackleSpeed: 9,
  tackleCooldown: 0.9,
  // 스탠딩 태클: 짧고 빠르게 회복, 사거리 짧음
  standTackleRange: 0.95,
  standTackleDuration: 0.2,
  standTackleSpeed: 5.5,
  standTackleCooldown: 0.5,
};

export const KEEPER = {
  speed: 6.2,
  reach: 1.0,
  diveReach: 2.1,
  holdTime: 1.1,
  threatRange: 28,
  maxRushDepth: 10,
  reactionTime: 0.3,
  smotherRange: 2.4,
  smotherDuration: 0.65,
  diveDuration: 0.55,
  crossReach: 2.65,
  crossRange: 11,
  crossCrowdRadius: 2.5,
  recoveryTime: 0.45,
};

export const SHOT = {
  minSpeed: 14,
  maxSpeed: 31,
  chargeTime: 0.85, // 최대 파워까지 걸리는 시간
  finesseMinSpeed: 13,
  finesseMaxSpeed: 22,
  finesseSpin: 34,
};

export const PASS = {
  minSpeed: 8,
  maxSpeed: 22,
  chargeTime: 0.7,
};

export const MATCH = {
  durationSeconds: 240, // 실제 4분 = 90분 표시
  goalCelebration: 3,
  kickoffDelay: 1.2,
  /** 하프타임 휘슬 뒤 후반 킥오프까지 (사용자 경기에서는 하프타임 화면이 이 사이에 뜬다) */
  halftimeDelay: 3,
};

/** 경기 규칙 (IFAB 경기 규칙을 게임에 맞게 단순화) */
export const RULES = {
  /** 프리킥 때 상대가 떨어져야 하는 거리 (m) */
  wallDistance: 9.15,
  /** 페널티 마크: 골라인에서 11m */
  penaltySpot: 11,
  /** 어드밴티지를 지켜보는 시간 (초) */
  advantageTime: 2,
  /** 오프사이드 판정 여유 (m). 눈으로 구분 안 되는 간발의 차는 온사이드 */
  offsideMargin: 0.3,
  /** 직접 프리킥 슛을 노리는 최대 거리 (m) */
  freeKickShotRange: 30,
  /** 추가 시간 (분, 90분 환산) 범위 */
  stoppageMin: 1,
  stoppageMax: [3, 5] as const,
  /** 승부차기 한 번이 끝났다고 보는 시간 (초) */
  shootoutKickTime: 3.2,
  shootoutPause: 1.4,
};

export const TEAM_COLORS = [
  { name: 'HOME', shirt: 0xd8323f, shorts: 0xffffff, socks: 0xd8323f, keeper: 0x2ccf7a, ui: '#e84855' },
  { name: 'AWAY', shirt: 0xf4f4f0, shorts: 0x1d2a5b, socks: 0x1d2a5b, keeper: 0xf2c230, ui: '#e8ecf5' },
] as const;

export const AI = {
  runSwayPeriod: 2.5, // 공격수 좌우 움직임의 시간 척도 (시뮬레이션 초)
  reaction: 0.12, // 의사결정 주기
  tackleChancePerSec: 0.9,
  shootRange: 20,
  speedFactor: 1, // 넓은 경기장에서는 양 팀 모두 능력치에 맞는 속도로 뛴다.
  markLeash: 14,
  maxPassDistance: 30,
  pressurePassRange: 2,
  pressurePassChance: 0.3,
  forwardPassChance: 0.12,
  forwardVisionWeight: 0.16,
};

// 화면 픽셀 기준 입력 임계값: 작은 손떨림은 이동/슛 제스처로 보지 않는다.
export const TOUCH = { joystickRadius: 52, deadZone: 0.12, swipeDistance: 30 };
export const GRAPHICS = {
  high: { pixelRatio: 2, shadowSize: 2048, crowdDensity: 1 },
  // 픽셀 비율은 화질에 가장 크게 보이므로 1.75까지 유지하고, 대신 그림자와 관중을 줄인다
  low: { pixelRatio: 1.75, shadowSize: 1024, crowdDensity: 0.25 },
};

// 공 주변 약 50m를 보여 주되 터치라인에서도 시야 크기를 유지한다.
export const CAMERA = { fov: 42, height: 25, distance: 38, endMargin: 10 };
export const VISUAL = { animationDistance: 32, animationHz: 30, shadowDistance: 24 };
