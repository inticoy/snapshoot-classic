import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BALL, GOAL, KEEPER, MATCH, PASS, PITCH, PLAYER, SHOT } from '../config';
import { Ball } from '../entities/Ball';
import { Goal } from '../entities/Goal';
import { Player } from '../entities/Player';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { TeamAI } from '../ai/TeamAI';
import { Kicks, gauss, type KickResult, type PassKind } from './Kicks';
import { settings, type AssistLevel } from '../core/Settings';
import { n } from '../data/Stats';
import type { ButtonState } from '../core/Input';
import { TEAMS } from '../data/Teams';

export type Phase = 'kickoff' | 'playing' | 'goal' | 'fulltime';

export type MatchEvent =
  | { type: 'kick'; speed: number }
  | { type: 'bounce'; speed: number }
  | { type: 'post'; speed: number }
  | { type: 'net'; speed: number }
  | { type: 'save'; caught: boolean }
  | { type: 'goal'; team: 0 | 1; scorer: Player | null; ownGoal: boolean }
  | { type: 'whistle'; kind: 'kickoff' | 'fulltime' }
  | { type: 'tackle'; success: boolean };

export type KickKind = 'shoot' | 'pass' | 'through' | 'lob';
const KICK_KINDS: KickKind[] = ['shoot', 'pass', 'through', 'lob'];

/** 사용자 입력을 월드 좌표로 변환한 명령 */
export interface UserCommand {
  move: THREE.Vector3; // XZ, 크기 0..1
  sprint: boolean;
  shoot: ButtonState; // D
  pass: ButtonState; // S
  through: ButtonState; // W
  lob: ButtonState; // A
  modifier: ButtonState; // Q
  finesse: ButtonState; // Z
  contain: ButtonState; // C
  tackle: ButtonState; // Space
}

export interface MatchStats {
  possession: [number, number];
  shots: [number, number];
  onTarget: [number, number];
  tackles: [number, number];
  passes: [number, number];
  passesDone: [number, number];
}

const emptyStats = (): MatchStats => ({
  possession: [0, 0],
  shots: [0, 0],
  onTarget: [0, 0],
  tackles: [0, 0],
  passes: [0, 0],
  passesDone: [0, 0],
});

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const cv = new CANNON.Vec3();
const cspin = new CANNON.Vec3();


export class Match {
  readonly players: Player[] = [];
  readonly teams: [Player[], Player[]] = [[], []];
  readonly ball: Ball;
  readonly goals: [Goal, Goal];
  readonly score: [number, number] = [0, 0];
  readonly events: MatchEvent[] = [];
  readonly ai: TeamAI;
  readonly kicks: Kicks;

  phase: Phase = 'kickoff';
  phaseTimer = 0;
  clock = 0; // 경기 진행 시간 (실제 초)
  controlled: Player;
  /** 슛/패스 파워 게이지 (0..1), 차지 중이 아니면 null */
  charge: { kind: KickKind; value: number; finesse: boolean; chip: boolean } | null = null;
  /** 공이 오기 전에 미리 입력한 원터치 동작 */
  private queued: { kind: KickKind; value: number; finesse: boolean; chip: boolean; ttl: number } | null = null;
  stats: MatchStats = emptyStats();
  duration: number = MATCH.durationSeconds;
  private pendingPass: 0 | 1 | null = null;
  passTarget: Player | null = null;
  lastScorer: Player | null = null;
  private kickoffTeam: 0 | 1 = 0;
  private keeperHold = 0;
  private dribbleTouch = 0;

  constructor(private readonly physics: PhysicsWorld) {
    this.ball = new Ball(physics);
    // goals[0] = 홈팀이 공격하는 +X 골대, goals[1] = -X 골대
    this.goals = [new Goal(1, physics), new Goal(-1, physics)];

    const roles: Player['role'][] = ['GK', 'DEF', 'FWD'];
    for (const team of [0, 1] as const) {
      TEAMS[team].players.forEach((profile, i) => {
        const p = new Player(team, roles[i], profile.number, profile.short, profile);
        this.players.push(p);
        this.teams[team].push(p);
      });
    }
    this.controlled = this.teams[0][2];
    this.ai = new TeamAI(this);
    this.kicks = new Kicks(this);
    this.setupBallCollisions();
    this.startKickoff(0);
  }

  // ---------------------------------------------------------------- 헬퍼

  ownGoalX(team: 0 | 1): number {
    return (team === 0 ? -1 : 1) * PITCH.halfL;
  }

  oppGoalX(team: 0 | 1): number {
    return -this.ownGoalX(team);
  }

  isUserControlled(p: Player): boolean {
    return p === this.controlled && this.phase !== 'goal' && this.phase !== 'fulltime';
  }

  inOwnBox(p: Player, x: number, z: number): boolean {
    const gx = this.ownGoalX(p.team);
    return Math.abs(x - gx) < PITCH.boxDepth && Math.abs(z) < PITCH.boxWidth / 2 && Math.sign(x) === Math.sign(gx);
  }

