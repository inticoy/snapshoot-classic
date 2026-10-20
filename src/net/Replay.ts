import { PHYSICS } from '../config';
import { Random } from '../core/Random';
import { Match, type MatchOptions } from '../gameplay/Match';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { CommandDecoder, COMMAND_BYTES, encodeCommand } from './CommandCodec';
import type { UserCommand } from '../gameplay/Match';

/**
 * 락스텝 멀티플레이의 바탕:
 *  - 같은 시드·설정에서 같은 틱별 입력을 넣으면 두 클라이언트의 경기가 똑같이 흘러간다
 *  - stateHash로 1초마다 비교해 어긋남을 찾는다
 *  - 재접속·어긋남은 시드 + 입력 기록을 처음부터 재생해 따라잡는다
 */
export interface MatchSetup {
  seed: number;
  options?: Omit<MatchOptions, 'random' | 'createPlayerModel'>;
}

/** 틱별 두 팀 입력 (각 COMMAND_BYTES 바이트, 사람이 없는 팀은 0) */
export class InputLog {
  private data = new Uint8Array(COMMAND_BYTES * 2 * 1024);
  length = 0;

  push(cmds: readonly [UserCommand | null, UserCommand | null]): void {
    if ((this.length + 1) * COMMAND_BYTES * 2 > this.data.length) {
      const grown = new Uint8Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const at = this.length * COMMAND_BYTES * 2;
    for (const team of [0, 1] as const) {
      const c = cmds[team];
      if (c) encodeCommand(c, this.data.subarray(at + team * COMMAND_BYTES, at + (team + 1) * COMMAND_BYTES));
    }
    this.length++;
  }

  frame(tick: number, team: 0 | 1): Uint8Array {
    const at = tick * COMMAND_BYTES * 2 + team * COMMAND_BYTES;
    return this.data.subarray(at, at + COMMAND_BYTES);
  }

  bytes(): Uint8Array {
    return this.data.slice(0, this.length * COMMAND_BYTES * 2);
  }
}

/** 화면 없는 경기 (서버·재생·검증용) */
export function headlessMatch(setup: MatchSetup, createPlayerModel?: MatchOptions['createPlayerModel']): Match {
  return new Match(new PhysicsWorld(), { ...setup.options, random: new Random(setup.seed), goalVisuals: false, createPlayerModel });
}

/** 입력 기록을 처음부터 재생해 tick까지 진행한 경기 */
export function replay(match: Match, log: InputLog, from = 0, to = log.length): Match {
  const dec = [new CommandDecoder(), new CommandDecoder()] as const;
  for (let t = from; t < to; t++) {
    const teams = [0, 1] as const;
    const cmds = teams.map((team) => (match.sides[team].active ? dec[team].decode(log.frame(t, team)) : null)) as [UserCommand | null, UserCommand | null];
    match.update(PHYSICS.step, cmds);
    match.events.length = 0;
  }
  return match;
}

/**
 * 경기 상태 해시 (FNV-1a, 32비트): 물리·난수·경기 진행·행동 타이머.
 * 실수는 0.1mm/0.1ms 단위 정수로 바꾸고, 화면 난수·모델·보간 상태는 읽지 않는다.
 * 두 클라이언트가 1초마다 교환해 어긋남을 찾는다.
 */
export function stateHash(m: Match): number {
  let h = 2166136261;
  // 난수 상태는 32비트 전체가 의미 있으므로 실수 양자화와 구분한다.
  const integer = (q: number) => {
    for (let i = 0; i < 4; i++) h = Math.imul(h ^ ((q >>> (i * 8)) & 255), 16777619);
  };
  const mix = (v: number) => integer(Math.round(v * 1e4) | 0);
  const flag = (v: boolean) => integer(v ? 1 : 0);
  const player = (p: Match['ball']['owner']) => integer(p ? m.players.indexOf(p) : -1);
  const vector = (v: { x: number; y: number; z: number }) => { mix(v.x); mix(v.y); mix(v.z); };
  const rng = m.random.getState();
  flag(rng !== undefined);
  integer(rng ?? 0);
  integer(m.players.length);
  for (const p of m.players) {
    vector(p.pos); vector(p.vel); vector(p.facing); mix(p.stamina);
    mix(p.kickCooldown); mix(p.tackleTimer); mix(p.tackleCooldown); mix(p.stunned);
    mix(p.diveTimer); mix(p.wrongFoot); mix(p.actionLock); mix(p.facingLock);
    vector(p.tackleDir); vector(p.diveVel); vector(p.baitDir);
    flag(p.tackleResolved); flag(p.tackleKind === 'slide'); flag(p.diveKind === 'save');
    integer(p.diveSide); integer(p.attackDir); integer(p.yellows); flag(p.sentOff);
    flag(p.sprinting); flag(p.shielding); mix(p.contactScale);
  }
  const b = m.ball.position, v = m.ball.velocity;
  mix(b.x); mix(b.y); mix(b.z); mix(v.x); mix(v.y); mix(v.z);
  vector(m.ball.body.angularVelocity);
  player(m.ball.lastTouch);
  flag(m.ball.shot !== null);
  if (m.ball.shot) {
    integer(m.ball.shot.id); player(m.ball.shot.by);
    flag(m.ball.shot.saveRolled); flag(m.ball.shot.tipRolled ?? false);
  }
  integer(m.score[0]); integer(m.score[1]); mix(m.clock);
  mix(m.phaseTimer); mix(m.elapsed); integer(m.half); mix(m.halfClock); mix(m.stoppage);
  player(m.kickoffTaker);
  for (const side of m.sides) {
    player(side.controlled); player(side.holding);
    mix(side.holdTime); mix(side.holdJudge); mix(side.knockTimer); mix(side.receiveTimer);
    mix(side.lastSprintTap); mix(side.shiftDownAt); integer(side.sprintTaps);
    flag(side.powerTiming !== null);
    if (side.powerTiming) mix(side.powerTiming.elapsed);
    flag(side.queued !== null);
    if (side.queued) mix(side.queued.ttl);
    flag(side.skillBuffer !== null);
    if (side.skillBuffer) mix(side.skillBuffer.ttl);
  }
  const sp = m.setPieces.current;
  mix(m.setPieces.remainingOutTime);
  flag(sp !== null);
  if (sp) {
    integer(['throwin', 'corner', 'goalkick', 'freekick', 'indirect', 'penalty'].indexOf(sp.kind));
    integer(sp.team); vector(sp.spot); player(sp.taker);
    mix(sp.timer); flag(sp.ready); flag(sp.shooting);
  }
  mix(['kickoff', 'playing', 'out', 'setpiece', 'goal', 'halftime', 'fulltime', 'shootout'].indexOf(m.phase));
  player(m.ball.owner);
  return h >>> 0;
}
