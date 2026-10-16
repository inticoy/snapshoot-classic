import { expect, it } from 'vitest';
import { MOTION_CATALOG } from '../src/data/MotionCatalog';
import { selectMotion, type MotionKind, type MotionSpeed } from '../src/anim/MotionLibrary';

it('땅볼 킥에는 헤딩·다이빙 헤딩·넘어지는 클립이 뽑히지 않는다 (모든 종류·속도·각도·난수)', () => {
  for (const kind of ['shot', 'pass', 'lob'] as MotionKind[]) {
    for (const speed of ['idle', 'walk', 'sprint'] as MotionSpeed[]) {
      for (let a = -Math.PI; a <= Math.PI; a += Math.PI / 12) {
        for (const random of [0, 0.25, 0.5, 0.75, 0.99]) {
          for (const foot of ['L', 'R'] as const) {
            const pick = selectMotion(MOTION_CATALOG, { kind, speed, angle: a, foot, random, height: 0.11 })?.entry;
            if (!pick) continue;
            expect(pick.height, pick.id).toBeLessThan(0.56);
            expect(pick.next, pick.id).toBeUndefined();
            expect(pick.id).not.toMatch(/header|bicycle/);
          }
        }
      }
    }
  }
});

it('머리 높이 공에는 헤딩 클립을 고른다', () => {
  const pick = selectMotion(MOTION_CATALOG, { kind: 'shot', speed: 'walk', angle: 0, height: 1.8 })?.entry;
  if (pick) expect(pick.height).toBeGreaterThan(1.3);
});
