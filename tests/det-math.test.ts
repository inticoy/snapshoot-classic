import { expect, it } from 'vitest';
import { datan, datan2, dcos, dexp, dhypot, dlog, dpow, dsin } from '../src/net/DetMath';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));

it('결정적 수학 함수는 기본 Math와 1e-14 안에서 같다 (게임에서 쓰는 범위)', () => {
  let s = 1;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 13), 1597334677) + 11) >>> 0) / 4294967296;
  for (let i = 0; i < 20000; i++) {
    const a = (rnd() - 0.5) * 200, b = (rnd() - 0.5) * 200, p = rnd() * 50;
    expect(Math.abs(dsin(a) - Math.sin(a))).toBeLessThan(1e-14);
    expect(Math.abs(dcos(a) - Math.cos(a))).toBeLessThan(1e-14);
    expect(Math.abs(datan2(a, b) - Math.atan2(a, b))).toBeLessThan(1e-14);
    expect(Math.abs(datan(a) - Math.atan(a))).toBeLessThan(1e-14);
    expect(rel(dexp(a / 4), Math.exp(a / 4))).toBeLessThan(1e-14);
    expect(rel(dlog(p + 1e-6), Math.log(p + 1e-6))).toBeLessThan(1e-13);
    expect(rel(dpow(p, 1.7), Math.pow(p, 1.7))).toBeLessThan(1e-13);
    expect(rel(dhypot(a, b), Math.hypot(a, b))).toBeLessThan(1e-15);
  }
  expect(datan2(0, -1)).toBe(Math.PI);
  expect(datan2(-0, -1)).toBe(-Math.PI);
  expect(dpow(2, 10)).toBe(1024);
  expect(dexp(0)).toBe(1);
});
