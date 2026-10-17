import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { CommandDecoder, encodeCommand } from '../src/net/CommandCodec';
import { command, parkPlayers, simulation } from './helpers';

function twoUserMatch() {
  const { match } = simulation(9, { userTeams: [true, true] });
  parkPlayers(match);
  const a = match.teams[0].find((p) => p.slot.label === 'ST')!;
  const b = match.teams[1].find((p) => p.slot.label === 'CM')!;
  for (const p of [a, b]) p.actionLock = 0;
  a.pos.set(0, 0, 0); a.facing.set(1, 0, 0);
  b.pos.set(6, 0, 4); b.facing.set(-1, 0, 0);
  match.ball.reset(0.4, 0); match.ball.owner = a;
  match.sides[0].controlled = a;
  match.sides[1].controlled = b;
  return { match, a, b };
}

it('두 사람: 각 팀 명령이 자기 조작 선수만 움직인다 (팀 1 선수는 AI가 아니라 명령대로)', () => {
  const { match, a, b } = twoUserMatch();
  const c0 = command(), c1 = command();
  c0.move.set(1, 0, 0);
  c1.move.set(0, 0, 1); // 공 쪽이 아니라 옆으로 — AI였다면 공을 쫓았을 것
  for (let t = 0; t < 1; t += PHYSICS.step) match.update(PHYSICS.step, [c0, c1]);
  expect(a.pos.x).toBeGreaterThan(2);
  expect(b.pos.z).toBeGreaterThan(5.5);
  expect(Math.abs(b.pos.x - 6)).toBeLessThan(1);
  expect(match.isUserControlled(a) && match.isUserControlled(b)).toBe(true);
});

it('두 사람: 팀 1의 S(수비 선수 바꾸기)는 팀 1 조작 선수만 바꾼다', () => {
  const { match, a } = twoUserMatch();
  const c1 = command();
  c1.pass = { held: true, pressed: true, released: false };
  match.update(PHYSICS.step, [command(), c1]);
  expect(match.sides[0].controlled).toBe(a);
  expect(match.sides[1].controlled.team).toBe(1);
});

it('두 사람 + 입력 코덱: 바이트로 오간 명령으로도 같은 결과', () => {
  const run = (codec: boolean) => {
    const { match, a, b } = twoUserMatch();
    const dec = [new CommandDecoder(), new CommandDecoder()];
    const c0 = command(), c1 = command();
    c0.move.set(0.8, 0, 0.6); c1.move.set(-1, 0, 0); c1.sprint = true;
    for (let t = 0; t < 1; t += PHYSICS.step) {
      match.update(PHYSICS.step, codec ? [dec[0].decode(encodeCommand(c0)), dec[1].decode(encodeCommand(c1))] : [c0, c1]);
    }
    return [a.pos.x, a.pos.z, b.pos.x, b.pos.z].map((v) => +v.toFixed(2));
  };
  const plain = run(false), wire = run(true);
  for (let i = 0; i < 4; i++) expect(Math.abs(plain[i] - wire[i])).toBeLessThan(0.15);
});

it('두 사람 승부차기: 팀 1 차례에는 팀 1 명령(D)으로 차고, 팀 0이 키퍼 방향을 고른다', () => {
  const { match } = simulation(2, { userTeams: [true, true], shootout: true });
  parkPlayers(match);
  match.half = 2;
  match.halfClock = match.halfLength * (1 + 5 / 45) + 0.1;
  match.update(PHYSICS.step, [command(), command()]);
  expect(match.phase).toBe('shootout');
  let kickedByTeam1 = false;
  for (let i = 0; i < 4000 && match.phase === 'shootout'; i++) {
    const turn = match.shootout.turn;
    const c = command(), idle = command();
    const press = i % 90 < 30;
    c.shoot = { held: press, pressed: i % 90 === 0, released: i % 90 === 30 };
    const before = match.shootout.results[1].length;
    match.update(PHYSICS.step, turn === 0 ? [c, idle] : [idle, c]);
    if (match.shootout.results[1].length > before) kickedByTeam1 = true;
  }
  expect(kickedByTeam1).toBe(true);
  expect(match.shootout.userKicking || match.phase !== 'shootout').toBe(true);
});
