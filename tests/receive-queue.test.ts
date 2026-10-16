import { expect, it } from 'vitest';
import { runScript } from '../src/playground/Script';

const kicksBy = (r: ReturnType<typeof runScript>, who: string) => r.events.filter((e) => e.type === 'kick' && String((e as { player?: unknown }).player).startsWith(who));

it.each([
  ['공 쪽으로 오며', ['ArrowDown']],
  ['질주로 오며', ['ArrowDown', 'KeyE']],
  ['옆 방향 조준', ['ArrowLeft']],
  ['반대 방향 조준', ['ArrowUp']],
])('패스를 미리 눌러 두면 (%s) 공을 지나치지 않고 원터치 패스가 나간다', (_label, keys) => {
  const r = runScript({ scenario: 'receive', seed: 3, duration: 3, inputs: [
    { t: 0, keys: [...keys] }, { t: 0.3, keys: [...keys, 'KeyS'] }, { t: 0.45, keys: [...keys] },
  ] });
  expect(kicksBy(r, 'J. SON')).toHaveLength(1);
  expect(r.summary.losses).toBe(0);
});
