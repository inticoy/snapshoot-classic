/** 가상의 선수 데이터 (실존 인물 아님) */
export interface PlayerProfile {
  name: string;
  short: string; // 하단 이름 바에 표시
  number: number;
  pos: 'GK' | 'CB' | 'ST';
  ovr: number;
  foot: 'L' | 'R';
  skill: number; // 개인기 별 (1~5)
}

export interface TeamProfile {
  name: string;
  abbr: string;
  players: [PlayerProfile, PlayerProfile, PlayerProfile]; // GK, DEF, FWD
}

export const TEAMS: [TeamProfile, TeamProfile] = [
  {
    name: 'Seoul Red',
    abbr: 'SRD',
    players: [
      { name: 'Han Do-yun', short: 'D. HAN', number: 1, pos: 'GK', ovr: 82, foot: 'R', skill: 1 },
      { name: 'Kang Min-jae', short: 'M. KANG', number: 4, pos: 'CB', ovr: 84, foot: 'R', skill: 2 },
      { name: 'Son Ji-hoon', short: 'J. SON', number: 7, pos: 'ST', ovr: 87, foot: 'L', skill: 4 },
    ],
  },
  {
    name: 'Atlantic Blue',
    abbr: 'ATL',
    players: [
      { name: 'Luca Ferreira', short: 'L. FERREIRA', number: 13, pos: 'GK', ovr: 81, foot: 'R', skill: 1 },
      { name: 'Ruben Castell', short: 'R. CASTELL', number: 5, pos: 'CB', ovr: 83, foot: 'L', skill: 2 },
      { name: 'Theo Marchand', short: 'T. MARCHAND', number: 10, pos: 'ST', ovr: 86, foot: 'R', skill: 5 },
    ],
  },
];
