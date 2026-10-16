/**
 * 포메이션: 팀 기준 좌표 (fx: 공격 방향이 +, 자기 골대 쪽이 -, z: 폭 방향).
 * 경기장 길이 60m 기준, 자기 골라인이 fx = -30.
 * 선수 수를 늘릴 때(7대7, 11대11)는 여기에 슬롯만 추가하면 된다.
 */
export type Role = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface Slot {
  role: Role;
  label: string; // 포지션 표기 (GK, LCB, RCB, CM, ST ...)
  fx: number;
  z: number;
}

// 5대5: GK + 센터백 2 + 중앙 미드필더 + 스트라이커 (2-1-1)
export const FORMATION_5: Slot[] = [
  { role: 'GK', label: 'GK', fx: -29, z: 0 },
  { role: 'DEF', label: 'LCB', fx: -19, z: -7 },
  { role: 'DEF', label: 'RCB', fx: -19, z: 7 },
  { role: 'MID', label: 'CM', fx: -9, z: 0 },
  { role: 'FWD', label: 'ST', fx: -2, z: 0 },
];
