import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { command, simulation } from './helpers';

// 10경기(슛 50개 안팎)는 우연 편차가 기준선만큼 커서, 개인기 접촉 위치처럼 작은 변화에도 결과가 뒤집힌다 → 20경기
const SEEDS = Number(process.env.DRIBBLE_AI_SEEDS ?? 20);
/** 같은 시드 SEEDS경기를 각각 300초 진행해, 필드 소유자의 공격 방향 이동과 추격 시간을 비교한다. */
function measure(touches: boolean) {
  let progress = 0, ownedTime = 0, chasingTime = 0, shots = 0, heavy = 0;
  for (let seed = 0; seed < SEEDS; seed++) {
    const { match } = simulation(seed, { kickMotion: true, userControl: false, dribbleTouches: touches });
    match.duration = 300;
    const cmd = command();
    for (let step = 0; step < 300 / PHYSICS.step; step++) {
      const owner = match.phase === 'playing' ? match.ball.owner : null;
      const fieldOwner = owner && !owner.isKeeper ? owner : null;
      const x = fieldOwner?.pos.x ?? 0;
      const attackDir = fieldOwner?.attackDir ?? 1;
      if (fieldOwner) {
        ownedTime += PHYSICS.step;
        const footX = fieldOwner.pos.x + fieldOwner.facing.x * 0.35;
        const footZ = fieldOwner.pos.z + fieldOwner.facing.z * 0.35;
        if (Math.hypot(match.ball.position.x - footX, match.ball.position.z - footZ) > 0.75) {
          chasingTime += PHYSICS.step;
        }
      }
      match.update(PHYSICS.step, cmd);
      // 킥·소유 전환 프레임도 직전 소유자의 실제 이동만 집계한다. 공이나 새 소유자의 이동을 섞지 않는다.
      if (fieldOwner && match.phase === 'playing') progress += (fieldOwner.pos.x - x) * attackDir;
      for (const event of match.events) if (event.type === 'heavyTouch') heavy++;
      match.events.length = 0;
    }
    shots += match.stats.shots[0] + match.stats.shots[1];
  }
  return { forwardSpeed: progress / ownedTime, shots, heavy, chasingRatio: chasingTime / ownedTime };
}

it('AI 터치 드리블 20경기: 예전 대비 전진 85%·슛 80% 이상, 헤비 터치 10회·추격 15% 이하', () => {
  const glued = measure(false);
  const touch = measure(true);
  console.info('AI 드리블 측정', JSON.stringify({ glued, touch }));
  expect(glued.forwardSpeed).toBeGreaterThan(0);
  expect(glued.shots).toBeGreaterThan(0);
  expect.soft(touch.forwardSpeed).toBeGreaterThanOrEqual(glued.forwardSpeed * 0.85);
  expect.soft(touch.shots).toBeGreaterThanOrEqual(glued.shots * 0.8);
  expect.soft(touch.heavy).toBeLessThanOrEqual(10);
  expect.soft(touch.chasingRatio).toBeLessThanOrEqual(0.15);
}, 300_000);
