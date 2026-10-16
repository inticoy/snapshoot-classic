/** 팀 기준 좌표: fx는 공격 방향 +, z는 왼쪽 음수. 105×68m 경기장 기준. */
export type Role = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface Slot {
  role: Role;
  label: string;
  fx: number;
  z: number;
}

// 킥오프 때는 키커를 제외한 전원이 자기 진영에 있고, 윙어는 폭을 유지한다.
export const FORMATION_433: Slot[] = [
  { role: 'GK', label: 'GK', fx: -51.5, z: 0 },
  { role: 'DEF', label: 'LB', fx: -33, z: -25 },
  { role: 'DEF', label: 'LCB', fx: -36, z: -9 },
  { role: 'DEF', label: 'RCB', fx: -36, z: 9 },
  { role: 'DEF', label: 'RB', fx: -33, z: 25 },
  { role: 'MID', label: 'LCM', fx: -20, z: -13 },
  { role: 'MID', label: 'CM', fx: -24, z: 0 },
  { role: 'MID', label: 'RCM', fx: -20, z: 13 },
  { role: 'FWD', label: 'LW', fx: -8, z: -26 },
  { role: 'FWD', label: 'ST', fx: -10, z: 0 },
  { role: 'FWD', label: 'RW', fx: -8, z: 26 },
];
