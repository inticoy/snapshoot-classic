import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { FORMATIONS, FORMATION_IDS } from '../src/data/Formation';
import { TEAMS } from '../src/data/Teams';
import { simulation } from './helpers';

it('포메이션마다 11칸·GK 1명·ST 1명, 좌우 대칭', () => {
  for (const id of FORMATION_IDS) {
    const f = FORMATIONS[id];
    expect(f).toHaveLength(11);
    expect(f.filter((s) => s.role === 'GK')).toHaveLength(1);
    expect(f.filter((s) => s.label === 'ST')).toHaveLength(1);
    expect(f.reduce((sum, s) => sum + s.z, 0)).toBeCloseTo(0, 6);
    // 수비 숫자는 이름 그대로 (3-5-2의 윙백은 미드로 센다)
    expect(f.filter((s) => s.role === 'DEF').length).toBe(Number(id[0]));
  }
});

it.each(FORMATION_IDS)('%s: 경기 재시작 때 선수 자리가 바뀌고, AI 대 AI 45초가 멈추지 않고 이어진다', (id) => {
  const { match } = simulation(3, { userControl: false, kickoffPass: true });
  match.restart(TEAMS.map((t) => t.players), [id, '4-3-3']);
  expect(match.teams[0].map((p) => p.slot)).toEqual(FORMATIONS[id]);
  expect(match.teams[1].map((p) => p.slot)).toEqual(FORMATIONS['4-3-3']);
  let passes = 0;
  const sumZ = new Map<string, number>();
  for (let t = 0; t < 45; t += PHYSICS.step) {
    match.update(PHYSICS.step, null as never);
    match.events.length = 0;
    for (const p of match.teams[0]) if (p.role === 'FWD') sumZ.set(p.slot.label, (sumZ.get(p.slot.label) ?? 0) + p.pos.z);
  }
  passes = match.stats.passes[0] + match.stats.passes[1];
  // 킥오프·골 세리머니 동안은 경기 시계가 멈춘다
  expect(match.clock).toBeGreaterThan(35);
  expect(passes).toBeGreaterThan(2);
  // 투톱은 한 점에 겹치지 않고 양쪽으로 나뉜다
  if (sumZ.has('CF')) expect(Math.sign(sumZ.get('CF')!)).not.toBe(Math.sign(sumZ.get('ST')!));
});
