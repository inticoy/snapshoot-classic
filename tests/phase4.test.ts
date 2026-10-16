import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { PHYSICS, PITCH, RULES } from '../src/config';
import { settings } from '../src/core/Settings';
import type { Match } from '../src/gameplay/Match';
import { shootoutDecided } from '../src/gameplay/Penalty';
import { command, parkPlayers, simulation } from './helpers';

const defaults = { ...settings };
afterEach(() => Object.assign(settings, defaults));

function run(match: Match, seconds: number, until: () => boolean = () => false): void {
  const cmd = command();
  for (let t = 0; t < seconds / PHYSICS.step && !until(); t++) match.update(PHYSICS.step, cmd);
}

/** 원정팀 공격수가 공을 갖고 있고, 홈팀 수비수가 태클하는 장면 */
function tackleScene(seed: number, carrierX: number, behind: boolean) {
  const { match } = simulation(seed, { userControl: false });
  parkPlayers(match);
  const carrier = match.forward(1);
  const tackler = match.teams[0].find((p) => p.slot.label === 'LCB')!;
  carrier.pos.set(carrierX, 0, 0);
  carrier.facing.set(-1, 0, 0); // 원정팀은 -X로 공격
  match.ball.reset(carrierX - 0.35, 0);
  match.ball.owner = match.ball.lastTouch = carrier;
  tackler.actionLock = 0;
  // 등 뒤(+X 쪽)에서 같은 방향으로, 또는 정면(-X 쪽)에서 마주 보고
  tackler.pos.set(carrierX + (behind ? 1.1 : -1.4), 0, 0);
  const dir = new THREE.Vector3(behind ? -1 : 1, 0, 0);
  tackler.facing.copy(dir);
  tackler.startTackle(dir, 'slide');
  return { match, carrier, tackler };
}

describe('파울과 재개', () => {
  it('등 뒤에서 들어간 태클은 파울이고 그 지점 직접 프리킥으로 재개한다', () => {
    const { match, tackler } = tackleScene(1, 10, true);
    run(match, 3, () => match.phase === 'setpiece');
    expect(match.rules.fouls[0]).toBe(1);
    expect(match.phase).toBe('setpiece');
    const sp = match.setPieces.current!;
    expect(sp.kind).toBe('freekick');
    expect(sp.team).toBe(1);
    expect(sp.spot.x).toBeCloseTo(10, 0);
    expect(tackler.team).toBe(0);
  });

  it('박스 안에서 등 뒤 태클 → PK, 공은 11m 지점', () => {
    const { match } = tackleScene(2, -PITCH.halfL + 8, true);
    run(match, 3, () => match.phase === 'setpiece');
    const sp = match.setPieces.current!;
    expect(sp.kind).toBe('penalty');
    expect(sp.team).toBe(1);
    expect(sp.spot.x).toBeCloseTo(-PITCH.halfL + RULES.penaltySpot, 5);
    expect(sp.spot.z).toBe(0);
    // 키커·키퍼 말고는 모두 박스 밖
    const keeper = match.teams[0][0];
    for (const p of match.players) {
      if (p === sp.taker || p === keeper || p.isKeeper) continue;
      expect(match.inOwnBox(keeper, p.pos.x, p.pos.z)).toBe(false);
    }
  });

  it('정면 태클 파울은 많지 않다 (100시드 중 40회 미만)', () => {
    let fouls = 0;
    for (let seed = 0; seed < 100; seed++) {
      const { match } = tackleScene(seed, 10, false);
      run(match, 0.8);
      fouls += match.rules.fouls[0];
    }
    expect(fouls).toBeLessThan(40);
  });

  it('공을 지킨 팀은 어드밴티지로 경기가 이어지고, 2초 안에 공을 잃으면 프리킥', () => {
    const { match, carrier } = tackleScene(3, -10, false); // 원정팀이 상대 진영에서 공격 중
    match.rules.call({ by: match.teams[0][3], on: carrier, spot: carrier.pos.clone(), card: null, penalty: false }, true);
    expect(match.rules.advantage).not.toBeNull();
    expect(match.phase).toBe('playing');
    // 공을 빼앗긴다
    match.ball.owner = match.teams[0][3];
    match.rules.update(PHYSICS.step);
    expect(match.phase).toBe('out');
    expect(match.setPieces.current!.kind).toBe('freekick');
  });

  it('직접 프리킥: 상대는 9.15m 밖, 슛 거리면 벽을 세운다', () => {
    const { match } = simulation(4, { userControl: false });
    parkPlayers(match);
    const spot = new THREE.Vector3(PITCH.halfL - 22, 0, 4);
    match.setPieces.award('freekick', 0, spot);
    run(match, 3, () => match.phase === 'setpiece');
    expect(match.setPieces.current!.shooting).toBe(true);
    const wall = match.teams[1].filter((p) => !p.isKeeper && Math.abs(p.pos.distanceTo(spot) - RULES.wallDistance) < 0.3);
    expect(wall.length).toBeGreaterThanOrEqual(4);
    for (const p of match.teams[1]) if (!p.isKeeper) expect(p.pos.distanceTo(spot)).toBeGreaterThan(RULES.wallDistance - 0.05);
  });
});

