import * as THREE from 'three';
import { afterEach, expect, it } from 'vitest';
import { COMMAND, INPUT, PHYSICS } from '../src/config';
import { Input } from '../src/core/Input';
import { settings } from '../src/core/Settings';
import { runScript, scriptCommand, validateScript } from '../src/playground/Script';
import { PlaygroundScenarios } from '../src/playground/Scenarios';
import { fixture, measure } from '../scripts/stage3-measure';
import { command, simulation } from './helpers';

const defaults = { ...settings };
afterEach(() => Object.assign(settings, defaults));
const run = (name: string, seed = 3) => runScript({ ...fixture(name), seed });
const kick = (name: string, seed = 3) => measure(run(name, seed))!;
const kinds = {
  s: 'short', ss: 'dink', w: 'through', ww: 'dinkThrough', qw: 'highLobThrough', zqw: 'lowLobThrough', qs: 'oneTwo', cs: 'flair',
  a: 'cross', aa: 'lowCross', qa: 'highCross', ca: 'flairCross', za: 'fastCross', d: 'shot', dd: 'drivenShot', zd: 'finesseShot', zdd: 'finesseDrivenShot', cd: 'flairShot',
  fdd: 'powerShot', 'fdd-early': 'powerShot', 'fdd-miss': 'powerShot', clear: 'clearance',
};

it.each(Object.entries(kinds))('%s JSON 실제 키 입력은 %s 킥을 정확히 한 번 낸다', (name, kind) => {
  const result = run(name);
  const user = name === 'clear' ? 'J. SON #7' : result.frames[0].owner;
  const events = result.events.filter((e) => e.type === 'kick' && e.player === user);
  expect(events, name).toHaveLength(1);
  expect(events[0].kind).toBe(kind);
  expect((events[0].velocity as number[]).every(Number.isFinite)).toBe(true);
});

it.each([['s', 'ss'], ['w', 'ww']])('%s와 %s: 같은 수신자·리드, 수평 속도 90%%, 0.6~0.9m 딩크와 수비수 뒤 첫 바운드', (single, double) => {
  for (let seed = 0; seed < 20; seed++) {
    const a = kick(single, seed), b = kick(double, seed);
    expect(b.receiver).toBe(a.receiver);
    expect(b.horizontal / a.horizontal).toBeCloseTo(COMMAND.dinkSpeed, 2);
    expect(b.lead).toBeCloseTo(a.lead!, 5);
    expect(b.peak).toBeGreaterThanOrEqual(0.6);
    expect(b.peak).toBeLessThanOrEqual(0.9);
    expect(b.bounceX).not.toBeNull();
    expect(b.bounceX!).toBeGreaterThan(-16);
    expect(b.received).toBe(true);
  }
});

it('Z+Q+W는 Q+W보다 낮고 빠르고 체공이 짧으며 최고 높이 1.5~2.5m다', () => {
  for (let seed = 0; seed < 20; seed++) {
    const high = kick('qw', seed), low = kick('zqw', seed);
    expect(low.peak).toBeGreaterThanOrEqual(1.5);
    expect(low.peak).toBeLessThanOrEqual(2.5);
    expect(low.peak).toBeLessThan(high.peak);
    expect(low.horizontal).toBeGreaterThan(high.horizontal);
    expect((low.kick.velocity as number[])[1]).toBeLessThan((high.kick.velocity as number[])[1]);
    expect(low.receiver).toBe(high.receiver);
  }
});

it('Q+S 침투 리드는 W보다 짧고 S보다 앞이며 땅볼이다', () => {
  const short = kick('s'), through = kick('w'), oneTwo = kick('qs');
  expect(oneTwo.receiver).toBe(short.receiver);
  expect(oneTwo.lead!).toBeGreaterThan(short.lead!);
  expect(oneTwo.lead!).toBeLessThan(through.lead! * 0.5);
  expect(oneTwo.peak).toBeLessThan(0.2);
});

