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

/**
 * 고를 수 있는 포메이션. 같은 순서의 선수(0 GK · 1~4 수비 · 5~7 중앙 미드 · 8 왼쪽 윙 · 9 스트라이커 · 10 오른쪽 윙)가
 * 비슷한 자리를 맡도록 칸 순서를 맞춘다. AI는 label로 역할을 읽는다
 *  LB/RB = 오버랩하는 풀백, LW/RW = 폭을 지키는 윙어, CM/CDM = 뒤에 남는 중앙 미드, ST = 최전방.
 */
export type FormationId = '4-3-3' | '4-4-2' | '4-2-3-1' | '3-5-2';

const GK: Slot = { role: 'GK', label: 'GK', fx: -51.5, z: 0 };
const BACK4: Slot[] = FORMATION_433.slice(1, 5);

export const FORMATIONS: Record<FormationId, Slot[]> = {
  '4-3-3': FORMATION_433,
  // 4-4-2: 윙어가 측면 미드로 내려오고, 중앙 미드 하나가 투톱의 짝으로 올라간다
  '4-4-2': [GK, ...BACK4,
    { role: 'MID', label: 'LCM', fx: -23, z: -9 },
    { role: 'FWD', label: 'CF', fx: -8, z: -6 },
    { role: 'MID', label: 'RCM', fx: -23, z: 9 },
    { role: 'MID', label: 'LM', fx: -17, z: -25 },
    { role: 'FWD', label: 'ST', fx: -8, z: 6 },
    { role: 'MID', label: 'RM', fx: -17, z: 25 }],
  // 4-2-3-1: 수비형 미드 둘 + 공격형 미드, 양 윙, 원톱
  '4-2-3-1': [GK, ...BACK4,
    { role: 'MID', label: 'LDM', fx: -25, z: -9 },
    { role: 'MID', label: 'CAM', fx: -14, z: 0 },
    { role: 'MID', label: 'RDM', fx: -25, z: 9 },
    { role: 'FWD', label: 'LW', fx: -10, z: -24 },
    { role: 'FWD', label: 'ST', fx: -2, z: 0 },
    { role: 'FWD', label: 'RW', fx: -10, z: 24 }],
  // 3-5-2: 스리백, 윙백(미드)이 측면 전체를 맡고, 투톱
  '3-5-2': [GK,
    { role: 'MID', label: 'LWB', fx: -22, z: -27 },
    { role: 'DEF', label: 'LCB', fx: -36, z: -12 },
    { role: 'DEF', label: 'CB', fx: -38, z: 0 },
    { role: 'DEF', label: 'RCB', fx: -36, z: 12 },
    { role: 'MID', label: 'LCM', fx: -22, z: -12 },
    { role: 'MID', label: 'CM', fx: -25, z: 0 },
    { role: 'MID', label: 'RCM', fx: -22, z: 12 },
    { role: 'FWD', label: 'CF', fx: -8, z: -6 },
    { role: 'FWD', label: 'ST', fx: -8, z: 6 },
    { role: 'MID', label: 'RWB', fx: -22, z: 27 }],
};
export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];