describe('카드', () => {
  it('경고 2장 = 퇴장: 명단에서 빠지고 재시작하면 돌아온다', () => {
    const { match } = simulation(5);
    const p = match.teams[1][4];
    match.rules.book(p, 'yellow');
    expect(p.sentOff).toBe(false);
    match.rules.book(p, 'yellow');
    expect(p.sentOff).toBe(true);
    expect(match.teams[1]).toHaveLength(10);
    expect(match.players).toHaveLength(21);
    expect(match.rules.reds[1]).toBe(1);
    expect(match.events.some((e) => e.type === 'card' && e.card === 'red' && e.second)).toBe(true);
    expect(p.model.root.visible).toBe(false);
    run(match, 5);
    match.restart();
    expect(match.players).toHaveLength(22);
    expect(p.sentOff).toBe(false);
    expect(p.yellows).toBe(0);
  });
});

describe('오프사이드', () => {
  function passScene(seed: number, defendersAt: number | null) {
    const { match } = simulation(seed, { userControl: false });
    parkPlayers(match);
    const passer = match.teams[0].find((p) => p.slot.label === 'CM')!;
    const receiver = match.forward(0);
    passer.actionLock = receiver.actionLock = 0;
    passer.pos.set(5, 0, 0);
    receiver.pos.set(20, 0, 0);
    passer.facing.set(1, 0, 0);
    if (defendersAt !== null) {
      // 수비 두 명을 받는 선수보다 골문 쪽에 세운다 → 온사이드
      for (const d of match.teams[1].slice(1, 3)) d.pos.set(defendersAt, 0, 12);
    }
    match.ball.reset(5.35, 0);
    match.ball.owner = match.ball.lastTouch = passer;
    match.pass(passer, new THREE.Vector3(1, 0, 0), 'short', 0.5);
    return { match, receiver };
  }

  it('뒤에서 두 번째 수비수보다 앞에서 패스를 받으면 오프사이드 → 상대 간접 프리킥', () => {
    const { match, receiver } = passScene(6, null);
    run(match, 4, () => match.phase !== 'playing');
    expect(match.rules.offsides[0]).toBe(1);
    expect(match.events.some((e) => e.type === 'offside' && e.player === receiver)).toBe(true);
    expect(match.setPieces.current!.kind).toBe('indirect');
    expect(match.setPieces.current!.team).toBe(1);
  });

  it('수비 라인 뒤에서 출발하면 온사이드로 그대로 받는다', () => {
    const { match, receiver } = passScene(7, 26);
    run(match, 4, () => match.ball.owner === receiver);
    expect(match.rules.offsides[0]).toBe(0);
    expect(match.ball.owner).toBe(receiver);
  });

  it('스로인에서는 오프사이드가 없다', () => {
    const { match } = simulation(8, { userControl: false });
    parkPlayers(match);
    const thrower = match.teams[0][5];
    match.rules.exemptNext = true;
    match.rules.recordKick(thrower);
    expect(match.rules.isOffsidePosition(match.forward(0))).toBe(false);
  });
});