it.each(['cs', 'ca'])('%s 플레어 패스는 별 3부터, 별 2는 일반 킥으로 돌아간다', (name) => {
  const low = measure(runScript({ ...fixture(name), skill: 2 }))!;
  const high = measure(runScript({ ...fixture(name), skill: 3 }))!;
  expect(low.kind).toBe(name === 'cs' ? 'short' : 'cross');
  expect(low.kick.flair).toBe(false);
  expect(high.kind).toBe(name === 'cs' ? 'flair' : 'flairCross');
  expect(high.kick.flair).toBe(true);
});

it('A 계열 크로스의 수신자가 같고 낮음·높음·빠름 궤적이 구별된다', () => {
  const normal = kick('a'), low = kick('aa'), high = kick('qa'), flair = kick('ca'), fast = kick('za');
  for (const r of [low, high, flair, fast]) expect(r.receiver).toBe(normal.receiver);
  expect(low.peak).toBeLessThan(normal.peak);
  expect(high.peak).toBeGreaterThan(normal.peak);
  expect(fast.horizontal).toBeGreaterThan(normal.horizontal);
  expect(fast.peak).toBeLessThan(normal.peak);
  expect(flair.kick.flair).toBe(true);
});

it('중앙의 A·Q+A·Z+A는 측면 크로스와 혼동하지 않는다', () => {
  for (const [name, kind] of [['a', 'lob'], ['qa', 'lob'], ['za', 'lowLob']] as const) {
    const result = runScript({ ...fixture(name), scenario: 'passing', inputs: fixture(name).inputs.map((r) => ({ ...r, keys: r.keys?.filter((k) => k !== 'ArrowLeft') })) });
    expect(measure(result)!.kind).toBe(kind);
  }
});

it('DD는 수평 파워 +10%·낮은 수직 속도, ZDD는 약한 감아차기다', () => {
  const normal = kick('d'), driven = kick('dd'), finesse = kick('zd'), curled = kick('zdd');
  expect(driven.horizontal / normal.horizontal).toBeCloseTo(1.1, 5);
  expect((driven.kick.velocity as number[])[1]).toBe(COMMAND.drivenShotLift);
  expect((curled.kick.velocity as number[])[1]).toBe(COMMAND.drivenShotLift);
  expect(Math.abs((curled.kick.spin as number[])[1] / (finesse.kick.spin as number[])[1])).toBeCloseTo(COMMAND.drivenCurl, 5);
  expect(kick('cd').kick.flair).toBe(true);
});

it('FDD의 0.4초 준비와 0.1초 초록 창: 이른/미입력은 보너스 없고 맞춘 입력은 정확해진다', () => {
  let timedError = 0, missedError = 0;
  for (let seed = 0; seed < 20; seed++) {
    const perfect = kick('fdd', seed), early = kick('fdd-early', seed), missing = kick('fdd-miss', seed);
    expect(perfect.kick.t - (0.5 + PHYSICS.step)).toBeCloseTo(COMMAND.powerWindup, 5);
    expect(perfect.kick.timed).toBe(true);
    expect(early.kick.timed).toBe(false);
    expect(missing.kick.timed).toBe(false);
    expect(perfect.horizontal).toBeGreaterThan(30);
    timedError += Math.abs((perfect.kick.target as number[])[2] - 0.2);
    missedError += Math.abs((missing.kick.target as number[])[2] - 0.2);
  }
  expect(timedError).toBeLessThan(missedError * 0.6);
  const result = run('fdd');
  expect(result.frames.filter((f) => f.t > 0.51 && f.t < 0.89).every((f) => f.timing !== null)).toBe(true);
});

it.each([0.25, 0.25 + PHYSICS.step])('S 연타 창 경계 %fs를 고정 스텝으로 판정한다', (gap) => {
  const script = fixture('ss');
  script.inputs = [{ t: 0.1, tap: ['KeyS'] }, { t: 0.1 + gap, tap: ['KeyS'] }];
  const result = runScript(script);
  expect(measure(result)!.kind).toBe(gap === INPUT.doubleTap ? 'dink' : 'short');
});

