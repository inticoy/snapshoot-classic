import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { command, simulation } from './helpers';

it('공을 가진 동료가 앞을 보고 여유가 있으면 공격수가 스스로 뒷공간으로 침투한다 (사람이 조작하는 선수는 제외, 화면 알림 없음)', () => {
  let runs = 0, announced = 0, userRan = false;
  for (const seed of [1, 2]) {
    const { match } = simulation(seed);
    const seen = new Set();
    for (let t = 0; t < 90; t += PHYSICS.step) {
      match.update(PHYSICS.step, command());
      for (const e of match.events) if (e.type === 'run') announced++;
      match.events.length = 0;
      for (const p of match.runs.keys()) {
        if (match.isUserControlled(p)) userRan = true;
        if (!seen.has(p)) { seen.add(p); runs++; }
      }
      // 같은 선수가 다시 뛰면 다시 센다
      for (const p of [...seen]) if (!match.runs.has(p as never)) seen.delete(p);
    }
  }
  expect(runs).toBeGreaterThan(0);
  expect(announced).toBe(0);
  expect(userRan).toBe(false);
}, 60_000);
