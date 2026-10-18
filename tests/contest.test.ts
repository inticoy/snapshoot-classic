import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { command, simulation } from './helpers';

it('공을 끼고 가만히 서 있으면 붙은 상대가 몸싸움으로 빼앗는다 (태클 운에만 맡기지 않는다)', () => {
  const { match } = simulation(3);
  match.restart();
  const cmd = command();
  for (let t = 0; t < 3; t += PHYSICS.step) match.update(PHYSICS.step, cmd);
  const p = match.local.controlled;
  // 터치라인 근처면 태클에 공이 밖으로 나가 버리므로 경기장 가운데에서
  p.pos.set(-15, 0, 0); p.facing.set(1, 0, 0); p.vel.set(0, 0, 0);
  match.ball.reset(p.pos.x + 0.4, p.pos.z);
  match.ball.owner = p;
  let lost = Infinity;
  for (let t = 0; t < 6 && lost === Infinity; t += PHYSICS.step) {
    match.update(PHYSICS.step, cmd);
    if (match.ball.owner?.team === 1 || match.ball.lastTouch?.team === 1) lost = t;
  }
  expect(lost).toBeLessThan(5);
});