  /** 발 위치 (공을 다루는 기준점) */
  footPoint(p: Player, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(p.pos).addScaledVector(p.facing, 0.35);
  }

  // ---------------------------------------------------------------- 진행

  startKickoff(team: 0 | 1): void {
    this.kickoffTeam = team;
    this.phase = 'kickoff';
    this.phaseTimer = MATCH.kickoffDelay;
    this.ball.reset(0, 0);
    this.charge = null;
    this.queued = null;
    this.passTarget = null;
    for (const p of this.players) {
      const a = p.attackDir;
      p.vel.set(0, 0, 0);
      p.stunned = p.tackleTimer = p.diveTimer = p.kickCooldown = 0;
      p.basePose = null;
      if (p.role === 'GK') p.pos.set(this.ownGoalX(p.team) + a * 0.8, 0, 0);
      else if (p.role === 'DEF') p.pos.set(-a * 13, 0, p.team === 0 ? 4 : -4);
      else p.pos.set(p.team === team ? -a * 0.6 : -a * 7, 0, p.team === team ? -0.3 : 0);
      p.facing.set(a, 0, 0);
    }
    const taker = this.teams[team][2];
    this.ball.owner = taker;
    this.ball.lastTouch = taker;
    this.ball.body.position.set(taker.pos.x + taker.attackDir * 0.35, BALL.radius, 0);
    if (team === 0) this.controlled = taker;
    else this.controlled = this.teams[0][2];
  }

  update(dt: number, cmd: UserCommand): void {
    this.phaseTimer -= dt;

    switch (this.phase) {
      case 'kickoff':
        // 휘슬 전까지는 정지
        for (const p of this.players) p.update(dt);
        this.carryBall(dt);
        if (this.phaseTimer <= 0) {
          this.phase = 'playing';
          this.events.push({ type: 'whistle', kind: 'kickoff' });
        }
        break;
      case 'playing':
        this.clock += dt;
        this.updatePlaying(dt, cmd);
        if (this.clock >= this.duration) {
          this.phase = 'fulltime';
          this.phaseTimer = 999;
          this.events.push({ type: 'whistle', kind: 'fulltime' });
          for (const p of this.players) {
            if (this.score[p.team] > this.score[1 - p.team]) p.basePose = 'celebrate';
          }
        }
        break;
      case 'goal':
        for (const p of this.players) {
          // 득점자 쪽으로 달려가서 축하
          if (this.lastScorer && p.team === this.lastScorer.team && p !== this.lastScorer && !p.isKeeper) {
            tmp.copy(this.lastScorer.pos).sub(p.pos).setY(0);
            const d = tmp.length();
            p.steer(d > 1.6 ? tmp.normalize() : tmp.set(0, 0, 0), false, false, dt);
          } else {
            p.steer(tmp.set(0, 0, 0), false, false, dt);
          }
          p.update(dt);
        }
        this.separatePlayers();
        this.physics.step(dt);
        if (this.phaseTimer <= 0) {
          const conceded = this.lastScorer ? ((1 - this.lastScorer.team) as 0 | 1) : this.kickoffTeam;
          this.startKickoff(conceded);
        }
        break;
      case 'fulltime':
        for (const p of this.players) {
          p.steer(tmp.set(0, 0, 0), false, false, dt);
          p.update(dt);
        }
        this.physics.step(dt);
        break;
    }

    for (const g of this.goals) g.update(dt);
  }

  private updatePlaying(dt: number, cmd: UserCommand): void {
    const holder = this.ball.owner ?? this.ball.lastTouch;
    if (holder) this.stats.possession[holder.team] += dt;
    this.handleUser(dt, cmd);
    this.ai.update(dt);
    this.updateKeepers(dt);

    for (const p of this.players) p.update(dt);
    this.separatePlayers();
    this.resolveTackles();
    this.carryBall(dt);
    this.physics.step(dt);
    this.deflectOffBodies();
    this.checkPossession();
    this.checkGoal();
  }

  // ---------------------------------------------------------------- 사용자 조작

  private handleUser(dt: number, cmd: UserCommand): void {
    const p = this.controlled;
    const owner = this.ball.owner;
    const hasBall = owner === p;
    const teamHasBall = owner?.team === p.team;
    const oppHasBall = !!owner && owner.team !== p.team;
    const bp = this.ball.position;
    const ballDist = Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z);
    // 공을 가졌거나, 굴러오는 공이 가까우면 공격 입력 (원터치 예약 가능)
    const attacking = hasBall || (!owner && ballDist < 4.5);

    // S (수비 시) = 선수 변경
    if (cmd.pass.pressed && !attacking && !teamHasBall) this.switchToNearest();

