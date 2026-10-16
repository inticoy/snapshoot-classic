import { overall, type Stats } from './Stats';

/** 가상의 선수 데이터 (실존 인물 아님) */
export interface PlayerProfile {
  name: string;
  short: string; // 하단 이름 바에 표시
  number: number;
  pos: 'GK' | 'CB' | 'ST';
  ovr: number;
  foot: 'L' | 'R';
  weakFoot: number; // 약발 (1~5)
  skill: number; // 개인기 별 (1~5)
  stats: Stats;
}

export interface TeamProfile {
  name: string;
  abbr: string;
  players: [PlayerProfile, PlayerProfile, PlayerProfile]; // GK, DEF, FWD
}

type ProfileInput = Omit<PlayerProfile, 'ovr'>;
const make = (p: ProfileInput): PlayerProfile => ({ ...p, ovr: overall(p.stats, p.pos) });

// 필드 능력치 기본값을 깔고 선수별로 덮어쓴다
const base = (o: Partial<Stats>): Stats => ({
  sprintSpeed: 70, acceleration: 70, finishing: 50, shotPower: 65, longShots: 50, curve: 55,
  shortPassing: 65, longPassing: 60, vision: 60, dribbling: 62, ballControl: 65, agility: 65,
  balance: 65, reactions: 70, composure: 65, defAwareness: 55, standingTackle: 55,
  slidingTackle: 50, interceptions: 55, strength: 70, stamina: 75,
  ...o,
});

export const TEAMS: [TeamProfile, TeamProfile] = [
  {
    name: 'Seoul Red',
    abbr: 'SRD',
    players: [
      make({
        name: 'Han Do-yun', short: 'D. HAN', number: 1, pos: 'GK', foot: 'R', weakFoot: 2, skill: 1,
        stats: base({
          sprintSpeed: 52, acceleration: 55, shortPassing: 58, longPassing: 66, reactions: 82, strength: 74,
          diving: 84, handling: 80, kicking: 76, reflexes: 86, positioning: 82,
        }),
      }),
      make({
        name: 'Kang Min-jae', short: 'M. KANG', number: 4, pos: 'CB', foot: 'R', weakFoot: 3, skill: 2,
        stats: base({
          sprintSpeed: 84, acceleration: 76, finishing: 40, shotPower: 74, longShots: 48, shortPassing: 76,
          longPassing: 72, vision: 62, dribbling: 66, ballControl: 72, agility: 66, balance: 64, reactions: 84,
          composure: 80, defAwareness: 88, standingTackle: 87, slidingTackle: 84, interceptions: 86,
          strength: 91, stamina: 82,
        }),
      }),
      make({
        name: 'Son Ji-hoon', short: 'J. SON', number: 7, pos: 'ST', foot: 'L', weakFoot: 5, skill: 4,
        stats: base({
          sprintSpeed: 89, acceleration: 86, finishing: 90, shotPower: 86, longShots: 87, curve: 84,
          shortPassing: 82, longPassing: 76, vision: 80, dribbling: 86, ballControl: 85, agility: 86,
          balance: 80, reactions: 87, composure: 86, defAwareness: 40, standingTackle: 42, slidingTackle: 36,
          interceptions: 38, strength: 68, stamina: 86,
        }),
      }),
    ],
  },
  {
    name: 'Atlantic Blue',
    abbr: 'ATL',
    players: [
      make({
        name: 'Luca Ferreira', short: 'L. FERREIRA', number: 13, pos: 'GK', foot: 'R', weakFoot: 3, skill: 1,
        stats: base({
          sprintSpeed: 50, acceleration: 54, shortPassing: 66, longPassing: 70, reactions: 80, strength: 78,
          diving: 82, handling: 83, kicking: 74, reflexes: 81, positioning: 84,
        }),
      }),
      make({
        name: 'Ruben Castell', short: 'R. CASTELL', number: 5, pos: 'CB', foot: 'L', weakFoot: 2, skill: 2,
        stats: base({
          sprintSpeed: 72, acceleration: 66, finishing: 42, shotPower: 78, longShots: 55, shortPassing: 80,
          longPassing: 82, vision: 72, dribbling: 64, ballControl: 76, agility: 60, balance: 70, reactions: 82,
          composure: 84, defAwareness: 86, standingTackle: 85, slidingTackle: 82, interceptions: 84,
          strength: 85, stamina: 76,
        }),
      }),
      make({
        name: 'Theo Marchand', short: 'T. MARCHAND', number: 10, pos: 'ST', foot: 'R', weakFoot: 4, skill: 5,
        stats: base({
          sprintSpeed: 82, acceleration: 88, finishing: 85, shotPower: 80, longShots: 82, curve: 90,
          shortPassing: 86, longPassing: 80, vision: 88, dribbling: 91, ballControl: 90, agility: 92,
          balance: 88, reactions: 85, composure: 84, defAwareness: 36, standingTackle: 38, slidingTackle: 30,
          interceptions: 40, strength: 60, stamina: 80,
        }),
      }),
    ],
  },
];