describe('백패스', () => {
  it('동료가 발로 준 공은 키퍼가 손으로 잡지 못하고 발로 받는다', () => {
    const { match } = simulation(9, { userControl: false });
    parkPlayers(match);
    const keeper = match.teams[0][0];
    const def = match.teams[0].find((p) => p.slot.label === 'LCB')!;
    keeper.actionLock = def.actionLock = 0;
    keeper.pos.set(-PITCH.halfL + 3, 0, 0);
    def.pos.set(-PITCH.halfL + 15, 0, 0);
    def.facing.set(-1, 0, 0);
    match.ball.reset(-PITCH.halfL + 14.65, 0);
    match.ball.owner = match.ball.lastTouch = def;
    match.pass(def, new THREE.Vector3(-1, 0, 0), 'short', 0.35);
    expect(match.rules.keeperMayHandle(keeper)).toBe(false);
    run(match, 4, () => match.ball.owner === keeper);
    expect(match.ball.owner).toBe(keeper);
    expect(keeper.basePose).not.toBe('hold');
    expect(match.ball.position.y).toBeLessThan(0.4);
  });
});

describe('전·후반', () => {
  it('하프타임 뒤 진영을 바꾸고, 후반에는 -X 골대가 홈팀 득점이다', () => {
    const { match } = simulation(10, { userControl: false });
    parkPlayers(match);
    match.halfClock = match.halfLength * (1 + 3 / 45) + 0.1;
    run(match, 0.1);
    expect(match.stoppage).toBeGreaterThanOrEqual(1);
    expect(match.phase).toBe('halftime');
    expect(match.events.some((e) => e.type === 'whistle' && e.kind === 'halftime')).toBe(true);
    run(match, 3.2);
    expect(match.half).toBe(2);
    expect(match.phase).toBe('kickoff');
    expect(match.teams[0].every((p) => p.attackDir === -1)).toBe(true);
    expect(match.ownGoalX(0)).toBe(PITCH.halfL);
    // 후반 킥오프는 원정팀
    expect(match.ball.owner?.team).toBe(1);
    expect(match.matchMinutes).toBe(45);
    // -X 골대에 공을 넣으면 홈팀 득점
    parkPlayers(match);
    match.ball.reset(-PITCH.halfL - 0.4, 0);
    match.events.length = 0;
    run(match, PHYSICS.step);
    expect(match.score).toEqual([1, 0]);
  });

  it('후반 추가 시간이 끝나면 경기 종료, 무승부 + 승부차기 설정이면 승부차기로 승자를 가린다', () => {
    let kicks = 0, scored = 0;
    for (let seed = 0; seed < 12; seed++) {
      const { match } = simulation(seed, { userControl: false, shootout: true });
      parkPlayers(match);
      match.half = 2;
      match.halfClock = match.halfLength * (1 + 5 / 45) + 0.1;
      run(match, 0.1);
      expect(match.phase).toBe('shootout');
      run(match, 200, () => match.phase === 'fulltime');
      expect(match.phase).toBe('fulltime');
      const [a, b] = match.shootout.score;
      expect(a).not.toBe(b);
      expect(shootoutDecided(match.shootout.results)).toBe(true);
      expect(match.shootout.results[0].length).toBeGreaterThanOrEqual(3);
      kicks += match.shootout.results.flat().length;
      scored += match.shootout.results.flat().filter(Boolean).length;
    }
    // 실제 PK 성공률은 약 75%
    expect(scored / kicks).toBeGreaterThan(0.5);
    expect(scored / kicks).toBeLessThan(0.95);
  });

  it('승부차기 종료 판정: 남은 킥으로 따라잡을 수 없으면 끝, 5번 뒤에는 서든 데스', () => {
    expect(shootoutDecided([[true, true, true], [false, false, false]])).toBe(true);
    expect(shootoutDecided([[true, true, true], [false, false]])).toBe(false);
    expect(shootoutDecided([[true, true, true, true, true], [true, true, true, true, true]])).toBe(false);
    expect(shootoutDecided([[true, true, true, true, true, true], [true, true, true, true, true, false]])).toBe(true);
    expect(shootoutDecided([[true, true, true, true, true, true], [true, true, true, true, true]])).toBe(false);
  });
});
