/**
 * FC 온라인식 선수 능력치 (1~99).
 * 각 능력치가 게임에 주는 영향은 이 파일 아래쪽의 함수들에 모아 두었다.
 * 참고: 피파온라인 능력치 해설 (골 결정력 = 슈팅 정확도, 슛 파워 = 슈팅 속도,
 * 중거리 슛 = 박스 밖 슈팅 정확도, 반응 속도 = 자신에게 오는 공에 대한 대응 속도 등)
 */
export interface OutfieldStats {
  // 속도
  sprintSpeed: number; // 속력
  acceleration: number; // 가속력
  // 슈팅
  finishing: number; // 골 결정력
  shotPower: number; // 슛 파워
  longShots: number; // 중거리 슛
  curve: number; // 커브
  volleys: number; // 발리 슛
  heading: number; // 헤더
  // 패스
  shortPassing: number; // 짧은 패스
  longPassing: number; // 긴 패스
  vision: number; // 시야
  // 드리블
  dribbling: number; // 드리블
  ballControl: number; // 볼 컨트롤
  agility: number; // 민첩성
  balance: number; // 밸런스
  reactions: number; // 반응 속도
  composure: number; // 침착성
  // 수비
  defAwareness: number; // 대인 수비
  standingTackle: number; // 태클
  slidingTackle: number; // 슬라이딩 태클
  interceptions: number; // 가로채기
  // 피지컬
  strength: number; // 몸싸움
  jumping: number; // 점프
  stamina: number; // 스태미너
}

export interface KeeperStats {
  diving: number; // GK 다이빙
  handling: number; // GK 핸들링
  kicking: number; // GK 킥
  reflexes: number; // GK 반응 속도
  positioning: number; // GK 위치 선정
}

export type Stats = OutfieldStats & Partial<KeeperStats>;

export const STAT_LABELS: Record<keyof OutfieldStats | keyof KeeperStats, string> = {
  sprintSpeed: '속력',
  acceleration: '가속력',
  finishing: '골 결정력',
  shotPower: '슛 파워',
  longShots: '중거리 슛',
  curve: '커브',
  volleys: '발리 슛',
  heading: '헤더',
  shortPassing: '짧은 패스',
  longPassing: '긴 패스',
  vision: '시야',
  dribbling: '드리블',
  ballControl: '볼 컨트롤',
  agility: '민첩성',
  balance: '밸런스',
  reactions: '반응 속도',
  composure: '침착성',
  defAwareness: '대인 수비',
  standingTackle: '태클',
  slidingTackle: '슬라이딩 태클',
  interceptions: '가로채기',
  strength: '몸싸움',
  jumping: '점프',
  stamina: '스태미너',
  diving: 'GK 다이빙',
  handling: 'GK 핸들링',
  kicking: 'GK 킥',
  reflexes: 'GK 반응 속도',
  positioning: 'GK 위치 선정',
};

/** 능력치를 0..1 로 정규화 (40 → 0, 99 → 1). 40 미만은 0 */
export function n(v: number): number {
  return Math.min(1, Math.max(0, (v - 40) / 59));
}