it('S→W는 SS가 되지 않고, 3연타도 같은 소유자에게 중복 킥을 만들지 않는다', () => {
  const mixed = runScript({ ...fixture('ss'), inputs: [{ t: 0.1, tap: ['KeyS'] }, { t: 0.2, tap: ['KeyW'] }] });
  expect(measure(mixed)!.kind).toBe('through');
  const triple = runScript({ ...fixture('ss'), inputs: [{ t: 0.1, tap: ['KeyS'] }, { t: 0.2, tap: ['KeyS'] }, { t: 0.3, tap: ['KeyS'] }] });
  expect(triple.events.filter((e) => e.type === 'kick' && e.player === triple.frames[0].owner)).toHaveLength(1);
});

it.each(['space', 'push', 'c', 'ce'])('%s 수비 JSON이 올바른 접촉 종류를 실행한다', (name) => {
  const r = run(name);
  expect(r.events.some((e) => e.type === 'contact' && e.kind === (name === 'space' ? 'hold' : name === 'push' ? 'push' : 'shoulder'))).toBe(true);
  expect(r.events.some((e) => e.type === 'kick')).toBe(false);
  if (name === 'push') {
    expect(r.events.filter((e) => e.type === 'contact')).toHaveLength(1);
    const wins = Array.from({ length: 20 }, (_, seed) => run(name, seed)).flatMap((r) => r.events).filter((e) => e.type === 'contact' && e.success);
    expect(wins.length).toBeGreaterThan(0);
    expect(wins.every((e) => e.duration === 0.3)).toBe(true);
  }
});

it('걷어내기는 가까운 루즈볼을 멀리 높게 보내고 슛으로 집계하지 않는다', () => {
  const r = kick('clear');
  expect(r.horizontal).toBe(COMMAND.clearanceSpeed);
  expect((r.kick.velocity as number[])[1]).toBe(COMMAND.clearanceLift);
  expect(r.peak).toBeGreaterThan(3);
});

it('Space를 놓으면 -30% 속도 제한을 해제하고 1.5초 뒤 심판 판정 위험이 증가한다', () => {
  const { match } = simulation(3, { practice: true });
  new PlaygroundScenarios(match).reset('contact', 3, 'stand');
  const input = new Input({ addEventListener() {} } as unknown as Window);
  const p = match.controlled, opp = match.ball.owner!;
  const place = () => { p.pos.set(-20, 0, 1.2); opp.pos.set(-20, 0, 0); match.ball.owner = opp; };
  // 첫 탭은 기존 스탠딩 태클이므로 누름 엣지를 소비한 유지 상태로 장기 접촉만 분리한다.
  input.setVirtualKeys(['Space']); input.endFrame();
  for (let i = 0; i < 140; i++) { place(); match.update(PHYSICS.step, scriptCommand(input)); input.endFrame(); }
  expect(opp.contactScale).toBe(0.7);
  const desired = new THREE.Vector3(1, 0, 0);
  opp.vel.set(0, 0, 0); opp.steer(desired, true, true, 1);
  expect(opp.vel.length()).toBeCloseTo(opp.maxSpeed(true) * 0.7);
  expect(match.events.some((e) => e.type === 'foul')).toBe(false);
  for (let i = 0; i < 300 && match.phase === 'playing'; i++) { place(); match.update(PHYSICS.step, scriptCommand(input)); input.endFrame(); }
  expect(match.events.some((e) => e.type === 'foul')).toBe(true);
  input.setVirtualKeys([]); place(); match.phase = 'playing'; match.update(PHYSICS.step, scriptCommand(input));
  expect(opp.contactScale).toBe(1);
});

