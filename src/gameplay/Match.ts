import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BALL, GOAL, KEEPER, MATCH, PASS, PHYSICS, PITCH, PLAYER, SHOT } from '../config';
import { Ball } from '../entities/Ball';
import { Goal } from '../entities/Goal';
import { Random } from '../core/Random';
import { Player, type PlayerModelFactory } from '../entities/Player';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { TeamAI } from '../ai/TeamAI';
import { Kicks, type KickResult, type PassKind } from './Kicks';
import { MOVE_ASSIST_TIME, settings, type AssistLevel } from '../core/Settings';
import { n } from '../data/Stats';
import { activePhysics } from '../physics/presets';
import type { ButtonState } from '../core/Input';
import { TEAMS } from '../data/Teams';
import { FORMATION_433 } from '../data/Formation';
import { SetPieces, type RestartKind } from './SetPieces';
import { Keepers } from './Keepers';
import { Rules, type Card } from './Rules';
import { Shootout } from './Shootout';

export type Phase = 'kickoff' | 'playing' | 'out' | 'setpiece' | 'goal' | 'halftime' | 'shootout' | 'fulltime';

export type MatchEvent =
  | { type: 'kick'; speed: number }
  | { type: 'bounce'; speed: number }
  | { type: 'post'; speed: number }
  | { type: 'net'; speed: number }
  | { type: 'save'; caught: boolean }
  | { type: 'keeperBlock'; keeper: Player; speed: number }
  | { type: 'smother'; keeper: Player; caught: boolean }
  | { type: 'cross'; keeper: Player; caught: boolean }
  | { type: 'goal'; team: 0 | 1; scorer: Player | null; ownGoal: boolean }
  | { type: 'whistle'; kind: 'kickoff' | 'halftime' | 'fulltime' }
  | { type: 'foul'; by: Player; on: Player; penalty: boolean }
  | { type: 'advantage'; team: 0 | 1 }
  | { type: 'card'; player: Player; card: Card; second: boolean }
  | { type: 'offside'; player: Player }
  | { type: 'stoppage'; minutes: number }
  | { type: 'penaltyKick'; team: 0 | 1; scored: boolean; kicker: Player }
  | { type: 'shootoutEnd'; score: [number, number] }
  | { type: 'tackle'; success: boolean }
  | { type: 'out'; kind: RestartKind; team: 0 | 1 }
  | { type: 'restart'; kind: RestartKind; team: 0 | 1 };

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


export interface MatchOptions {
  random?: Random;
  createPlayerModel?: PlayerModelFactory;
  /** Node 시뮬레이션에서는 골망 정점 갱신을 생략하되 충돌체는 그대로 둔다. */
  goalVisuals?: boolean;
  /** AI 대 AI 검증에서도 실제 경기 루프를 그대로 사용한다. */
  userControl?: boolean;
  /** 무승부면 승부차기 (기본: 설정값) */
  shootout?: boolean;
}

export class Match {
  readonly random: Random;
  readonly players: Player[] = [];
  readonly teams: [Player[], Player[]] = [[], []];
  readonly ball: Ball;
  readonly goals: [Goal, Goal];
  readonly score: [number, number] = [0, 0];
  readonly events: MatchEvent[] = [];
  readonly ai: TeamAI;
  readonly kicks: Kicks;
  readonly setPieces: SetPieces;
  readonly keepers: Keepers;
  readonly rules: Rules;
  readonly shootout: Shootout;
  keeperRush = false;
  /** 전반 1, 후반 2 */
  half: 1 | 2 = 1;
  /** 이번 하프에서 흐른 시간 (실제 초) */
  halfClock = 0;
  /** 하프 종료 때 알린 추가 시간 (분, 90분 환산). 알리기 전에는 0 */
  stoppage = 0;
  /** 퇴장 선수를 경기 재시작 때 되돌리기 위한 원래 명단 */
  private readonly roster: Player[] = [];