const avg = (...v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/** 카드 앞면 6대 능력치 (FC 카드 표기) */
export function faceStats(s: Stats, keeper: boolean): [string, number][] {
  if (keeper && s.diving !== undefined) {
    return [
      ['DIV', s.diving],
      ['HAN', s.handling!],
      ['KIC', s.kicking!],
      ['REF', s.reflexes!],
      ['SPD', Math.round(avg(s.sprintSpeed, s.acceleration))],
      ['POS', s.positioning!],
    ];
  }
  return [
    ['PAC', Math.round(avg(s.sprintSpeed, s.acceleration))],
    ['SHO', Math.round(avg(s.finishing, s.shotPower, s.longShots, s.volleys, s.composure))],
    ['PAS', Math.round(avg(s.shortPassing, s.longPassing, s.vision, s.curve))],
    ['DRI', Math.round(avg(s.dribbling, s.ballControl, s.agility, s.balance, s.reactions))],
    ['DEF', Math.round(avg(s.defAwareness, s.standingTackle, s.slidingTackle, s.interceptions, s.heading))],
    ['PHY', Math.round(avg(s.strength, s.stamina, s.jumping))],
  ];
}

/** 포지션별 가중치로 계산한 OVR */
export function overall(s: Stats, pos: 'GK' | 'LB' | 'CB' | 'RB' | 'CM' | 'LW' | 'ST' | 'RW'): number {
  if (pos === 'GK' && s.diving !== undefined) {
    return Math.round(avg(s.diving, s.handling!, s.reflexes!, s.reflexes!, s.positioning!, s.positioning!, s.kicking! * 0.6 + 30));
  }
  if (pos === 'CB') {
    return Math.round(
      s.defAwareness * 0.22 + s.standingTackle * 0.18 + s.slidingTackle * 0.1 + s.interceptions * 0.13 +
        s.heading * 0.1 + s.strength * 0.1 + s.shortPassing * 0.05 + s.sprintSpeed * 0.04 + s.reactions * 0.08,
    );
  }
  if (pos === 'LB' || pos === 'RB') {
    return Math.round(s.defAwareness * 0.16 + s.standingTackle * 0.16 + s.interceptions * 0.12 +
      s.sprintSpeed * 0.12 + s.acceleration * 0.08 + s.stamina * 0.12 + s.shortPassing * 0.1 +
      s.longPassing * 0.08 + s.ballControl * 0.06);
  }
  if (pos === 'LW' || pos === 'RW') {
    return Math.round(s.dribbling * 0.19 + s.ballControl * 0.15 + s.sprintSpeed * 0.13 +
      s.acceleration * 0.12 + s.finishing * 0.13 + s.shortPassing * 0.1 + s.vision * 0.08 + s.curve * 0.1);
  }
  if (pos === 'CM') {
    return Math.round(
      s.shortPassing * 0.17 + s.longPassing * 0.13 + s.vision * 0.13 + s.ballControl * 0.14 + s.dribbling * 0.07 +
        s.reactions * 0.08 + s.interceptions * 0.05 + s.standingTackle * 0.05 + s.longShots * 0.06 +
        s.composure * 0.06 + s.stamina * 0.06,
    );
  }
  return Math.round(
    s.finishing * 0.22 + s.shotPower * 0.08 + s.longShots * 0.04 + s.volleys * 0.02 + s.heading * 0.04 +
      s.ballControl * 0.11 + s.dribbling * 0.09 + s.sprintSpeed * 0.08 + s.acceleration * 0.06 + s.reactions * 0.1 +
      s.composure * 0.06 + s.shortPassing * 0.05 + s.strength * 0.05,
  );
}

/** FC24 AcceleRATE 가속 유형 */
export type AccelType = 'explosive' | 'controlled' | 'lengthy';

/**
 * 키(cm): 선수 데이터에 없으면 이름 해시로 포지션별 범위에서 정한다 (같은 선수는 항상 같은 키)
 *  GK·CB 183~195 / 풀백·중앙 175~186 / 윙·공격수 168~185
 */
export function heightOf(name: string, pos: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const r = ((h >>> 0) % 1000) / 1000;
  const [lo, hi] = pos === 'GK' || pos === 'CB' ? [183, 195] : pos === 'LB' || pos === 'RB' || pos === 'CM' ? [175, 186] : [168, 185];
  return Math.round(lo + (hi - lo) * r);
}

/**
 * 가속 유형 (EA 공식 기준, fc-mechanics.md):
 *  폭발형: 키 ≤ 175, 민첩·가속 ≥ 80, 민첩 − 몸싸움 ≥ 20
 *  지속형: 키 ≥ 188, 몸싸움 ≥ 80, 가속 ≥ 55, 몸싸움 − 민첩 ≥ 20
 *  그 외 균형형
 */
export function accelType(s: Stats, height: number): AccelType {
  if (height <= 175 && s.agility >= 80 && s.acceleration >= 80 && s.agility - s.strength >= 20) return 'explosive';
  if (height >= 188 && s.strength >= 80 && s.acceleration >= 55 && s.strength - s.agility >= 20) return 'lengthy';
  return 'controlled';
}

/** 가속 곡선 배수: 최고 속도의 몇 %까지 왔는지(f)에 따라. 폭발형은 초반이 세고 후반이 약하다, 지속형은 반대 */
export function accelCurve(type: AccelType, f: number): number {
  if (type === 'explosive') return f < 0.6 ? 1.2 : 0.9;
  if (type === 'lengthy') return f < 0.6 ? 0.85 : 1.1;
  return 1;
}