it.each(['ss', 'fdd'])('%s 대기 중 취소·재시작·소유 상실은 뒤늦게 발사하지 않는다', (name) => {
  for (const reason of ['cancel', 'restart', 'loss']) {
    const { match } = simulation(3, { practice: true, kickMotion: true });
    const scenarios = new PlaygroundScenarios(match); scenarios.reset('duel', 3, 'stand');
    const input = new Input({ addEventListener() {} } as unknown as Window);
    input.setVirtualKeys(name === 'fdd' ? ['KeyF', 'KeyD'] : ['KeyS']);
    match.update(PHYSICS.step, scriptCommand(input)); input.endFrame();
    input.setVirtualKeys([]); match.update(PHYSICS.step, scriptCommand(input)); input.endFrame();
    if (reason === 'cancel') match.cancelUserCharge();
    else if (reason === 'restart') scenarios.reset('duel', 3, 'stand');
    else match.ball.owner = match.teams[1][0];
    match.events.length = 0;
    for (let i = 0; i < 0.8 / PHYSICS.step; i++) match.update(PHYSICS.step, command());
    expect(match.events.some((e) => e.type === 'kick')).toBe(false);
  }
});

it.each(['assisted', 'semi', 'manual'] as const)('새 패스의 %s 보정은 유한하고 설정값을 바꾸지 않는다', (assist) => {
  settings.passAssist = assist;
  for (const name of ['ss', 'ww', 'zqw', 'qs', 'cs']) {
    const r = run(name);
    expect(r.frames.every((f) => f.ball.pos.every(Number.isFinite) && f.ball.vel.every(Number.isFinite))).toBe(true);
    expect(settings.passAssist).toBe(assist);
  }
});

it('F 키 JSON 검증과 재생은 결정적이며 알 수 없는 키는 거부한다', () => {
  expect(run('fdd')).toEqual(run('fdd'));
  expect(() => validateScript({ ...fixture('fdd'), inputs: [{ t: 0, keys: ['KeyX'] }] })).toThrow();
});

it('C+E 견제의 이동 목표는 질주 최고 속도의 0.95, C는 0.7이다', () => {
  for (const sprint of [false, true]) {
    const { match } = simulation(3, { practice: true });
    new PlaygroundScenarios(match).reset('contact', 3, 'stand');
    const p = match.controlled;
    p.pos.set(-10, 0, 0);
    const input = new Input({ addEventListener() {} } as unknown as Window);
    input.setVirtualKeys(['KeyC', 'ArrowDown', ...(sprint ? ['KeyE'] : [])]);
    for (let i = 0; i < 80; i++) { match.update(PHYSICS.step, scriptCommand(input)); input.endFrame(); }
    expect(p.vel.length() / p.maxSpeed(false)).toBeCloseTo(sprint ? 0.95 : 0.7, 4);
  }
});

it('D 밀치기는 몸싸움·밸런스가 높은 선수에게 유리하고 성공 시 0.3초 균형을 잃는다', () => {
  const wins = (strength: number) => {
    let count = 0;
    for (let seed = 0; seed < 40; seed++) {
      const { match } = simulation(seed, { practice: true });
      new PlaygroundScenarios(match).reset('contact', seed, 'stand');
      const p = match.controlled, opp = match.ball.owner!;
      Object.defineProperty(p, 'profile', { value: { ...p.profile, stats: { ...p.profile.stats, strength, balance: strength } } });
      const input = new Input({ addEventListener() {} } as unknown as Window);
      input.setVirtualKeys(['KeyD']);
      match.update(PHYSICS.step, scriptCommand(input));
      if (match.events.some((e) => e.type === 'contact' && e.success)) {
        count++;
        expect(opp.stunned).toBeCloseTo(COMMAND.pushStun - PHYSICS.step, 5);
      }
    }
    return count;
  };
  expect(wins(99)).toBeGreaterThan(wins(1) + 15);
});

