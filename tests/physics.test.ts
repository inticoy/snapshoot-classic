import { afterEach, describe, expect, it } from 'vitest';
import { Ball } from '../src/entities/Ball';
import { BALL, PHYSICS } from '../src/config';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { setActivePhysics, type PresetName } from '../src/physics/presets';

afterEach(() => setActivePhysics('arcade'));

describe('실제 공과 지면의 물리 회귀', () => {
  it.each(['real', 'arcade'] as const)('%s: 2m 낙하 후 첫 반발 높이 0.6~1.0m', (preset) => {
    setActivePhysics(preset);
    const physics = new PhysicsWorld();
    const ball = new Ball(physics);
    ball.position.y = 2 + BALL.radius;
    let bounced = false;
    let apex = 0;
    for (let i = 0; i < 3 / PHYSICS.step; i++) {
      physics.step(PHYSICS.step);
      if (ball.velocity.y > 0.1) bounced = true;
      if (bounced) apex = Math.max(apex, ball.position.y - BALL.radius);
      if (bounced && ball.velocity.y < 0) break;
    }
    console.info(`${preset} 반발 높이: ${apex.toFixed(3)}m`);
    expect(bounced).toBe(true);
    expect(apex).toBeGreaterThanOrEqual(0.6);
    expect(apex).toBeLessThanOrEqual(1);
  });

  function roll(preset: PresetName, speed: number): number {
    setActivePhysics(preset);
    const physics = new PhysicsWorld();
    const ball = new Ball(physics);
    // 경사로 출구의 순수 구름 상태를 재현한다 (지면 속도 3.43m/s).
    ball.velocity.set(speed, 0, 0);
    ball.body.angularVelocity.set(0, 0, -speed / BALL.radius);
    let stopped = false;
    for (let i = 0; i < 30 / PHYSICS.step; i++) {
      physics.step(PHYSICS.step);
      if (Math.abs(ball.velocity.x) < 0.03) { stopped = true; break; }
    }
    expect(stopped).toBe(true);
    return ball.position.x;
  }

  it.each(['real', 'arcade'] as const)('%s: 경사로 출구 3.43m/s에서 4~10m 구른다', (preset) => {
    const distance = roll(preset, 3.43);
    console.info(`${preset} 경사로 구름: ${distance.toFixed(3)}m`);
    expect(distance).toBeGreaterThanOrEqual(4);
    expect(distance).toBeLessThanOrEqual(10);
  });

  it('아케이드: 10m/s 땅볼이 18~28m에서 멈춘다', () => {
    const distance = roll('arcade', 10);
    console.info(`arcade 10m/s 정지 거리: ${distance.toFixed(3)}m`);
    expect(distance).toBeGreaterThanOrEqual(18);
    expect(distance).toBeLessThanOrEqual(28);
  });
});
