import * as THREE from 'three';
import { expect, it } from 'vitest';
import { accelType, heightOf } from '../src/data/Stats';
import { simulation } from './helpers';

function timeTo(type: 'explosive' | 'controlled' | 'lengthy', frac: number): number {
  const { match } = simulation(1);
  const p = match.teams[0][9];
  Object.defineProperty(p, 'accelType', { value: type });
  p.vel.set(0, 0, 0);
  const max = p.maxSpeed(false) / 0.72; // 질주 최고 속도
  for (let t = 0; t < 5; t += 1 / 120) {
    p.steer(new THREE.Vector3(1, 0, 0), true, false, 1 / 120);
    if (Math.hypot(p.vel.x, p.vel.z) >= max * frac) return t;
  }
  return 99;
}

it('가속 유형: 폭발형은 출발(50%)이 빠르고, 지속형은 최고 속도(95%) 직전 구간이 상대적으로 빠르다', () => {
  const e50 = timeTo('explosive', 0.5), c50 = timeTo('controlled', 0.5), l50 = timeTo('lengthy', 0.5);
  expect(e50).toBeLessThan(c50);
  expect(c50).toBeLessThan(l50);
  const span = (t: 'explosive' | 'lengthy') => timeTo(t, 0.95) - timeTo(t, 0.6);
  expect(span('lengthy')).toBeLessThan(span('explosive'));
});

it('키와 능력치로 가속 유형이 나뉜다 (FC24 기준)', () => {
  const base = { agility: 85, acceleration: 85, strength: 60 } as never;
  expect(accelType({ ...base }, 170)).toBe('explosive');
  expect(accelType({ agility: 60, acceleration: 70, strength: 85 } as never, 190)).toBe('lengthy');
  expect(accelType({ ...base }, 180)).toBe('controlled');
  expect(heightOf('Kang Min-jae', 'CB')).toBe(heightOf('Kang Min-jae', 'CB'));
});