    const move = cmd.move.clone();
    // 패스 받는 중이고 입력이 없으면 공 쪽으로 자동으로 다가간다
    if (move.lengthSq() < 0.01 && this.passTarget === p && !owner) {
      tmp.set(bp.x - p.pos.x, 0, bp.z - p.pos.z);
      if (tmp.length() > 0.6) move.copy(tmp.normalize()).multiplyScalar(0.85);
    }
    // Q 꾹 = 동료 압박 (가장 가까운 AI 동료가 같이 붙는다)
    this.teammatePress = oppHasBall && cmd.modifier.held;
    // D 꾹 = 압박 (바짝 붙음) / C 꾹 = 견제 (거리를 두고 길목을 막으며 천천히)
    const pressing = oppHasBall && cmd.shoot.held;
    const containing = oppHasBall && cmd.contain.held && !pressing;
    let speedScale = 1;
    if (pressing || containing) {
      const gx = this.ownGoalX(p.team);
      tmp.set(gx - owner!.pos.x, 0, -owner!.pos.z).normalize();
      tmp2.copy(owner!.pos).addScaledVector(tmp, pressing ? 1.0 : 1.8).addScaledVector(owner!.vel, 0.2).sub(p.pos).setY(0);
      const d = tmp2.length();
      const auto = d > 0.2 ? tmp2.multiplyScalar(Math.min(1, d / 1.5) / d) : tmp2.set(0, 0, 0);
      move.multiplyScalar(0.35).add(auto.multiplyScalar(0.8));
      if (move.length() > 1) move.normalize();
      if (containing) speedScale = cmd.sprint ? 0.95 : 0.7;
    }
    if (!p.busy) p.steer(move, cmd.sprint, hasBall, dt, speedScale);
    // 압박/견제 중에는 상대를 바라본다 (뒷걸음질)
    if ((pressing || containing) && !p.busy) {
      const d = owner!.pos.distanceTo(p.pos);
      if (d < 4) p.faceTowards(owner!.pos.x, owner!.pos.z);
    }

    // 파워 게이지: D 슛 / S 패스 / W 스루 / A 로빙. Z = 감아차기, Q = 칩슛 / 로빙 스루
    if (attacking && !this.charge) {
      for (const kind of KICK_KINDS) {
        if (cmd[kind].pressed) {
          this.charge = { kind, value: 0, finesse: cmd.finesse.held, chip: cmd.modifier.held };
          break;
        }
      }
    }
    if (this.charge) {
      const c = this.charge;
      const btn = cmd[c.kind];
      c.value = Math.min(1, c.value + dt / (c.kind === 'shoot' ? SHOT.chargeTime : PASS.chargeTime));
      if (cmd.finesse.held) c.finesse = true;
      if (cmd.modifier.held) c.chip = true;
      if (oppHasBall) {
        this.charge = null; // 차는 도중 공을 뺏김
      } else if (btn.released || !btn.held) {
        if (this.ball.owner === p) this.execute(p, c.kind, c.value, c.finesse, c.chip, cmd.move);
        else this.queued = { kind: c.kind, value: c.value, finesse: c.finesse, chip: c.chip, ttl: 0.7 };
        this.charge = null;
      }
    }
    if (this.queued) {
      this.queued.ttl -= dt;
      if (this.queued.ttl <= 0 || oppHasBall) this.queued = null;
    }
    this.lastMove.copy(cmd.move);