  phase: Phase = 'kickoff';
  phaseTimer = 0;
  /** 벽시계 대신 고정 스텝 시간을 써서 AI 움직임도 재현한다. */
  elapsed = 0;
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
  private dribbleTouch = 0;

  constructor(private readonly physics: PhysicsWorld, private readonly options: MatchOptions = {}) {
    this.random = options.random ?? new Random();
    this.ball = new Ball(physics);
    // goals[0] = 홈팀이 공격하는 +X 골대, goals[1] = -X 골대
    this.goals = [new Goal(1, physics, options.goalVisuals), new Goal(-1, physics, options.goalVisuals)];

    for (const team of [0, 1] as const) {
      FORMATION_433.forEach((slot, i) => {
        const profile = TEAMS[team].players[i];
        const p = new Player(team, slot.role, profile.number, profile.short, profile, slot, options.createPlayerModel);
        this.players.push(p);
        this.teams[team].push(p);
      });
    }
    this.controlled = this.forward(0);
    this.ai = new TeamAI(this);
    this.kicks = new Kicks(this);
    this.setPieces = new SetPieces(this);
    this.keepers = new Keepers(this, physics);
    this.rules = new Rules(this);
    this.shootout = new Shootout(this);
    this.roster.push(...this.players);
    this.setupBallCollisions();
    this.startKickoff(0);
  }

  // ---------------------------------------------------------------- 헬퍼

  /** 팀의 최전방 공격수 */
  forward(team: 0 | 1): Player {
    return this.teams[team].find((p) => p.slot.label === 'ST') ?? this.teams[team][this.teams[team].length - 1];
  }

  ownGoalX(team: 0 | 1): number {
    return -this.teams[team][0].attackDir * PITCH.halfL;
  }

  get userControl(): boolean {
    return this.options.userControl !== false;
  }

  /** 한 하프의 길이 (실제 초) */
  get halfLength(): number {
    return this.duration / 2;
  }

  /** 90분 환산 경기 시간 (분). 추가 시간에는 45·90을 넘어간다 */
  get matchMinutes(): number {
    return (this.half - 1) * 45 + (this.halfClock / this.halfLength) * 45;
  }

  oppGoalX(team: 0 | 1): number {
    return -this.ownGoalX(team);
  }

  isUserControlled(p: Player): boolean {
    return this.options.userControl !== false && p === this.controlled && this.phase !== 'goal' && this.phase !== 'fulltime' &&
      this.phase !== 'halftime' && this.phase !== 'shootout';
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
    this.keeperRush = false;
    this.keepers.reset();
    this.kickoffTeam = team;
    this.phase = 'kickoff';
    this.phaseTimer = MATCH.kickoffDelay;
    this.ball.reset(0, 0);
    this.charge = null;
    this.queued = null;
    this.passTarget = null;
    this.setPieces.current = null;
    this.rules.clearPlay();
    for (const p of this.players) {
      const a = p.attackDir;
      p.vel.set(0, 0, 0);
      p.stunned = p.tackleTimer = p.diveTimer = p.kickCooldown = 0;
      p.basePose = null;
      p.keeperAdvancing = false;
      // 포메이션 위치 (자기 진영). 킥오프 팀 공격수는 센터 서클 안
      const slot = p.slot;
      if (p.role === 'GK') p.pos.set(this.ownGoalX(p.team) + a * 0.8, 0, 0);
      else if (p === this.forward(team)) p.pos.set(-a * 0.6, 0, -0.3);
      else p.pos.set(a * Math.min(slot.fx, -PITCH.centerCircle - 1), 0, slot.z * a);
      p.facing.set(a, 0, 0);
    }
    const taker = this.forward(team);
    this.ball.owner = taker;
    this.ball.lastTouch = taker;
    this.ball.body.position.set(taker.pos.x + taker.attackDir * 0.35, BALL.radius, 0);
    if (team === 0) this.controlled = taker;
    else this.controlled = this.forward(0);
  }

