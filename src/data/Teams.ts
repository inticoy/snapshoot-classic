import { overall, type Stats } from './Stats';

/** 가상의 선수 데이터 (실존 인물 아님) */
export interface PlayerProfile {
  name: string;
  short: string; // 하단 이름 바에 표시
  number: number;
  pos: 'GK' | 'LB' | 'CB' | 'RB' | 'CM' | 'LW' | 'ST' | 'RW';
  ovr: number;
  foot: 'L' | 'R';
  weakFoot: number; // 약발 (1~5)
  skill: number; // 개인기 별 (1~5)
  stats: Stats;
}

export interface TeamProfile {
  name: string;
  abbr: string;
  /** 4-3-3 슬롯 순서와 같다 (GK, LB, LCB, RCB, RB, LCM, CM, RCM, LW, ST, RW) */
  players: PlayerProfile[];
  bench: PlayerProfile[];
}

type ProfileInput = Omit<PlayerProfile, 'ovr'>;
const make = (p: ProfileInput): PlayerProfile => ({ ...p, ovr: overall(p.stats, p.pos) });

// 필드 능력치 기본값을 깔고 선수별로 덮어쓴다
const base = (o: Partial<Stats>): Stats => ({
  sprintSpeed: 70, acceleration: 70, finishing: 50, shotPower: 65, longShots: 50, curve: 55, volleys: 50,
  heading: 55, shortPassing: 65, longPassing: 60, vision: 60, dribbling: 62, ballControl: 65, agility: 65,
  balance: 65, reactions: 70, composure: 65, defAwareness: 55, standingTackle: 55,
  slidingTackle: 50, interceptions: 55, strength: 70, jumping: 68, stamina: 75,
  ...o,
});

const keeper = (o: Partial<Stats>) =>
  base({ sprintSpeed: 52, acceleration: 55, shortPassing: 60, longPassing: 66, reactions: 80, heading: 40, jumping: 74, ...o });