    // 수비: Space = 스탠딩 태클, A = 슬라이딩 태클
    if (!attacking && !teamHasBall && !p.busy && p.tackleCooldown <= 0) {
      const kind = cmd.tackle.pressed ? 'stand' : cmd.lob.pressed ? 'slide' : null;
      if (kind) {
        const dir = cmd.move.lengthSq() > 0.01 ? cmd.move.clone() : p.facing.clone();
        // 공 쪽으로 방향 보정
        tmp.set(bp.x - p.pos.x, 0, bp.z - p.pos.z);
        if (tmp.length() < 4) dir.lerp(tmp.normalize(), kind === 'stand' ? 0.85 : 0.6).normalize();
        p.startTackle(dir, kind);
      }
    }
  }

  private readonly lastMove = new THREE.Vector3();
  /** S 꾹: 가장 가까운 AI 동료가 공 소유자를 압박 */
  teammatePress = false;

  private execute(p: Player, kind: KickKind, value: number, finesse: boolean, chip: boolean, move: THREE.Vector3): void {
    if (kind === 'shoot') {
      if (chip && !finesse) this.chipShot(p, value, move);
      else this.shoot(p, value, finesse, move);
      return;
    }
    const dir = move.lengthSq() > 0.01 ? move : p.facing;
    // Q+W = 로빙 스루 패스
    if (kind === 'through' && chip) this.pass(p, dir, 'lobThrough', value);
    else this.pass(p, dir, kind === 'pass' ? 'short' : kind, value);
  }

  /** 사용자 팀은 설정한 보정, AI는 항상 보조 (오차는 능력치로) */
  assistFor(p: Player, kind: 'pass' | 'shot'): AssistLevel {
    if (p.team !== 0) return 'assisted';
    return kind === 'pass' ? settings.passAssist : settings.shotAssist;
  }

  /** Q+D 칩슛 */
  chipShot(p: Player, charge: number, aim: THREE.Vector3): void {
    this.applyShot(p, this.kicks.chip(p, charge, aim, this.assistFor(p, 'shot')));
  }

  switchToNearest(): void {
    let best: Player | null = null;
    let bestD = Infinity;
    for (const p of this.teams[0]) {
      if (p.isKeeper || p === this.controlled) continue;
      const d = p.pos.distanceToSquared(tmp.set(this.ball.position.x, 0, this.ball.position.z));
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) this.controlled = best;
  }

  // ---------------------------------------------------------------- 액션

  /** 슛. charge 0..1, aim = 입력 방향. 파워가 너무 세면 공이 뜬다 (FIFA식) */
  shoot(p: Player, charge: number, finesse: boolean, aim: THREE.Vector3): void {
    this.applyShot(p, this.kicks.shot(p, charge, finesse, aim, this.assistFor(p, 'shot')));
  }

  private applyShot(p: Player, r: KickResult): void {
    this.kickBall(p, r.vel, r.spin);
    this.ball.newShot(p);
    this.stats.shots[p.team]++;
    this.passTarget = null;
  }

  /** 패스. short = 땅볼, through = 침투 공간으로, lob = 띄워서, lobThrough = 띄운 스루 */
  pass(p: Player, dir: THREE.Vector3, kind: PassKind = 'short', charge = 0.5): void {
    const r = this.kicks.pass(p, dir, kind, charge, this.assistFor(p, 'pass'));
    this.kickBall(p, r.vel, r.spin);
    this.ball.shot = null;
    this.passTarget = r.receiver;
    this.stats.passes[p.team]++;
    this.pendingPass = p.team;
    if (r.receiver && p.team === 0 && !r.receiver.isKeeper) this.controlled = r.receiver;
  }

  private kickBall(p: Player, vel: CANNON.Vec3, spin: CANNON.Vec3): void {
    // 공이 몸의 오른쪽에 있으면 오른발로 찬다
    const { side } = this.kicks.footFactor(p);
    p.facing.set(vel.x, 0, vel.z).normalize();
    p.playAction('kick', 0.4, { side });
    // 들고 있던 공(키퍼)은 발 앞에서 출발
    if (this.ball.position.y > 0.5 && p.isKeeper) {
      this.ball.body.position.set(p.pos.x + p.facing.x * 0.6, 0.9, p.pos.z + p.facing.z * 0.6);
    }
    this.ball.kick(vel, spin, p);
    p.kickCooldown = PLAYER.kickCooldown;
    p.basePose = null;
    this.events.push({ type: 'kick', speed: vel.length() });
  }

  /** 패스 길목에 상대가 있으면 1 */
  laneBlocked(from: Player, to: Player): number {
    const a = from.pos, b = to.pos;
    const ab = tmp2.copy(b).sub(a);
    const len2 = ab.lengthSq();
    for (const o of this.teams[1 - from.team]) {
      const t = THREE.MathUtils.clamp(((o.pos.x - a.x) * ab.x + (o.pos.z - a.z) * ab.z) / len2, 0, 1);
      const px = a.x + ab.x * t - o.pos.x;
      const pz = a.z + ab.z * t - o.pos.z;
      if (px * px + pz * pz < 1.4 * 1.4 && t > 0.1 && t < 0.95) return 1;
    }
    return 0;
  }

  nearestOpponentDist(p: Player): number {
    let best = Infinity;
    for (const o of this.teams[1 - p.team]) best = Math.min(best, o.pos.distanceTo(p.pos));
    return best;
  }

  // ---------------------------------------------------------------- 공 & 몸싸움

  /** 소유 중인 공을 발 앞에 붙여 다닌다 */
  private carryBall(dt: number): void {
    const o = this.ball.owner;
    if (!o) return;
    if (o.isKeeper && this.ball.position.y > 0.4) {
      // 키퍼가 손에 들고 있음
      tmp.copy(o.pos).addScaledVector(o.facing, 0.32);
      cv.set(tmp.x, 0, tmp.z);
      this.ball.carry(cv, o.cannonVel, dt, 1.15);
      return;
    }
    // 스프린트 중에는 공을 조금 더 멀리 치고 나간다 (터치)
    this.dribbleTouch += dt * (2 + Math.hypot(o.vel.x, o.vel.z) * 0.5);
    const speed = Math.hypot(o.vel.x, o.vel.z);
    const st = o.profile.stats;
    const reach =
      PLAYER.dribbleOffset + 0.08 - 0.16 * n(st.ballControl) +
      (o.sprinting ? 0.18 + 0.25 * (1 - n(st.dribbling)) : 0) +
      Math.max(0, Math.sin(this.dribbleTouch * Math.PI)) * 0.08 * Math.min(1, speed / 3);
    tmp.copy(o.pos).addScaledVector(o.facing, reach);
    cv.set(tmp.x, 0, tmp.z);
    this.ball.carry(cv, o.cannonVel, dt);
  }

  private resolveTackles(): void {
    for (const p of this.players) {
      if (p.tackleTimer <= 0 || p.tackleResolved) continue;
      const o = this.ball.owner;
      this.footPoint(p, tmp).addScaledVector(p.facing, 0.25);
      const bp = this.ball.position;
      const d = Math.hypot(bp.x - tmp.x, bp.z - tmp.z);
      if (d > p.tackleRange || bp.y > 0.8) continue;
      if (o && o.team !== p.team) {
        // 정면 태클이 성공률이 높다
        const facingDot = -o.facing.dot(p.tackleDir);
        const ts = p.profile.stats, os = o.profile.stats;
        const tackleSkill =
          p.tackleKind === 'stand'
            ? n(ts.standingTackle) * 0.6 + n(ts.defAwareness) * 0.4
            : n(ts.slidingTackle) * 0.8 + n(ts.defAwareness) * 0.2;
        const evade = n(os.dribbling) * 0.4 + n(os.balance) * 0.35 + n(os.strength) * 0.25;
        const chance = THREE.MathUtils.clamp(0.22 + 0.5 * tackleSkill - 0.28 * evade + 0.3 * Math.max(0, facingDot), 0.08, 0.92);
        const success = Math.random() < chance;
        p.tackleResolved = true;
        p.tackleTimer = Math.min(p.tackleTimer, 0.08);
        this.events.push({ type: 'tackle', success });
        if (success) {
          this.stats.tackles[p.team]++;
          o.stunned = 0.55;
          o.basePose = null;
          if (o.team === 0) this.charge = null;
          if (p.tackleKind === 'stand') {
            // 스탠딩 태클은 공을 그대로 빼앗는다
            this.gainPossession(p);
          } else {
            this.ball.owner = null;
            cv.set(p.tackleDir.x * 5 + gauss(), 0.6, p.tackleDir.z * 5 + gauss());
            this.ball.kick(cv, cspin.set(0, 0, 0), p);
            p.kickCooldown = 0.12;
          }
        } else {
          p.kickCooldown = p.tackleKind === 'stand' ? 0.25 : 0.4;
        }
      } else if (!o) {
        // 굴러가는 공을 태클로 걷어냄
        p.tackleResolved = true;
        p.tackleTimer = Math.min(p.tackleTimer, 0.08);
        cv.set(p.tackleDir.x * 7, 0.8, p.tackleDir.z * 7);
        this.ball.kick(cv, cspin.set(0, 0, 0), p);
        this.ball.shot = null;
        p.kickCooldown = 0.12;
      }
    }
  }

  /** 아무도 소유하지 않은 공이 선수 발 근처에 오면 잡는다 */
  private checkPossession(): void {
    if (this.ball.owner) return;
    const bp = this.ball.position;
    const bv = this.ball.velocity;
    let best: Player | null = null;
    let bestD = Infinity;
    for (const p of this.players) {
      if (p.kickCooldown > 0 || p.stunned > 0 || p.tackleTimer > 0) continue;
      const keeperHands = p.isKeeper && this.inOwnBox(p, bp.x, bp.z);
      if (keeperHands) {
        // 키퍼는 슛을 선방 판정으로만 막는다
        if (this.ball.shot && this.ball.shot.by.team !== p.team) continue;
        if (bp.y > GOAL.height + 0.2) continue;
        const d = Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z);
        if (d < KEEPER.reach && d < bestD) {
          best = p;
          bestD = d;
        }
        continue;
      }
      if (bp.y > 1.0) continue;
      const st = p.profile.stats;
      this.footPoint(p, tmp);
      const d = Math.hypot(bp.x - tmp.x, bp.z - tmp.z);
      const intercepting = this.pendingPass !== null && this.pendingPass !== p.team;
      const radius = PLAYER.controlRadius - 0.06 + 0.14 * n(st.reactions) + (intercepting ? 0.3 * n(st.interceptions) : 0);
      if (d > radius) continue;
      // 너무 빠른 공은 트래핑 실패 (몸에 맞고 튕김)
      const rel = Math.hypot(bv.x - p.vel.x, bv.z - p.vel.z);
      if (rel > 13 + 9 * n(st.ballControl)) continue;
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    if (!best) return;
    // 볼 컨트롤이 낮으면 빠른 공을 받을 때 터치가 길어진다 (헤비 터치)
    const rel = Math.hypot(bv.x - best.vel.x, bv.z - best.vel.z);
    if (!best.isKeeper && rel > 9 && Math.random() < (1 - n(best.profile.stats.ballControl)) * 0.7) {
      const push = 2.5 + rel * 0.15;
      cv.set(best.facing.x * push + bv.x * 0.15, 0.3, best.facing.z * push + bv.z * 0.15);
      this.ball.kick(cv, cspin.set(0, 0, 0), best);
      this.ball.shot = null;
      best.kickCooldown = 0.22;
      return;
    }
    this.gainPossession(best);
  }

  private gainPossession(best: Player): void {
    const bp = this.ball.position;
    this.ball.owner = best;
    this.ball.lastTouch = best;
    this.ball.shot = null;
    this.passTarget = null;
    if (this.pendingPass !== null) {
      if (best.team === this.pendingPass) this.stats.passesDone[best.team]++;
      this.pendingPass = null;
    }
    if (best.team === 0 && !best.isKeeper) this.controlled = best;
    if (best.isKeeper) {
      this.keeperHold = 0;
      if (this.inOwnBox(best, bp.x, bp.z)) {
        best.basePose = 'hold';
        this.ball.body.position.y = Math.max(bp.y, 0.6);
      }
      return;
    }
    // 미리 입력해 둔 원터치 슛/패스
    if (best === this.controlled && this.queued) {
      const q = this.queued;
      this.queued = null;
      this.execute(best, q.kind, q.value, q.finesse, q.chip, this.lastMove);
    }
  }

  /** 소유할 수 없는 공은 선수 몸에 맞고 튕긴다 (슛 블록) */
  private deflectOffBodies(): void {
    if (this.ball.owner) return;
    const bp = this.ball.position;
    const bv = this.ball.velocity;
    if (bp.y > 1.9) return;
    for (const p of this.players) {
      if (p.kickCooldown > 0 || (p.isKeeper && this.ball.shot)) continue;
      const dx = bp.x - p.pos.x;
      const dz = bp.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const r = 0.3 + BALL.radius;
      if (d > r || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d;
      const vn = (bv.x - p.vel.x) * nx + (bv.z - p.vel.z) * nz;
      if (vn >= 0) continue;
      bv.x -= 1.45 * vn * nx;
      bv.z -= 1.45 * vn * nz;
      bv.x *= 0.6;
      bv.z *= 0.6;
      bp.x = p.pos.x + nx * r;
      bp.z = p.pos.z + nz * r;
      this.ball.lastTouch = p;
      if (this.ball.shot && this.ball.shot.by.team !== p.team) this.ball.shot = null;
      p.kickCooldown = 0.15;
      this.events.push({ type: 'bounce', speed: Math.abs(vn) });
    }
  }

  private separatePlayers(): void {
    const minD = PLAYER.radius * 2 * 0.85;
    for (let i = 0; i < this.players.length; i++) {
      for (let j = i + 1; j < this.players.length; j++) {
        const a = this.players[i], b = this.players[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d >= minD || d < 1e-5) continue;
        // 슬라이딩/다이빙 중에는 몸이 겹쳐도 된다
        if (a.tackleTimer > 0 || b.tackleTimer > 0 || a.diveTimer > 0 || b.diveTimer > 0) continue;
        const push = (minD - d) / 2;
        const nx = dx / d, nz = dz / d;
        // 몸싸움/밸런스가 좋을수록, 공을 가진 선수일수록 덜 밀린다
        const mass = (q: Player) =>
          (0.6 + n(q.profile.stats.strength) + 0.4 * n(q.profile.stats.balance)) * (this.ball.owner === q ? 1.8 : 1);
        const ma = mass(a), mb = mass(b);
        const wa = (2 * mb) / (ma + mb);
        const wb = 2 - wa;
        a.pos.x -= nx * push * wa;
        a.pos.z -= nz * push * wa;
        b.pos.x += nx * push * wb;
        b.pos.z += nz * push * wb;
      }
    }
  }

  // ---------------------------------------------------------------- 키퍼

  private updateKeepers(dt: number): void {
    for (const k of [this.teams[0][0], this.teams[1][0]]) this.updateKeeper(k, dt);
  }

  private updateKeeper(k: Player, dt: number): void {
    const a = k.attackDir;
    const gx = this.ownGoalX(k.team);
    const bp = this.ball.position;
    const bv = this.ball.velocity;

    if (this.ball.owner === k) {
      this.keeperHold += dt;
      k.steer(tmp.set(0, 0, 0), false, true, dt);
      k.faceTowards(k.pos.x + a, k.pos.z);
      if (this.keeperHold > KEEPER.holdTime) {
        // 가장 열린 필드 플레이어에게 배급
        const mates = this.teams[k.team].filter((m) => !m.isKeeper);
        mates.sort((m1, m2) => this.openness(m2) - this.openness(m1));
        const target = mates[0];
        tmp.copy(target.pos).sub(k.pos).setY(0).normalize();
        this.pass(k, tmp);
        k.basePose = null;
      }
      return;
    }
    // 다이빙 중에도 선방 판정은 해야 한다
    this.trySave(k);
    if (k.busy) return;

    let targetX = gx + a * 0.5;
    let targetZ = 0;
    let urgent = false;

    // 1) 골문으로 날아오는 공 예측
    const towardGoal = bv.x * -a > 2.5;
    if (!this.ball.owner && towardGoal) {
      const t = (gx - bp.x) / bv.x;
      if (t > 0 && t < 1.8) {
        const zc = bp.z + bv.z * t;
        const yc = bp.y + bv.y * t - 4.9 * t * t;
        if (Math.abs(zc) < GOAL.width / 2 + 0.8 && yc < GOAL.height + 0.6) {
          urgent = true;
          // 키퍼가 서 있는 x 지점에서의 공 z
          const tk = (k.pos.x - bp.x) / bv.x;
          targetZ = THREE.MathUtils.clamp(bp.z + bv.z * Math.max(0, tk), -GOAL.width / 2 - 0.3, GOAL.width / 2 + 0.3);
          targetX = k.pos.x;
          const gap = targetZ - k.pos.z;
          const shot = this.ball.shot;
          if (shot && Math.abs(gap) > 0.9 && tk < 0.55 && tk > 0.05) {
            // 다이빙
            const vz = THREE.MathUtils.clamp(gap / Math.max(tk, 0.15), -7.5, 7.5);
            // 모델 로컬 +X 축의 월드 방향은 (cosθ, 0, -sinθ)
            const theta = Math.atan2(k.facing.x, k.facing.z);
            const localX = -Math.sin(theta) * Math.sign(vz);
            k.startDive(new THREE.Vector3(0, 0, vz), (localX >= 0 ? 1 : -1) as 1 | -1);
          }
        }
      }
    }

    // 2) 위치 선정: 공과 골대 중앙을 잇는 선 위
    if (!urgent) {
      const dx = bp.x - gx;
      const dz = bp.z;
      const dist = Math.hypot(dx, dz);
      const gs = k.profile.stats;
      const out = THREE.MathUtils.clamp(dist * (0.07 + 0.05 * n(gs.positioning ?? 60)), 0.5, 3.2);
      targetX = gx + (dx / dist) * out;
      targetZ = (dz / dist) * out;
      targetZ = THREE.MathUtils.clamp(targetZ, -GOAL.width / 2 + 0.3, GOAL.width / 2 - 0.3);

      // 3) 박스 안의 느린 공은 직접 처리하러 나간다
      const loose =
        !this.ball.owner && !this.ball.shot && bp.y < 1.2 && this.ball.speed() < 9 && this.inOwnBox(k, bp.x, bp.z);
      if (loose && this.closestToBall(k)) {
        targetX = bp.x;
        targetZ = bp.z;
        urgent = true;
      }
    }

    tmp.set(targetX - k.pos.x, 0, targetZ - k.pos.z);
    const d = tmp.length();
    if (d > 0.1) tmp.multiplyScalar(Math.min(1, d / 1.2) / d);
    else tmp.set(0, 0, 0);
    // 머리 위로 날아오는 공을 보며 뒷걸음질할 때는 느리다 (칩슛이 통하는 이유)
    const lofted = !!this.ball.shot && bp.y > 2.2 && bv.y > -1;
    const backpedal = (targetX - k.pos.x) * a < 0;
    const scale = lofted && backpedal ? 0.35 : 1;
    // GK 다이빙 능력치가 좌우 이동 속도에도 반영된다
    const agility = 0.88 + 0.22 * n(k.profile.stats.diving ?? 60);
    k.steer(tmp, urgent, false, dt, (KEEPER.speed / PLAYER.jogSpeed) * scale * agility);
    // 키퍼는 항상 공을 바라본다
    if (!urgent || d < 1) k.faceTowards(bp.x, bp.z);
  }

  private trySave(k: Player): void {
    const shot = this.ball.shot;
    if (!shot || shot.saveRolled || shot.by.team === k.team || this.ball.owner) return;
    const bp = this.ball.position;
    if (bp.y > GOAL.height + 0.35) return;
    // 이미 키퍼 머리 위로 넘어간 공(칩슛)은 손이 닿지 않는다
    const gx = this.ownGoalX(k.team);
    const behind = Math.abs(gx - k.pos.x) - Math.abs(gx - bp.x);
    if (behind > 0.35) return;
    const gs = k.profile.stats;
    const reach = k.diveTimer > 0 ? KEEPER.diveReach * (0.85 + 0.25 * n(gs.diving ?? 60)) : KEEPER.reach;
    // 다이빙 중에는 몸이 옆으로 누워 있으므로 손 위치는 다이빙 방향
    const hx = k.pos.x + (k.diveTimer > 0 ? k.diveVel.x * 0.12 : 0);
    const hz = k.pos.z + (k.diveTimer > 0 ? Math.sign(k.diveVel.z) * 0.6 : 0);
    const d = Math.hypot(bp.x - hx, bp.z - hz);
    if (d > reach) return;

    shot.saveRolled = true;
    const speed = this.ball.speed();
    const placement = Math.min(1, Math.abs(bp.z) / (GOAL.width / 2)); // 구석일수록 어렵다
    const curling = Math.abs(this.ball.body.angularVelocity.y) > 8 ? 0.12 : 0;
    // 위에서 떨어지는 공은 잡기 어렵다
    const dropping = this.ball.velocity.y < -3 ? 0.3 : 0;
    const chance = THREE.MathUtils.clamp(
      1.28 - speed / 30 - placement * 0.45 - curling - dropping - (d > KEEPER.reach ? 0.12 : 0) +
        (n(gs.reflexes ?? 60) - 0.7) * 0.4 + (n(gs.positioning ?? 60) - 0.7) * 0.15,
      0.15,
      0.95,
    );
    if (Math.random() > chance) return; // 실점!
    this.stats.onTarget[shot.by.team]++;

    const a = k.attackDir;
    // GK 핸들링이 좋을수록 빠른 슛도 잡아낸다 (아니면 쳐낸다)
    const handling = n(gs.handling ?? 60);
    if (speed < 13 + 7 * handling && Math.random() < 0.45 + 0.45 * handling) {
      // 캐치
      this.ball.owner = k;
      this.ball.lastTouch = k;
      this.ball.shot = null;
      this.keeperHold = 0;
      k.basePose = 'hold';
      this.ball.body.position.y = Math.max(bp.y, 0.6);
      this.events.push({ type: 'save', caught: true });
    } else {
      // 펀칭/쳐내기
      const bv = this.ball.velocity;
      cv.set(a * (Math.abs(bv.x) * 0.3 + 3), Math.abs(bv.y) * 0.4 + 2.5, bv.z * 0.25 + gauss() * 5);
      this.ball.kick(cv, cspin.set(0, 0, 0), k);
      this.ball.shot = null;
      k.kickCooldown = 0.5;
      this.events.push({ type: 'save', caught: false });
    }
  }

  /** 주변 상대가 멀수록 큰 값 */
  openness(p: Player): number {
    return this.nearestOpponentDist(p) + p.attackDir * p.pos.x * 0.05;
  }

  closestToBall(p: Player): boolean {
    const bp = this.ball.position;
    const d = Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z);
    return this.players.every((o) => o === p || Math.hypot(bp.x - o.pos.x, bp.z - o.pos.z) >= d);
  }

  // ---------------------------------------------------------------- 골

  private checkGoal(): void {
    const bp = this.ball.position;
    if (Math.abs(bp.x) < PITCH.halfL + BALL.radius) return;
    if (Math.abs(bp.z) > GOAL.width / 2 || bp.y > GOAL.height) return;
    // +X 골대에 들어가면 홈팀(0) 득점
    const team: 0 | 1 = bp.x > 0 ? 0 : 1;
    this.score[team]++;
    const scorer = this.ball.lastTouch;
    const ownGoal = !!scorer && scorer.team !== team;
    if (!ownGoal) this.stats.onTarget[team]++;
    this.lastScorer = ownGoal ? null : scorer;
    this.phase = 'goal';
    this.phaseTimer = MATCH.goalCelebration;
    this.ball.owner = null;
    this.ball.shot = null;
    this.charge = null;
    if (this.lastScorer) this.lastScorer.basePose = 'celebrate';
    for (const p of this.teams[team]) if (p !== this.lastScorer && !p.isKeeper) p.basePose = null;
    if (!this.lastScorer) {
      // 자책골이면 득점 팀 공격수를 기준으로 세리머니
      this.lastScorer = this.teams[team][2];
      this.lastScorer.basePose = 'celebrate';
    }
    this.events.push({ type: 'goal', team, scorer, ownGoal });
  }

  // ---------------------------------------------------------------- 사운드용 충돌

  private setupBallCollisions(): void {
    const posts = new Set(this.goals.flatMap((g) => g.postBodies));
    const nets = new Map<CANNON.Body, Goal>();
    for (const g of this.goals) for (const b of g.netBodies) nets.set(b, g);
    this.ball.body.addEventListener('collide', (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
      const impact = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (this.ball.owner) return;
      if (posts.has(e.body)) {
        if (impact > 2) this.events.push({ type: 'post', speed: impact });
      } else if (nets.has(e.body)) {
        const p = this.ball.position;
        nets.get(e.body)!.hitNet(new THREE.Vector3(p.x, p.y, p.z), impact);
        if (impact > 1.5) this.events.push({ type: 'net', speed: impact });
      } else if (impact > 2.5) {
        this.events.push({ type: 'bounce', speed: impact });
      }
    });
  }

  restart(): void {
    this.score[0] = this.score[1] = 0;
    this.stats = emptyStats();
    this.queued = null;
    this.pendingPass = null;
    this.clock = 0;
    this.lastScorer = null;
    for (const p of this.players) p.stamina = 1;
    this.startKickoff(0);
  }
}