it('플레어 패스·슛은 같은 실제 키 입력의 일반 킥보다 방향 오차가 커진다', () => {
  for (const [normal, flair] of [['s', 'cs'], ['a', 'ca'], ['d', 'cd']]) {
    const a = fixture(normal), b = fixture(flair);
    // 오차 비교는 수비 접촉 없이 같은 배치·시각·방향에서 한다.
    if (a.scenario === 'commands') a.scenario = 'passing';
    const one = measure(runScript(a))!, two = measure(runScript(b))!;
    const error = (v: typeof one) => {
      const origin = v.kick.aimOrigin as number[], target = v.kick.target as number[], velocity = v.kick.velocity as number[];
      return Math.atan2(velocity[2], velocity[0]) - Math.atan2(target[2] - origin[2], target[0] - origin[0]);
    };
    if (normal === 'd') {
      const oneZ = (one.kick.target as number[])[2], twoZ = (two.kick.target as number[])[2];
      expect(Math.abs(twoZ - 0.2) / Math.abs(oneZ - 0.2)).toBeCloseTo(COMMAND.flairError, 4);
    } else expect(Math.abs(error(two) / error(one))).toBeCloseTo(COMMAND.flairError, 4);
  }
});

it.each([['KeyQ', 'oneTwo'], ['KeyC', 'flair']])('공을 받기 전 %s+S 입력도 새 패스 종류 %s를 보존한다', (modifier, kind) => {
  const result = runScript({ scenario: 'receive', seed: 3, duration: 3, inputs: [
    { t: 0.3, keys: [modifier, 'KeyS'] }, { t: 0.45, keys: [] },
  ] });
  expect(result.events.filter((e) => e.type === 'kick' && e.player === 'J. SON #7')).toHaveLength(1);
  expect(result.events.find((e) => e.type === 'kick' && e.player === 'J. SON #7')!.kind).toBe(kind);
});

it.each([[0.25, true], [0.35, true], [0.25 - PHYSICS.step, false], [0.35 + PHYSICS.step, false]] as const)('FDD 타이밍 창의 %fs 입력 성공=%s', (offset, success) => {
  const script = fixture('fdd');
  script.inputs = [{ t: 0.1, keys: ['KeyF', 'KeyD'] }, { t: 0.5, keys: ['KeyF'] }, { t: 0.5 + offset, tap: ['KeyD'] }];
  expect(measure(runScript(script))!.kick.timed).toBe(success);
});

it('FDD에서 이른 두 번째 D 뒤 다시 D를 눌러도 실패를 성공으로 덮지 않는다', () => {
  const script = fixture('fdd-early');
  script.inputs.splice(3, 0, { t: 0.8, tap: ['KeyD'] });
  const result = runScript(script);
  expect(measure(result)!.kick.timed).toBe(false);
  expect(result.events.filter((e) => e.type === 'kick' && e.player === result.frames[0].owner)).toHaveLength(1);
});

it.each(['stand', 'slide'] as const)('실제 SS 키 입력의 공중 구간은 수비수 %s 태클의 발 높이를 넘는다', (kind) => {
  const { match } = simulation(3, { practice: true, kickMotion: true });
  new PlaygroundScenarios(match).reset('commands', 3, 'stand');
  const defender = match.teams[1][0];
  const input = new Input({ addEventListener() {} } as unknown as Window);
  let launched = false, tackling = false;
  for (let i = 0; i < 1.3 / PHYSICS.step; i++) {
    input.setVirtualKeys(i === 12 || i === 24 ? ['KeyS'] : []);
    match.update(PHYSICS.step, scriptCommand(input)); input.endFrame();
    if (match.events.some((e) => e.type === 'kick' && e.kind === 'dink')) launched = true;
    if (launched && !tackling && match.ball.position.x > -18.3) {
      defender.startTackle(new THREE.Vector3(-1, 0, 0), kind);
      tackling = true;
    }
    if (launched && tackling && match.ball.position.y > 0.4) expect(match.ball.owner).not.toBe(defender);
    match.events.length = 0;
  }
  expect(tackling).toBe(true);
  expect(match.stats.tackles[1]).toBe(0);
  expect(match.ball.position.x).toBeGreaterThan(-16);
});