  update(dt: number, cmd: UserCommand): void {
    this.elapsed += dt;
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
      case 'out':
      case 'setpiece': {
        // 경기 시간은 공이 나가 있을 때도 흐른다
        this.clock += dt;
        this.halfClock += dt;
        if (this.phase === 'playing') this.updatePlaying(dt, cmd);
        else this.setPieces.update(dt, cmd);
        if (!this.stoppage && this.halfClock >= this.halfLength) {
          this.stoppage = this.rules.stoppageMinutes(this.half);
          this.events.push({ type: 'stoppage', minutes: this.stoppage });
        }
        // 추가 시간이 끝나도 슛이 날아가는 중이면 결과를 본다
        const end = this.halfLength * (1 + this.stoppage / 45);
        if (this.stoppage && this.halfClock >= end && this.phase === 'playing' && !this.ball.shot) this.endHalf();
        break;
      }
      case 'halftime':
        for (const p of this.players) {
          p.steer(tmp.set(0, 0, 0), false, false, dt);
          p.update(dt);
        }
        this.stepWorld(dt);
        if (this.phaseTimer <= 0) this.startSecondHalf();
        break;
      case 'shootout':
        this.shootout.update(dt, cmd);
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
        this.stepWorld(dt);
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
        this.stepWorld(dt);
        break;
    }

