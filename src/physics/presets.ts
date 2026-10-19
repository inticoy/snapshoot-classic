/**
 * 물리 프리셋.
 *
 * REAL   실측값 기반. 출처는 각 항목 주석 참고.
 * ARCADE REAL 위에 덮어쓰는 게임용 보정. 게임 감각은 여기서만 조정한다.
 *
 * 게임 코드는 activePhysics() 만 읽는다.
 */

export interface PhysicsPreset {
  /** 중력 가속도 (m/s²) */
  gravity: number;
  /** 공기 밀도 (kg/m³) */
  airDensity: number;
  /**
   * 항력 계수 곡선 (drag crisis).
   * 축구공은 약 10~13 m/s 부근에서 경계층이 난류로 바뀌며 항력이 급감한다.
   * 그 이후로는 속도가 오르면 조금씩 다시 증가한다.
   */
  dragLow: number; // 느린 공 Cd
  dragHigh: number; // drag crisis 이후 Cd
  dragCrisisSpeed: number; // 전환 중심 속도 (m/s)
  dragCrisisWidth: number; // 전환 폭 (m/s)
  dragRiseAfter: number; // 전환 이후 속도 1 m/s당 Cd 증가
  /**
   * 마그누스 양력: C_L = min(liftSlope · S, liftMax), S = rω / v (스핀 파라미터)
   */
  liftSlope: number;
  liftMax: number;
  /** 잔디 구름 저항: 감속 = rollDecel + rollDamping · v (m/s²) */
  rollDecel: number;
  rollDamping: number;
  /** 공 ↔ 잔디 반발 계수, 마찰 */
  groundRestitution: number;
  groundFriction: number;
  /** 공 ↔ 골대 반발 계수 */
  postRestitution: number;
  /** 공 ↔ 키퍼 몸: 손 선방과 별개인 충돌 반발·마찰 */
  keeperRestitution: number;
  keeperFriction: number;
  /** 지면에서 사이드스핀이 줄어드는 비율 (스텝당 유지율) */
  groundSpinKeep: number;
}

export const REAL: PhysicsPreset = {
  gravity: 9.81,
  airDensity: 1.2,
  // Choppin 등 / Goff & Carré의 축구공 측정: 느린 공 Cd ≈ 0.4~0.5,
  // drag crisis 이후 ≈ 0.2~0.25, 그 뒤 완만히 상승
  dragLow: 0.45,
  dragHigh: 0.22,
  dragCrisisSpeed: 11.5,
  dragCrisisWidth: 1.8,
  dragRiseAfter: 0.002,
  // Goff & Carré: S 0.1~0.4 구간에서 C_L ≈ 0.1~0.3
  liftSlope: 1.0,
  liftMax: 0.32,
  // FIFA 인조잔디 공 구르기 시험(1m 경사로에서 4~10m 굴러감)을 역산한 감속 범위 0.6~1.5 m/s²의 중간값
  rollDecel: 0.9,
  rollDamping: 0.06,
  // FIFA 기준: 2m 낙하 시 0.6~1.0m 반발. 공기 저항까지 포함해서 이 범위에 들도록 맞춘 접촉 반발 계수
  groundRestitution: 0.72,
  groundFriction: 0.45,
  postRestitution: 0.75,
  keeperRestitution: 0.28,
  keeperFriction: 0.35,
  groundSpinKeep: 0.985,
};

// 몸통·다리·머리를 합친 운동학적 충돌체. 손은 확률 선방이 담당한다.
export const KEEPER_BODY = {
  torso: [0.24, 0.3, 0.16] as const,
  legs: [0.18, 0.35, 0.14] as const,
  headRadius: 0.12,
  standingHeight: 0.95,
  lyingHeight: 0.27,
  poseTime: 0.18,
  roll: 1.45,
  blockCooldown: 0.15,
};

/** 게임 감각을 위한 보정. REAL 대비 무엇을 왜 바꿨는지 함께 적는다 */
export const ARCADE_OVERRIDES: Partial<PhysicsPreset> = {
  // 놓친 공을 쫓아갈 수 있도록 땅볼이 더 빨리 선다 (10 m/s 땅볼 약 23m)
  rollDecel: 1.4,
  rollDamping: 0.24,
  // 감아차기가 눈에 보이도록 커브를 조금 키운다
  liftSlope: 1.27,
  liftMax: 0.38,
  // 땅에 닿은 사이드스핀은 빨리 죽인다 (굴러가는 공이 휘지 않게)
  groundSpinKeep: 0.97,
  // drag crisis를 평평하게: 느린 로빙/칩슛의 비거리를 예측하기 쉽게 (패스·슛 세기 공식이 이 값 기준)
  dragLow: 0.24,
  dragHigh: 0.23,
  // 공기 저항이 작은 만큼 반발을 낮춰 실제와 비슷한 반발 높이 유지
  groundRestitution: 0.62,
};

export const ARCADE: PhysicsPreset = { ...REAL, ...ARCADE_OVERRIDES };

export type PresetName = 'arcade' | 'real';
export const PRESETS: Record<PresetName, PhysicsPreset> = { arcade: ARCADE, real: REAL };
export const PRESET_LABEL: Record<PresetName, string> = { arcade: '아케이드', real: '실제' };

let active: PhysicsPreset = ARCADE;

export function activePhysics(): PhysicsPreset {
  return active;
}

export function setActivePhysics(name: PresetName): void {
  active = PRESETS[name];
}

// ---------------------------------------------------------------- 공식

/** 속도별 항력 계수 (drag crisis 포함) */
export function dragCoefficient(p: PhysicsPreset, speed: number): number {
  const t = 1 / (1 + Math.exp((speed - p.dragCrisisSpeed) / (p.dragCrisisWidth / 4)));
  const high = p.dragHigh + Math.max(0, speed - p.dragCrisisSpeed) * p.dragRiseAfter;
  return high + (p.dragLow - high) * t;
}

/** 단면적 πr² */
export function crossSection(radius: number): number {
  return Math.PI * radius * radius;
}

/** 양력 계수: 스핀 파라미터 S = rω/v */
export function liftCoefficient(p: PhysicsPreset, radius: number, spin: number, speed: number): number {
  if (speed < 0.5) return 0;
  return Math.min(p.liftSlope * ((radius * Math.abs(spin)) / speed), p.liftMax);
}

/** 회전하는 공의 횡가속도 (m/s²) — 감아차기 조준 보정에 사용 */
export function magnusAccel(p: PhysicsPreset, radius: number, mass: number, spin: number, speed: number): number {
  const cl = liftCoefficient(p, radius, spin, speed);
  return (0.5 * p.airDensity * crossSection(radius) * cl * speed * speed) / mass;
}

/** 개인기 터치 사이 잔디 구름 감속. 키의 도착 시각·위치는 유지하면서 초속도를 역산한다 (m/s²). */
export const SKILL_ROLL_DECEL = 3;
