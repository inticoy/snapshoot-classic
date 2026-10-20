import { expect, it } from 'vitest';
import { ONLINE_CATCH_UP } from '../src/config';
import { OnlineCatchUp } from '../src/core/Game';

function recorded(ticks = 112) {
  const events: number[] = [];
  const ls = {
    tick: 0, delay: 6,
    get backlog() { return ticks - this.tick; },
    step() { if (this.backlog <= 0) return false; events.push(this.tick++); return true; },
  };
  return { ls, events, discard: () => { events.length = 0; } };
}

it('시간 예산 뒤에도 최소 틱은 진행하고 같은 프레임에는 예산을 다시 쓰지 않는다', () => {
  const catchUp = new OnlineCatchUp();
  const { ls, events, discard } = recorded();
  let time = 0;
  const now = () => (time += ONLINE_CATCH_UP.budgetMs);
  expect(catchUp.run(1, ls, discard, now)).toBe(3);
  expect(ls.tick).toBe(ONLINE_CATCH_UP.minTicks);
  expect(events).toEqual([]);
  expect(catchUp.run(1, ls, discard, now)).toBe(3);
  expect(ls.tick).toBe(3);
  expect(catchUp.run(2, ls, discard, now)).toBe(6);
});

it('시작 때 밀린 기록을 기준으로 진행률을 유지하며 잔여량이 작아져도 100%까지 끝낸다', () => {
  const catchUp = new OnlineCatchUp();
  const { ls, events, discard } = recorded();
  let time = 0;
  const step = ls.step.bind(ls);
  ls.step = () => { time++; return step(); };
  const now = () => time;
  const percents: number[] = [];
  for (let frame = 0; frame < 100; frame++) {
    const percent = catchUp.run(frame, ls, discard, now);
    if (percent === null) break;
    percents.push(percent);
  }
  expect(percents[0]).toBe(ONLINE_CATCH_UP.budgetMs);
  expect(percents.at(-1)).toBe(100);
  expect(percents).toEqual([...percents].sort((a, b) => a - b));
  expect(ls.tick).toBe(100);
  expect(events).toEqual([]);
  expect(catchUp.run(101, ls, discard, now)).toBeNull();
});

it('평상시 입력 지연은 재생하지 않고 새 경기에서는 진행률을 초기화한다', () => {
  const catchUp = new OnlineCatchUp();
  const normal = recorded(42);
  expect(catchUp.run(1, normal.ls, normal.discard)).toBeNull();
  expect(normal.ls.tick).toBe(0);
  const old = recorded();
  expect(catchUp.run(2, old.ls, old.discard, () => 0)).toBe(100);
  const next = recorded();
  let time = 0;
  expect(catchUp.run(3, next.ls, next.discard, () => (time += 8))).toBe(3);
});

it('기록 중간에 입력이 없으면 즉시 멈추고 그 틱의 이벤트도 버린다', () => {
  const catchUp = new OnlineCatchUp();
  const { ls, events, discard } = recorded();
  ls.step = () => false;
  events.push(1);
  expect(catchUp.run(1, ls, discard, () => 0)).toBe(0);
  expect(events).toEqual([]);
});