    for (const g of this.goals) g.update(dt);
  }

  private endHalf(): void {
    this.charge = null;
    this.queued = null;
    this.rules.clearPlay();
    if (this.half === 1) {
      this.phase = 'halftime';
      this.phaseTimer = MATCH.halftimeDelay;
      this.events.push({ type: 'whistle', kind: 'halftime' });
      return;
    }
    this.events.push({ type: 'whistle', kind: 'fulltime' });
    const shootout = this.options.shootout ?? settings.shootout;
    if (shootout && this.score[0] === this.score[1]) {
      this.shootout.start();
      return;
    }
    this.finish();
  }

  /** 경기 종료 (승부차기 후 포함) */
  finish(): void {
    this.phase = 'fulltime';
    this.phaseTimer = 999;
    const [a, b] = this.shootout.active ? this.shootout.score : this.score;
    for (const p of this.players) {
      p.basePose = null;
      if ((p.team === 0 ? a > b : b > a)) p.basePose = 'celebrate';
    }
  }

  /** 후반: 진영을 바꾸고 전반에 받은 팀이 킥오프 */
  startSecondHalf(): void {
    this.half = 2;
    this.halfClock = 0;
    this.stoppage = 0;
    this.rules.newHalf();
    this.setSides(-1);
    this.startKickoff(1);
  }

  /** 홈팀 공격 방향 (+1 = +X). 원정팀은 반대 */
  private setSides(home: 1 | -1): void {
    for (const p of this.roster) p.attackDir = (p.team === 0 ? home : -home) as 1 | -1;
  }

  /** 퇴장: 경기에서 빼고 화면에서도 숨긴다 */
  sendOff(p: Player): void {
    p.sentOff = true;
    const remove = (list: Player[]) => {
      const i = list.indexOf(p);
      if (i >= 0) list.splice(i, 1);
    };
    remove(this.players);
    remove(this.teams[p.team]);
    p.model.root.visible = false;
    p.vel.set(0, 0, 0);
    if (this.ball.owner === p) this.ball.owner = null;
    if (this.passTarget === p) this.passTarget = null;
    if (this.controlled === p) this.switchToNearest();
  }

  private updatePlaying(dt: number, cmd: UserCommand): void {
    const holder = this.ball.owner ?? this.ball.lastTouch;
    if (holder) this.stats.possession[holder.team] += dt;
    // W는 상대 공격 중에만 키퍼 지시다. 공격 스루/로빙 스루 입력은 그대로 둔다.
    const defending = this.ball.owner ? this.ball.owner.team === 1 : this.ball.lastTouch?.team === 1;
    this.keeperRush = this.options.userControl !== false && defending && cmd.through.held;
    if (this.isUserControlled(this.controlled)) this.handleUser(dt, cmd);
    this.ai.update(dt);
    this.keepers.update(dt);

    for (const p of this.players) p.update(dt);
    this.separatePlayers();
    this.resolveTackles();
    if (this.phase !== 'playing') return; // 반칙 휘슬
    this.rules.update(dt);
    if (this.phase !== 'playing') return; // 어드밴티지 무효 → 프리킥
    this.carryBall(dt);
    this.stepWorld(dt);
    this.deflectOffBodies();
    this.checkAerial();
    if (this.phase !== 'playing') return; // 오프사이드
    this.checkPossession();
    if (this.phase !== 'playing') return;
    this.checkGoal();
    if (this.phase === 'playing') this.setPieces.checkOut();
  }

  // ---------------------------------------------------------------- 공중볼 (헤더 · 발리)

  /** 공이 내려오며 높이 h를 지나는 지점 (공기 저항 무시한 근사). 이미 낮으면 null */
  predictBallAt(h: number): THREE.Vector3 | null {
    const b = this.ball.position, v = this.ball.velocity;
    const g = -this.physics.world.gravity.y;
    // y + vy t - g t²/2 = h 의 큰 근
    const disc = v.y * v.y + 2 * g * (b.y - h);
    if (disc < 0) return null;
    const t = (v.y + Math.sqrt(disc)) / g;
    if (t <= 0) return null;
    return new THREE.Vector3(b.x + v.x * t, h, b.z + v.z * t);
  }

  /** 공이 이 선수 쪽으로 오고 있는지 (원터치 예약 허용 판단) */
  ballComingTo(p: Player): boolean {
    const b = this.ball.position, v = this.ball.velocity;
    const sp = Math.hypot(v.x, v.z);
    if (sp < 3) return false;
    const dx = p.pos.x - b.x, dz = p.pos.z - b.z;
    const along = (dx * v.x + dz * v.z) / sp;
    if (along < 0 || along > 25) return false;
    const perp = Math.abs(dx * v.z - dz * v.x) / sp;
    return perp < 3;
  }

  /**
   * 머리~가슴 높이의 공을 처리한다. 경합이면 점프·헤더·몸싸움 능력치로 승자를 정한다.
   *  - 사용자: 미리 누른 키에 따라 헤더/발리 슛·패스, 아무것도 안 눌렀으면 가슴 트래핑
   *  - AI: 상대 골대 근처면 헤더 슛, 자기 진영이면 걷어내기, 그 외에는 트래핑
   */
  private aerialLock = 0;

  private checkAerial(): void {
    // 경합은 한 번에 한 명만 이긴다: 방금 머리/발로 건드린 공은 잠깐 다른 선수가 다시 건드리지 못한다
    if (this.aerialLock > 0) {
      this.aerialLock -= PHYSICS.step;
      return;
    }
    if (this.ball.owner) return;
    const bp = this.ball.position;
    if (bp.y < 0.95 || bp.y > 2.9) return;
    let best: Player | null = null;
    let bestScore = -Infinity;
    for (const p of this.players) {
      if (p.busy || p.kickCooldown > 0) continue;
      if (p.isKeeper && this.inOwnBox(p, bp.x, bp.z)) {
// 높은 공의 캐치/펀칭은 거리·혼잡도를 보는 키퍼 판단에서 처리한다.
        continue;
      }
      const st = p.profile.stats;
      const reachH = 1.95 + 0.55 * n(st.jumping);
      if (bp.y > reachH) continue;
      const d = Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z);
      if (d > 1.0) continue;
      const score = (1.0 - d) + 0.4 * n(st.jumping) + 0.3 * n(st.heading) + 0.2 * n(st.strength) + this.random.next() * 0.25;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) this.aerialTouch(best);
  }

  private aerialTouch(p: Player): void {
    this.aerialLock = 0.3;
    if (this.rules.touch(p)) return;
    const bp = this.ball.position;
    const volley = bp.y < 1.35;
    const assist = this.assistFor(p, 'shot');
    const goalDist = Math.hypot(this.oppGoalX(p.team) - p.pos.x, p.pos.z);
    const ownHalf = p.pos.x * p.attackDir < -8;
    const q = this.isUserControlled(p) ? this.queued : null;
    let mode: 'shot' | 'pass' | 'clear' | 'control';

    if (q) {
      mode = q.kind === 'shoot' ? 'shot' : 'pass';
      this.queued = null;
    } else if (this.isUserControlled(p)) {
      mode = 'control';
    } else if (goalDist < 16 && !ownHalf) {
      mode = 'shot';
    } else if (ownHalf && (this.ball.lastTouch?.team !== p.team || p.role === 'DEF')) {
      mode = 'clear';
    } else {
      mode = 'control';
    }

    if (mode === 'control') {
      // 가슴/머리 트래핑: 공을 발 앞에 떨군다 (볼 컨트롤이 좋을수록 부드럽게)
      const soft = n(p.profile.stats.ballControl);
      cv.set(p.facing.x * (1.2 + (1 - soft) * 2.5) + p.vel.x * 0.6, -1, p.facing.z * (1.2 + (1 - soft) * 2.5) + p.vel.z * 0.6);
      this.ball.kick(cv, cspin.set(0, 0, 0), p);
      this.ball.shot = null;
      this.passTarget = p;
      p.kickCooldown = 0.12; // 같은 공을 매 스텝 다시 트래핑하지 않게
      if (!volley) p.playAction('header', 0.35);
      return;
    }

    let r: KickResult;
    if (volley) {
      r =
        mode === 'shot'
          ? this.kicks.volley(p, q?.value ?? 0.55, this.lastMove, assist)
          : this.kicks.pass(p, this.lastMove.lengthSq() > 0.01 ? this.lastMove : p.facing, 'short', q?.value ?? 0.5, this.assistFor(p, 'pass'));
      this.kickBall(p, r.vel, r.spin);
    } else {
      const aim = this.isUserControlled(p) ? this.lastMove : new THREE.Vector3();
      r = this.kicks.header(p, mode, aim, this.assistFor(p, mode === 'pass' ? 'pass' : 'shot'));
      p.facing.set(r.vel.x, 0, r.vel.z).normalize();
      p.playAction('header', 0.5);
      if (mode !== 'clear') this.rules.recordKick(p);
      this.ball.kick(r.vel, r.spin, p);
      p.kickCooldown = PLAYER.kickCooldown;
      this.events.push({ type: 'kick', speed: r.vel.length() * 0.6 });
    }
    if (mode === 'shot') {
      this.ball.newShot(p);
      this.stats.shots[p.team]++;
      this.passTarget = null;
    } else {
      this.ball.shot = null;
      this.passTarget = r.receiver;
      if (mode === 'pass') {
        this.stats.passes[p.team]++;
        this.pendingPass = p.team;
        if (r.receiver && p.team === 0 && !r.receiver.isKeeper) {
      this.controlled = r.receiver;
      this.receiveTimer = 0;
    }
      }
    }
  }

  /** 물리 월드 진행 (세트피스 모듈용) */
  stepWorld(dt: number): void {
    this.keepers.syncBodies(dt);
    this.physics.step(dt);
  }

  /** 스로인 적용 */
  applyThrow(p: Player, vel: CANNON.Vec3, receiver: Player | null): void {
    p.playAction('hold', 0.35);
    this.rules.recordKick(p);
    this.rules.recordPass(p);
    this.ball.kick(vel, cspin.set(0, 0, 0), p);
    this.events.push({ type: 'kick', speed: vel.length() * 0.5 });
    this.ball.shot = null;
    this.passTarget = receiver;
    this.stats.passes[p.team]++;
    this.pendingPass = p.team;
    if (receiver && p.team === 0 && !receiver.isKeeper) {
      this.controlled = receiver;
      this.receiveTimer = 0;
    }
  }

  // ---------------------------------------------------------------- 사용자 조작

  /** 터치 라벨과 경기 판정이 같은 공격/수비 경계를 사용한다. */
  get userAttacking(): boolean {
    const p = this.controlled, owner = this.ball.owner, bp = this.ball.position;
    const incoming = !owner && (this.passTarget === p || this.ballComingTo(p));
    return owner === p || (!owner && (Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z) < 4.5 || incoming));
  }

  cancelUserCharge(): void {
    this.charge = null;
    this.queued = null;
  }

  private handleUser(dt: number, cmd: UserCommand): void {
    const p = this.controlled;
    const owner = this.ball.owner;
    const hasBall = owner === p;
    const teamHasBall = owner?.team === p.team;
    const oppHasBall = !!owner && owner.team !== p.team;
    const bp = this.ball.position;
    const attacking = this.userAttacking;

    // S (수비 시) = 선수 변경
    if (cmd.pass.pressed && !attacking && !teamHasBall) this.switchToNearest();

    const move = cmd.move.clone();
    let autoSprint = false;
    // 패스 받기 보조 (FIFA식):
    //  - 전환 직후 잠깐은 AI가 받으러 가는 움직임 유지 (자동 전환 이동 보조)
    //  - 그 뒤에도 방향키가 공 쪽을 향하면 '가로챌 지점'으로 가서 그 앞에서 감속 → 공을 지나치지 않음
    //  - 입력이 없으면 계속 자동으로 받으러 감. 공에서 멀어지는 방향을 누르면 그때부터 완전 수동
    this.receiveTimer += dt;
    if (this.passTarget === p && !owner) {
      const ip = this.interceptPoint(p);
      tmp.set(ip.x - p.pos.x, 0, ip.z - p.pos.z);
      const dd = tmp.length();
      const hasInput = move.lengthSq() > 0.01;
      const towardBall = hasInput && dd > 0.3 && move.clone().normalize().dot(tmp.clone().normalize()) > 0.35;
      if (!hasInput || towardBall || this.receiveTimer < MOVE_ASSIST_TIME[settings.moveAssist]) {
        move.copy(dd > 0.25 ? tmp.normalize().multiplyScalar(Math.min(1, dd / 1.8)) : tmp.set(0, 0, 0));
        autoSprint = dd > 4 && (cmd.sprint || bp.y > 1.2);
        if (dd < 2) p.faceTowards(bp.x, bp.z);
      }
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
    if (!p.busy) p.steer(move, cmd.sprint || autoSprint, hasBall, dt, speedScale);
    // 압박/견제 중에는 상대를 바라본다 (뒷걸음질)
    if ((pressing || containing) && !p.busy) {
      const d = owner!.pos.distanceTo(p.pos);
      if (d < 4) p.faceTowards(owner!.pos.x, owner!.pos.z);
    }

    // 파워 게이지: D 슛 / S 패스 / W 스루 / A 로빙. Z = 감아차기, Q = 칩슛 / 로빙 스루
    if (attacking && !this.charge) {
      for (const kind of KICK_KINDS) {
        if (cmd[kind].pressed && !(kind === 'through' && this.keeperRush)) {
          this.charge = { kind, value: 0, finesse: cmd.finesse.held, chip: cmd.modifier.held };
          break;
        }
      }
    }
    if (this.charge) {
      const c = this.charge;
      // 패스를 누른 채 스루/로빙이 함께 눌리면 그 킥으로 바꾼다 (터치 스와이프)
      if (c.kind === 'pass') for (const k of ['through', 'lob'] as const) if (cmd[k].held) c.kind = k;
      const btn = cmd[c.kind];
      c.value = Math.min(1, c.value + dt / (c.kind === 'shoot' ? SHOT.chargeTime : PASS.chargeTime));
      if (cmd.finesse.held) c.finesse = true;
      if (cmd.modifier.held) c.chip = true;
      if (oppHasBall) {
        this.charge = null; // 차는 도중 공을 뺏김
      } else if (btn.released || !btn.held) {
        if (this.ball.owner === p) this.execute(p, c.kind, c.value, c.finesse, c.chip, cmd.move);
        else this.queued = { kind: c.kind, value: c.value, finesse: c.finesse, chip: c.chip, ttl: bp.y > 1 ? 1.4 : 0.7 };
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
  /** 패스로 조작 선수가 바뀐 뒤 지난 시간 (자동 전환 이동 보조용) */
  private receiveTimer = 0;

  /**
   * 선수가 공을 가로챌 수 있는 가장 이른 지점.
   * 공의 진행 경로(공중볼이면 떨어지는 지점부터)를 따라가며 선수가 먼저 도착할 수 있는 곳을 찾는다.
   */
  interceptPoint(p: Player): THREE.Vector3 {
    const b = this.ball.position, v = this.ball.velocity;
    let sx = b.x, sz = b.z, t0 = 0;
    if (b.y > 1.2) {
      const land = this.predictBallAt(1.0);
      if (land) {
        const sp = Math.hypot(v.x, v.z) || 1;
        t0 = Math.hypot(land.x - b.x, land.z - b.z) / sp;
        sx = land.x;
        sz = land.z;
      }
    }
    const speed = p.maxSpeed(false) * 0.9;
    let vx = v.x, vz = v.z;
    let x = sx, z = sz;
    for (let t = 0; t < 3; t += 0.05) {
      const reach = Math.hypot(x - p.pos.x, z - p.pos.z) / speed + 0.12;
      if (reach <= t + t0) return new THREE.Vector3(x, 0, z);
      // 구름 저항 근사
      const h = Math.hypot(vx, vz);
      const P = activePhysics();
      const decel = Math.max(0, 1 - ((P.rollDecel + P.rollDamping * h) * 0.05) / Math.max(h, 0.01));
      vx *= decel;
      vz *= decel;
      x += vx * 0.05;
      z += vz * 0.05;
    }
    return new THREE.Vector3(x, 0, z);
  }
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
    this.rules.recordPass(p);
    this.ball.shot = null;
    this.passTarget = r.receiver;
    this.stats.passes[p.team]++;
    this.pendingPass = p.team;
    if (r.receiver && p.team === 0 && !r.receiver.isKeeper) {
      this.controlled = r.receiver;
      this.receiveTimer = 0;
    }
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
    this.rules.recordKick(p);
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
        const success = this.random.next() < chance;
        p.tackleResolved = true;
        p.tackleTimer = Math.min(p.tackleTimer, 0.08);
        this.events.push({ type: 'tackle', success });
        const foul = this.rules.judgeTackle(p, o, success, o.facing.dot(p.tackleDir));
        if (foul) {
          o.stunned = 0.55;
          o.basePose = null;
          if (o.team === 0) this.charge = null;
          this.rules.call(foul, !success);
          if (this.phase !== 'playing') return;
          continue;
        }
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
            cv.set(p.tackleDir.x * 5 + this.random.gauss(), 0.6, p.tackleDir.z * 5 + this.random.gauss());
            this.ball.kick(cv, cspin.set(0, 0, 0), p);
            p.kickCooldown = 0.12;
          }
        } else {
          p.kickCooldown = p.tackleKind === 'stand' ? 0.25 : 0.4;
        }
      } else if (!o) {
        // 굴러가는 공을 태클로 걷어냄
        if (this.rules.touch(p)) return;
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
      const keeperHands = p.isKeeper && this.inOwnBox(p, bp.x, bp.z) && this.rules.keeperMayHandle(p);
      if (keeperHands) {
        if (p.busy || bp.y > 0.95) continue;
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
      // 패스 받는 선수는 받으러 몸을 내밀어 범위가 넓다
      const receiving = this.passTarget === p ? 0.35 : 0;
      const radius =
        PLAYER.controlRadius - 0.06 + 0.14 * n(st.reactions) + receiving + (intercepting ? 0.3 * n(st.interceptions) : 0);
      if (d > radius) continue;
      // 너무 빠른 공은 트래핑 실패 (몸에 맞고 튕김)
      const rel = Math.hypot(bv.x - p.vel.x, bv.z - p.vel.z);
      if (rel > 13 + 9 * n(st.ballControl) + (receiving ? 4 : 0)) continue;
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    if (!best) return;
    // 볼 컨트롤이 낮으면 빠른 공을 받을 때 터치가 길어진다 (헤비 터치)
    const rel = Math.hypot(bv.x - best.vel.x, bv.z - best.vel.z);
    if (!best.isKeeper && rel > 9 && this.random.next() < (1 - n(best.profile.stats.ballControl)) * 0.7) {
      const push = 2.5 + rel * 0.15;
      cv.set(best.facing.x * push + bv.x * 0.15, 0.3, best.facing.z * push + bv.z * 0.15);
      this.ball.kick(cv, cspin.set(0, 0, 0), best);
      this.ball.shot = null;
      best.kickCooldown = 0.22;
      return;
    }
    this.gainPossession(best);
  }

  gainPossession(best: Player): void {
    const bp = this.ball.position;
    // 백패스는 발로만 받는다 (판정 전에 확인: touch가 백패스 상태를 지운다)
    const hands = best.isKeeper && this.rules.keeperMayHandle(best);
    if (this.rules.touch(best)) return;
    this.ball.owner = best;
    this.ball.lastTouch = best;
    this.ball.shot = null;
    this.passTarget = null;
    if (this.pendingPass !== null) {
      if (best.team === this.pendingPass) this.stats.passesDone[best.team]++;
      this.pendingPass = null;
    }
    if (best.team === 0 && !best.isKeeper) this.controlled = best;
    // 방향 첫 터치: 받는 순간 누르고 있던 방향으로 공을 잡아 놓는다
    if (best === this.controlled && this.lastMove.lengthSq() > 0.01) best.facing.copy(this.lastMove).setY(0).normalize();
    if (best.isKeeper) {
      this.keepers.onCatch(best);
      if (hands && this.inOwnBox(best, bp.x, bp.z)) {
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
      if (p.isKeeper || p.kickCooldown > 0) continue;
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
    // 공이 들어간 골대 쪽으로 공격하는 팀의 득점 (후반에는 진영이 바뀐다)
    const team: 0 | 1 = Math.sign(bp.x) === this.teams[0][0].attackDir ? 0 : 1;
    this.rules.addStoppage(0.5);
    this.rules.clearPlay();
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
      this.lastScorer = this.forward(team);
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
    this.elapsed = 0;
    this.lastScorer = null;
    this.half = 1;
    this.halfClock = 0;
    this.stoppage = 0;
    this.rules.reset();
    this.shootout.reset();
    // 퇴장 선수 복귀
    this.players.length = 0;
    this.players.push(...this.roster);
    for (const team of [0, 1] as const) {
      this.teams[team].length = 0;
      this.teams[team].push(...this.roster.filter((p) => p.team === team));
    }
    for (const p of this.roster) {
      p.stamina = 1;
      p.yellows = 0;
      p.sentOff = false;
      p.model.root.visible = true;
    }
    this.setSides(1);
    this.startKickoff(0);
  }
}
