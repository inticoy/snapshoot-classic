import { expect, it } from 'vitest';
import { appearance, backName, HAIR_TONES, SKIN_TONES } from '../src/data/Appearance';
import { TEAMS } from '../src/data/Teams';

it('외형은 이름으로 정해져 매번 같고, 22명이 서로 충분히 다르다', () => {
  const players = TEAMS.flatMap((t) => t.players);
  const looks = players.map((p) => appearance(p.name));
  expect(players.map((p) => appearance(p.name))).toEqual(looks);
  for (const l of looks) {
    expect(SKIN_TONES).toContain(l.skin);
    expect(HAIR_TONES).toContain(l.hair);
  }
  const distinct = new Set(looks.map((l) => `${l.skin}-${l.hair}-${l.hairStyle}-${l.beard}`));
  expect(distinct.size).toBeGreaterThanOrEqual(15);
  expect(new Set(looks.map((l) => l.hairStyle)).size).toBeGreaterThanOrEqual(3);
});

it('등 이름은 성만 대문자로', () => {
  expect(backName('J. SON')).toBe('SON');
  expect(backName('L. FERREIRA')).toBe('FERREIRA');
  expect(backName('Neymar')).toBe('NEYMAR');
});
