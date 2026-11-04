import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { DIFFICULTY, type Difficulty } from '../src/core/Settings';
import { headlessMatch } from '../src/net/Replay';
import { SimulationModel, simulation } from './helpers';

it('난이도는 사람이 조작하지 않는 상대 팀에만 적용한다 (내 팀 동료 AI·연습·온라인은 기본)', () => {
  const { match } = simulation(1, { difficulty: 'amateur' });
  expect(match.aiLevel(0)).toBe(DIFFICULTY.worldclass);
  expect(match.aiLevel(1)).toBe(DIFFICULTY.amateur);
  expect(simulation(1, { difficulty: 'amateur', practice: true }).match.aiLevel(1)).toBe(DIFFICULTY.worldclass);
  const online = headlessMatch({ seed: 1, options: { userTeams: [true, true], difficulty: 'ultimate' } }, () => new SimulationModel());
  expect([online.aiLevel(0), online.aiLevel(1)]).toEqual([DIFFICULTY.worldclass, DIFFICULTY.worldclass]);
  match.setDifficulty('legendary');
  expect(match.aiLevel(1)).toBe(DIFFICULTY.legendary);
});

/** AI 대 AI (양 팀 같은 난이도) 60초 × 2시드: 태클 시도·패스 성공률 */
function measure(difficulty: Difficulty) {
  let tackles = 0, passes = 0, done = 0;
  for (const seed of [1, 2]) {
    const { match } = simulation(seed, { userControl: false, kickoffPass: true, difficulty });
    for (let t = 0; t < 60; t += PHYSICS.step) {
      match.update(PHYSICS.step, null as never);
      for (const e of match.events) if (e.type === 'tackle') tackles++;
      match.events.length = 0;
    }
    passes += match.stats.passes[0] + match.stats.passes[1];
    done += match.stats.passesDone[0] + match.stats.passesDone[1];
  }
  return { tackles, rate: done / Math.max(1, passes) };
}

it('아마추어 AI는 얼티밋보다 태클을 덜 하고 패스를 덜 정확하게 한다', () => {
  const easy = measure('amateur'), hard = measure('ultimate');
  console.info(`난이도 비교: 아마추어 태클 ${easy.tackles}·패스 ${(easy.rate * 100).toFixed(0)}% / 얼티밋 태클 ${hard.tackles}·패스 ${(hard.rate * 100).toFixed(0)}%`);
  expect(easy.tackles).toBeLessThan(hard.tackles);
  expect(easy.rate).toBeLessThan(hard.rate);
}, 90_000);
