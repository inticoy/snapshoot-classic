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

it('팀 0 화면과 팀 1 화면(localTeam만 다름)이 녹온·개인기·원터치가 섞인 입력에서도 같은 경기다', async () => {
  const { headlessMatch: make, InputLog, replay } = await import('../src/net/Replay');
  const log = new InputLog();
  for (let t = 0; t < 7200; t++) {
    const a = command(), b = command();
    const k = Math.floor(t / 40) % 8;
    a.move.set(Math.cos(k), 0, Math.sin(k)); b.move.set(-Math.sin(k), 0, Math.cos(k));
    a.sprint = b.sprint = t % 400 < 250;
    const tap = (on: boolean) => ({ held: on, pressed: on, released: false });
    a.skill = tap(t % 120 === 30); a.skillMove = a.move.clone();       // 질주 중 Shift = 녹온
    b.skill = tap(t % 150 === 10);
    a.pass = { held: t % 200 < 6, pressed: t % 200 === 0, released: t % 200 === 6 };
    b.shoot = { held: t % 260 < 20, pressed: t % 260 === 0, released: t % 260 === 20 };
    b.finesse = { held: t % 300 < 30, pressed: t % 300 === 0, released: t % 300 === 30 }; // Z (드래그백)
    log.push([a, b]);
  }
  const setupFor = (localTeam: 0 | 1) => ({ seed: 5, options: { userTeams: [true, true] as [boolean, boolean], localTeam } });
  const m0 = make(setupFor(0), () => new SimulationModel()), m1 = make(setupFor(1), () => new SimulationModel());
  for (let t = 0; t < log.length; t += 120) {
    replay(m0, log, t, t + 120);
    replay(m1, log, t, t + 120);
    expect(stateHash(m1), `tick ${t + 120}`).toBe(stateHash(m0));
  }
});

it('온라인 경기 전체(전반·하프타임·진영 교체·후반·승부차기)가 두 화면에서 같게 끝난다 (보정 설정이 서로 달라도)', () => {
  const assists = [{ pass: 'manual', shot: 'semi', move: 'none' }, { pass: 'assisted', shot: 'assisted', move: 'high' }] as const;
  const setup = (localTeam: 0 | 1) => ({ seed: 12, options: { userTeams: [true, true] as [boolean, boolean], localTeam, shootout: true, assists: assists as never } });
  const queue: { at: number; to: 0 | 1; data: Uint8Array }[] = [];
  let now = 0;
  const peers = ([0, 1] as const).map((team) => {
    const m = headlessMatch(setup(team), () => new SimulationModel());
    m.duration = 30; // 30초 경기 (하프 15초)
    return new Lockstep(m, team, { send: (data) => queue.push({ at: now + 3, to: (1 - team) as 0 | 1, data: data.slice() }) });
  }) as [Lockstep, Lockstep];
  for (let i = 0; i < 120 * 200 && peers.some((p) => p.match.phase !== 'fulltime'); i++) {
    now++;
    for (let k = queue.length - 1; k >= 0; k--) if (queue[k].at <= now) { peers[queue[k].to].receive(queue[k].data, (1 - queue[k].to) as 0 | 1); queue.splice(k, 1); }
    for (const p of peers) {
      const c = command();
      const a = (now / 90 + p.team * 2) % (Math.PI * 2);
      c.move.set(Math.cos(a), 0, Math.sin(a));
      c.shoot = { held: now % 150 < 25, pressed: now % 150 === 0, released: now % 150 === 25 };
      if (p.ready) { p.pushLocal(c); p.step(); } else p.step();
    }
  }
  const [a, b] = peers;
  expect(a.match.phase).toBe('fulltime');
  expect(a.match.half).toBe(2);
  expect(a.desyncAt).toBeNull();
  expect(b.desyncAt).toBeNull();
  if (a.tick === b.tick) expect(stateHash(a.match)).toBe(stateHash(b.match));
  expect(b.match.score).toEqual(a.match.score);
  expect(b.match.shootout.results).toEqual(a.match.shootout.results);
}, 120_000);

it('경기 중 입력 지연 조정: 지터로 자주 멈추면 늘려 멈춤이 줄고, 어긋나지 않는다', () => {
  const run = (adaptive: boolean) => {
    const setup = { seed: 31, options: { userTeams: [true, true] as [boolean, boolean] } };
    const queue: { at: number; to: 0 | 1; data: Uint8Array }[] = [];
    let now = 0, s = 9;
    const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 7) >>> 0) / 4294967296;
    const make = (team: 0 | 1) => new Lockstep(headlessMatch(setup, () => new SimulationModel()), team, {
      send: (data) => queue.push({ at: now + 4 + Math.floor(rnd() * 12), to: (1 - team) as 0 | 1, data: data.slice() }),
    }, 6);
    const peers = [make(0), make(1)] as const;
    let late = 0;
    for (let i = 0; i < 2400; i++) {
      now++;
      for (let j = queue.length - 1; j >= 0; j--) if (queue[j].at <= now) { peers[queue[j].to].receive(queue[j].data, (1 - queue[j].to) as 0 | 1); queue.splice(j, 1); }
      for (const p of peers) {
        if (adaptive) p.adapt(1 / 120, 60);
        // 화면 루프처럼 지금 틱 + delay까지 예약
        const c = command();
        c.move.set(Math.sin(i / 50), 0, Math.cos(i / 70));
        while (p.scheduled < p.tick + p.delay) p.pushLocal(c);
        if (!p.step() && i > 1200) late++;
      }
    }
    expect(peers[0].desyncAt).toBeNull();
    expect(peers[1].desyncAt).toBeNull();
    return { late, delay: peers[0].delay };
  };
  const fixed = run(false), adaptive = run(true);
  expect(adaptive.delay).toBeGreaterThan(6);
  expect(adaptive.delay).toBeLessThanOrEqual(Lockstep.MAX_DELAY);
  expect(adaptive.late).toBeLessThan(fixed.late / 3);
});
