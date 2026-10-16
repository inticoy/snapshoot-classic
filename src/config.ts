// 모든 단위는 미터, 초, 킬로그램 (실제 스케일)
// 좌표계: X = 경기장 길이 방향(골대가 ±X 끝), Z = 폭 방향, Y = 위

export const PITCH = {
  length: 60,
  width: 38,
  get halfL() {
    return this.length / 2;
  },
  get halfW() {
    return this.width / 2;
  },
  boxDepth: 9, // 페널티 박스 깊이
  boxWidth: 18,
  centerCircle: 5,
  // 경기장 바깥 여유 공간 (광고판까지)
  runoffSide: 2,
  runoffEnd: 3,
};

export const GOAL = {
  width: 6,
  height: 2.2,
  depth: 1.8,
  postRadius: 0.06,
};

export const BALL = {
  radius: 0.11,
  mass: 0.43,
  // 공기 저항: F = -drag * |v| * v
  drag: 0.0055,
  // 마그누스 효과: F = magnus * (ω × v)
  magnus: 0.0032,
  // 지면 구름 저항
  rollingDecel: 0.9,
  rollingDamping: 0.12,
};

export const PHYSICS = {
  gravity: -9.81,
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
  staminaDrain: 0.18, // 초당 (스프린트 시)
  staminaRegen: 0.1,
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
};

export const TEAM_COLORS = [
  { name: 'HOME', shirt: 0xd8323f, shorts: 0xffffff, socks: 0xd8323f, keeper: 0x2ccf7a, ui: '#e84855' },
  { name: 'AWAY', shirt: 0xf4f4f0, shorts: 0x1d2a5b, socks: 0x1d2a5b, keeper: 0xf2c230, ui: '#e8ecf5' },
] as const;

export const AI = {
  reaction: 0.12, // 의사결정 주기
  tackleChancePerSec: 0.9,
  shootRange: 20,
  speedFactor: 0.96,
};
