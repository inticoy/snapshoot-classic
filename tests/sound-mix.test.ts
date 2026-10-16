import { expect, it } from 'vitest';
import { AUDIO_MIX, PHYSICS } from '../src/config';
import { categoryVolume, decideTouchSound } from '../src/audio/Mix';
import { command, simulation } from './helpers';

it('터치는 선수별 최소 간격을 지키고 느린 공이나 먼 선수는 조용하다', () => {
  const first = decideTouchSound(4, 5, 10);
  expect(first.volume).toBeGreaterThan(0);
  expect(decideTouchSound(4, 5, 10.27, first.nextTime).volume).toBe(0);
  expect(decideTouchSound(4, 5, 10.28, first.nextTime).volume).toBeGreaterThan(0);
  expect(decideTouchSound(1.19, 5, 11).volume).toBe(0);
  expect(decideTouchSound(4, 25, 11).volume).toBe(0);
});

it('걷기·질주 터치와 카메라 거리에 따라 음량이 달라진다', () => {
  const walk = decideTouchSound(2, 5, 1).volume;
  const sprint = decideTouchSound(8, 5, 1).volume;
  expect(walk).toBeGreaterThan(0);
  expect(sprint).toBeGreaterThan(walk);
  expect(decideTouchSound(8, 20, 1).volume).toBeLessThan(sprint);
});

it('카테고리 음량은 설정된 상한과 0 사이로 제한된다', () => {
  for (const category of ['ball', 'body', 'crowd', 'whistle'] as const) {
    expect(categoryVolume(category, -1)).toBe(0);
    expect(categoryVolume(category, 100)).toBe(AUDIO_MIX[category]);
    expect(categoryVolume(category, 0.5)).toBeCloseTo(AUDIO_MIX[category] / 2);
  }
});

it('30초 경기에서 터치 소리 빈도를 측정하고 간격 제한 효과를 확인한다', () => {
  const { match } = simulation(17, { userControl: false });
  const cmd = command();
  const last = new Map<object, number>();
  let before = 0, after = 0;
  for (let frame = 0; frame < 30 / PHYSICS.step; frame++) {
    match.update(PHYSICS.step, cmd);
    const now = frame * PHYSICS.step;
    for (const event of match.events) {
      if (event.type !== 'touch') continue;
      before++;
      const distance = Math.hypot(event.player.pos.x, event.player.pos.z);
      const decision = decideTouchSound(event.speed, distance, now, last.get(event.player));
      if (decision.volume > 0) {
        after++;
        last.set(event.player, decision.nextTime);
      }
    }
    match.events.length = 0;
  }
  console.info(`30초 터치 소리: 이전 ${before}회 (${(before / 30).toFixed(2)}/초), 이후 ${after}회 (${(after / 30).toFixed(2)}/초)`);
  expect(before).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
});
