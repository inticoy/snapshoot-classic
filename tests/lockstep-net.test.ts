import { expect, it } from 'vitest';
import { headlessMatch, stateHash } from '../src/net/Replay';
import { Lockstep } from '../src/net/Lockstep';
import { command, SimulationModel } from './helpers';

/** 지연(틱 단위)·지터가 있는 가짜 중계로 두 클라이언트를 잇는다 */
function pair(latencyTicks: number, jitter = 0) {
  const setup = { seed: 31, options: { userTeams: [true, true] as [boolean, boolean] } };
  const queue: { at: number; to: 0 | 1; data: Uint8Array }[] = [];
  let now = 0, s = 9;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 7) >>> 0) / 4294967296;
  const make = (team: 0 | 1) => new Lockstep(headlessMatch(setup, () => new SimulationModel()), team, {
    send: (data) => queue.push({ at: now + latencyTicks + Math.floor(rnd() * (jitter + 1)), to: (1 - team) as 0 | 1, data: data.slice() }),
  });
  const peers = [make(0), make(1)] as const;
  const advance = (cmds: [ReturnType<typeof command>, ReturnType<typeof command>]) => {
    now++;
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= now) { peers[queue[i].to].receive(queue[i].data, (1 - queue[i].to) as 0 | 1); queue.splice(i, 1); }
    for (const team of [0, 1] as const) {
      const p = peers[team];
      // 화면 루프처럼: 진행할 수 있을 때만 다음 입력을 예약 (멈춰 있으면 입력도 쌓지 않는다)
      if (p.ready) { p.pushLocal(cmds[team]); p.step(); } else p.step();
    }
  };
  return { peers, advance };
}

it.each([[3, 0], [5, 2], [10, 4]])('지연 %i틱(+지터 %i): 두 클라이언트가 같은 경기로 진행하고 어긋남이 없다', (lat, jit) => {
  const { peers, advance } = pair(lat, jit);
  for (let i = 0; i < 1200; i++) {
    const a = command(), b = command();
    a.move.set(Math.sin(i / 50), 0, Math.cos(i / 70));
    b.move.set(-Math.cos(i / 40), 0, Math.sin(i / 90));
    a.sprint = i % 200 < 100;
    advance([a, b]);
  }
  const [p0, p1] = peers;
  const t = Math.min(p0.tick, p1.tick);
  // 지연이 입력 지연(6틱)보다 크면 기다리는 만큼 느려진다 (어긋나지는 않는다)
  expect(t).toBeGreaterThan(lat + jit <= 6 ? 1100 : 450);
  expect(p0.desyncAt).toBeNull();
  expect(p1.desyncAt).toBeNull();
  if (p0.tick === p1.tick) expect(stateHash(p0.match)).toBe(stateHash(p1.match));
});

it('입력 지연을 왕복 시간에 맞추면 10틱 지연에서도 거의 멈추지 않는다', () => {
  const setup = { seed: 31, options: { userTeams: [true, true] as [boolean, boolean] } };
  const latency = 10;
  const queue: { at: number; to: 0 | 1; data: Uint8Array }[] = [];
  let now = 0;
  const peers = ([0, 1] as const).map((team) => new Lockstep(headlessMatch(setup, () => new SimulationModel()), team, {
    send: (data) => queue.push({ at: now + latency, to: (1 - team) as 0 | 1, data: data.slice() }),
  }, Lockstep.delayFor(latency * 2))) as [Lockstep, Lockstep];
  for (let i = 0; i < 1200; i++) {
    now++;
    for (let k = queue.length - 1; k >= 0; k--) if (queue[k].at <= now) { peers[queue[k].to].receive(queue[k].data, (1 - queue[k].to) as 0 | 1); queue.splice(k, 1); }
    for (const p of peers) { if (p.ready) { p.pushLocal(command()); p.step(); } else p.step(); }
  }
  expect(peers[0].tick).toBeGreaterThan(1150);
  expect(peers[0].desyncAt).toBeNull();
});