export const TEAMS: [TeamProfile, TeamProfile] = [
  {
    name: 'Seoul Red',
    abbr: 'SRD',
    players: [
      make({
        name: 'Han Do-yun', short: 'D. HAN', number: 1, pos: 'GK', foot: 'R', weakFoot: 2, skill: 1,
        stats: keeper({ reactions: 82, strength: 74, diving: 84, handling: 80, kicking: 76, reflexes: 86, positioning: 82 }),
      }),
      make({
        name: 'Seo Ha-ram', short: 'H. SEO', number: 22, pos: 'LB', foot: 'L', weakFoot: 3, skill: 3,
        stats: base({ sprintSpeed: 85, acceleration: 84, stamina: 89, shortPassing: 78, longPassing: 76, curve: 75, defAwareness: 78, standingTackle: 80, slidingTackle: 78, interceptions: 78, finishing: 42 }),
      }),
      make({
        name: 'Kang Min-jae', short: 'M. KANG', number: 4, pos: 'CB', foot: 'R', weakFoot: 3, skill: 2,
        stats: base({
          sprintSpeed: 84, acceleration: 76, finishing: 40, shotPower: 74, longShots: 48, shortPassing: 76,
          longPassing: 72, vision: 62, dribbling: 66, ballControl: 72, agility: 66, balance: 64, reactions: 84,
          composure: 80, defAwareness: 88, standingTackle: 87, slidingTackle: 84, interceptions: 86,
          heading: 86, jumping: 84, strength: 91, stamina: 82,
        }),
      }),
      make({
        name: 'Yoon Tae-oh', short: 'T. YOON', number: 3, pos: 'CB', foot: 'L', weakFoot: 2, skill: 2,
        stats: base({
          sprintSpeed: 74, acceleration: 70, shotPower: 70, shortPassing: 78, longPassing: 80, vision: 70,
          ballControl: 74, reactions: 80, composure: 78, defAwareness: 82, standingTackle: 83, slidingTackle: 80,
          interceptions: 81, heading: 80, jumping: 78, strength: 82, stamina: 78,
        }),
      }),
      make({
        name: 'Lim Geon', short: 'G. LIM', number: 2, pos: 'RB', foot: 'R', weakFoot: 3, skill: 3,
        stats: base({ sprintSpeed: 83, acceleration: 82, stamina: 87, shortPassing: 76, longPassing: 74, defAwareness: 80, standingTackle: 82, slidingTackle: 79, interceptions: 79, finishing: 40 }),
      }),
      make({
        name: 'Jang Yu-bin', short: 'Y. JANG', number: 6, pos: 'CM', foot: 'L', weakFoot: 4, skill: 3,
        stats: base({ shortPassing: 84, longPassing: 82, vision: 83, ballControl: 82, dribbling: 78, longShots: 76, finishing: 66, defAwareness: 74, standingTackle: 76, interceptions: 78, stamina: 88 }),
      }),
      make({
        name: 'Baek Si-woo', short: 'S. BAEK', number: 8, pos: 'CM', foot: 'R', weakFoot: 4, skill: 4,
        stats: base({
          sprintSpeed: 76, acceleration: 80, finishing: 72, shotPower: 82, longShots: 84, curve: 82, volleys: 74,
          heading: 60, shortPassing: 88, longPassing: 86, vision: 88, dribbling: 84, ballControl: 87, agility: 82,
          balance: 80, reactions: 85, composure: 86, defAwareness: 68, standingTackle: 70, slidingTackle: 62,
          interceptions: 74, strength: 70, jumping: 64, stamina: 90,
        }),
      }),
      make({
        name: 'Oh Da-on', short: 'D. OH', number: 16, pos: 'CM', foot: 'R', weakFoot: 3, skill: 3,
        stats: base({ shortPassing: 81, longPassing: 79, vision: 80, ballControl: 80, dribbling: 76, finishing: 70, longShots: 78, defAwareness: 76, standingTackle: 77, interceptions: 80, stamina: 90 }),
      }),
      make({
        name: 'Chae Ro-un', short: 'R. CHAE', number: 11, pos: 'LW', foot: 'R', weakFoot: 4, skill: 4,
        stats: base({ sprintSpeed: 91, acceleration: 90, agility: 88, dribbling: 87, ballControl: 84, finishing: 79, shotPower: 79, curve: 82, shortPassing: 80, vision: 78, defAwareness: 38, standingTackle: 36, interceptions: 40, stamina: 83 }),
      }),
      make({
        name: 'Son Ji-hoon', short: 'J. SON', number: 7, pos: 'ST', foot: 'L', weakFoot: 5, skill: 4,
        stats: base({
          sprintSpeed: 89, acceleration: 86, finishing: 90, shotPower: 86, longShots: 87, curve: 84, volleys: 84,
          heading: 74, shortPassing: 82, longPassing: 76, vision: 80, dribbling: 86, ballControl: 85, agility: 86,
          balance: 80, reactions: 87, composure: 86, defAwareness: 40, standingTackle: 42, slidingTackle: 36,
          interceptions: 38, strength: 68, jumping: 72, stamina: 86,
        }),
      }),
      make({
        name: 'Nam I-jun', short: 'I. NAM', number: 17, pos: 'RW', foot: 'L', weakFoot: 4, skill: 4,
        stats: base({ sprintSpeed: 88, acceleration: 91, agility: 89, dribbling: 88, ballControl: 85, finishing: 80, shotPower: 82, curve: 85, shortPassing: 79, vision: 80, defAwareness: 39, standingTackle: 37, interceptions: 41, stamina: 84 }),
      }),
    ],
    bench: [
      make({ name: 'Bae Ha-on', short: 'H. BAE', number: 12, pos: 'GK', foot: 'R', weakFoot: 3, skill: 1, stats: keeper({ diving: 77, handling: 76, kicking: 73, reflexes: 80, positioning: 78 }) }),
      make({ name: 'Ryu Se-on', short: 'S. RYU', number: 15, pos: 'CB', foot: 'R', weakFoot: 3, skill: 3, stats: base({ defAwareness: 79, standingTackle: 80, interceptions: 77, heading: 78, strength: 83 }) }),
      make({ name: 'Do Ra-on', short: 'R. DO', number: 19, pos: 'CM', foot: 'R', weakFoot: 3, skill: 3, stats: base({ shortPassing: 81, longPassing: 78, vision: 79, ballControl: 80, stamina: 85 }) }),
      make({ name: 'Ma I-sol', short: 'I. MA', number: 24, pos: 'LW', foot: 'R', weakFoot: 3, skill: 3, stats: base({ sprintSpeed: 87, acceleration: 86, dribbling: 82, ballControl: 80, finishing: 73 }) }),
      make({ name: 'Gu Ye-on', short: 'Y. GU', number: 27, pos: 'ST', foot: 'R', weakFoot: 3, skill: 3, stats: base({ finishing: 80, shotPower: 79, heading: 78, strength: 80, reactions: 79 }) }),
    ],
  },
  {
    name: 'Atlantic Blue',
    abbr: 'ATL',
    players: [
      make({
        name: 'Luca Ferreira', short: 'L. FERREIRA', number: 13, pos: 'GK', foot: 'R', weakFoot: 3, skill: 1,
        stats: keeper({ shortPassing: 66, longPassing: 70, strength: 78, diving: 82, handling: 83, kicking: 74, reflexes: 81, positioning: 84 }),
      }),
      make({
        name: 'Nilo Varen', short: 'N. VAREN', number: 3, pos: 'LB', foot: 'L', weakFoot: 3, skill: 3,
        stats: base({ sprintSpeed: 82, acceleration: 80, stamina: 88, shortPassing: 79, longPassing: 78, defAwareness: 81, standingTackle: 80, slidingTackle: 77, interceptions: 80, finishing: 44 }),
      }),
      make({
        name: 'Ruben Castell', short: 'R. CASTELL', number: 5, pos: 'CB', foot: 'L', weakFoot: 2, skill: 2,
        stats: base({
          sprintSpeed: 72, acceleration: 66, finishing: 42, shotPower: 78, longShots: 55, shortPassing: 80,
          longPassing: 82, vision: 72, dribbling: 64, ballControl: 76, agility: 60, balance: 70, reactions: 82,
          composure: 84, defAwareness: 86, standingTackle: 85, slidingTackle: 82, interceptions: 84,
          heading: 87, jumping: 86, strength: 85, stamina: 76,
        }),
      }),
      make({
        name: 'Jonas Wehrle', short: 'J. WEHRLE', number: 2, pos: 'CB', foot: 'R', weakFoot: 3, skill: 2,
        stats: base({
          sprintSpeed: 80, acceleration: 74, shotPower: 68, shortPassing: 72, longPassing: 70, vision: 62,
          ballControl: 70, reactions: 79, composure: 74, defAwareness: 81, standingTackle: 82, slidingTackle: 84,
          interceptions: 78, heading: 82, jumping: 80, strength: 84, stamina: 80,
        }),
      }),
      make({
        name: 'Emil Soren', short: 'E. SOREN', number: 22, pos: 'RB', foot: 'R', weakFoot: 4, skill: 3,
        stats: base({ sprintSpeed: 86, acceleration: 84, stamina: 86, shortPassing: 77, longPassing: 75, defAwareness: 76, standingTackle: 79, slidingTackle: 80, interceptions: 77, finishing: 46 }),
      }),
      make({
        name: 'Ivo Neris', short: 'I. NERIS', number: 8, pos: 'CM', foot: 'R', weakFoot: 4, skill: 3,
        stats: base({ shortPassing: 85, longPassing: 81, vision: 84, ballControl: 84, dribbling: 81, finishing: 72, longShots: 79, defAwareness: 70, standingTackle: 72, interceptions: 73, stamina: 87 }),
      }),
      make({
        name: 'Mateo Ruiz', short: 'M. RUIZ', number: 6, pos: 'CM', foot: 'L', weakFoot: 3, skill: 3,
        stats: base({
          sprintSpeed: 70, acceleration: 74, finishing: 66, shotPower: 78, longShots: 80, curve: 78, volleys: 70,
          heading: 66, shortPassing: 87, longPassing: 85, vision: 84, dribbling: 80, ballControl: 86, agility: 76,
          balance: 82, reactions: 84, composure: 88, defAwareness: 76, standingTackle: 78, slidingTackle: 70,
          interceptions: 82, strength: 76, jumping: 66, stamina: 88,
        }),
      }),
      make({
        name: 'Dario Velin', short: 'D. VELIN', number: 16, pos: 'CM', foot: 'R', weakFoot: 3, skill: 3,
        stats: base({ shortPassing: 80, longPassing: 78, vision: 79, ballControl: 78, dribbling: 73, finishing: 62, longShots: 74, defAwareness: 82, standingTackle: 81, interceptions: 83, stamina: 91 }),
      }),
      make({
        name: 'Elio Taren', short: 'E. TAREN', number: 11, pos: 'LW', foot: 'R', weakFoot: 4, skill: 4,
        stats: base({ sprintSpeed: 90, acceleration: 88, agility: 87, dribbling: 86, ballControl: 85, finishing: 81, shotPower: 80, curve: 80, shortPassing: 82, vision: 81, defAwareness: 40, standingTackle: 38, interceptions: 42, stamina: 84 }),
      }),
      make({
        name: 'Theo Marchand', short: 'T. MARCHAND', number: 10, pos: 'ST', foot: 'R', weakFoot: 4, skill: 5,
        stats: base({
          sprintSpeed: 82, acceleration: 88, finishing: 85, shotPower: 80, longShots: 82, curve: 90, volleys: 80,
          heading: 70, shortPassing: 86, longPassing: 80, vision: 88, dribbling: 91, ballControl: 90, agility: 92,
          balance: 88, reactions: 85, composure: 84, defAwareness: 36, standingTackle: 38, slidingTackle: 30,
          interceptions: 40, strength: 60, jumping: 66, stamina: 80,
        }),
      }),
      make({
        name: 'Milo Auren', short: 'M. AUREN', number: 7, pos: 'RW', foot: 'L', weakFoot: 5, skill: 4,
        stats: base({ sprintSpeed: 87, acceleration: 90, agility: 90, dribbling: 90, ballControl: 87, finishing: 78, shotPower: 78, curve: 86, shortPassing: 84, vision: 83, defAwareness: 36, standingTackle: 34, interceptions: 38, stamina: 82 }),
      }),
    ],
    bench: [
      make({ name: 'Nerio Valden', short: 'N. VALDEN', number: 12, pos: 'GK', foot: 'R', weakFoot: 3, skill: 1, stats: keeper({ diving: 78, handling: 79, kicking: 71, reflexes: 77, positioning: 80 }) }),
      make({ name: 'Tavio Merel', short: 'T. MEREL', number: 15, pos: 'RB', foot: 'R', weakFoot: 3, skill: 3, stats: base({ sprintSpeed: 81, acceleration: 80, defAwareness: 77, standingTackle: 78, stamina: 85 }) }),
      make({ name: 'Orin Vesk', short: 'O. VESK', number: 19, pos: 'CM', foot: 'R', weakFoot: 3, skill: 3, stats: base({ shortPassing: 82, longPassing: 79, vision: 80, ballControl: 81, interceptions: 76 }) }),
      make({ name: 'Lior Navren', short: 'L. NAVREN', number: 24, pos: 'RW', foot: 'R', weakFoot: 3, skill: 3, stats: base({ sprintSpeed: 86, acceleration: 87, dribbling: 83, ballControl: 81, finishing: 74 }) }),
      make({ name: 'Enzo Talven', short: 'E. TALVEN', number: 27, pos: 'ST', foot: 'R', weakFoot: 3, skill: 3, stats: base({ finishing: 79, shotPower: 81, heading: 77, strength: 82, reactions: 78 }) }),
    ],
  },
];
