import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BALL, COMMAND, DRIBBLE, GOAL, INPUT, KEEPER, MATCH, PASS, PHYSICS, PITCH, PLAYER, SHOT } from '../config';
import { Ball } from '../entities/Ball';
import { Goal } from '../entities/Goal';
import { Random, visualRandom } from '../core/Random';
import { Player, type PlayerModelFactory } from '../entities/Player';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { TeamAI } from '../ai/TeamAI';
import { Kicks, type KickResult, type PassKind } from './Kicks';
import { MOVE_ASSIST_TIME, settings, type AssistLevel, type MoveAssist } from '../core/Settings';
import { n } from '../data/Stats';
import { activePhysics } from '../physics/presets';
import type { ButtonState } from '../core/Input';
import { TEAMS } from '../data/Teams';
import { FORMATION_433 } from '../data/Formation';
import { SetPieces, type RestartKind } from './SetPieces';
import { Keepers } from './Keepers';
import { selectMotion } from '../anim/MotionLibrary';
import { MOTION_CATALOG } from '../data/MotionCatalog';
import { SkillInput, SkillRunner, SKILLS, type SkillDef } from './Skills';
import { Rules, type Card } from './Rules';
import { Shootout } from './Shootout';
import { Officials } from './Officials';
import { planKick, speedClass } from './Motions';
import type { MotionKind } from '../anim/MotionLibrary';

export type Phase = 'kickoff' | 'playing' | 'out' | 'setpiece' | 'goal' | 'halftime' | 'shootout' | 'fulltime';
export type PracticeOpponent = 'stand' | 'follow' | 'press' | 'tackle';

export type MatchEvent =
  | { type: 'kick'; speed: number; player: Player; kind?: string; receiver?: Player | null; velocity?: number[]; spin?: number[]; target?: number[]; origin?: number[]; aimOrigin?: number[]; receiverPosition?: number[]; timed?: boolean; flair?: boolean }
  | { type: 'contact'; kind: 'hold' | 'push' | 'shoulder'; success: boolean; player: Player; opponent: Player; duration: number }
  | { type: 'touch'; speed: number; player: Player }
  | { type: 'heavyTouch'; player: Player }
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
  | { type: 'skill'; id: string; player: Player }
  | { type: 'out'; kind: RestartKind; team: 0 | 1 }
  | { type: 'restart'; kind: RestartKind; team: 0 | 1 };

interface UserKick {
  kind: KickKind; value: number; finesse: boolean; chip: boolean;
  flair?: boolean; power?: boolean; keyboard?: boolean; started?: number; double?: boolean;
}

export type KickKind = 'shoot' | 'pass' | 'through' | 'lob';
const KICK_KINDS: KickKind[] = ['shoot', 'pass', 'through', 'lob'];

/** 사용자 입력을 월드 좌표로 변환한 명령 */
export interface UserCommand {
  move: THREE.Vector3; // XZ, 크기 0..1
  sprint: boolean;
  power?: ButtonState; // F
  keyboardKick?: boolean;
  shoot: ButtonState; // D
  pass: ButtonState; // S
  through: ButtonState; // W
  lob: ButtonState; // A
  modifier: ButtonState; // Q
  finesse: ButtonState; // Z
  contain: ButtonState; // C
  /** Shift: 개인기 (없으면 개인기 커맨드를 받지 않는다) */
  skill?: ButtonState;
  /** 개인기 커맨드용 방향 (보조키 전부터 누르던 방향키 제외). 없으면 move */
  skillMove?: THREE.Vector3;
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


/** 한 팀(사람)의 보정 설정 */
export interface TeamAssist { pass: AssistLevel; shot: AssistLevel; move: MoveAssist }

export interface MatchOptions {
  /** 팀별 보정 설정 (온라인: 각자 자기 설정). 없으면 팀 0만 로컬 설정, 팀 1은 보조 */
  assists?: [TeamAssist, TeamAssist];
  /** 이 화면에서 조작하는 팀 (온라인에서 팀 1일 수 있다). HUD·카메라·Match의 조작 필드가 이 팀을 가리킨다 */
  localTeam?: 0 | 1;
  /** 사람이 조작하는 팀 [팀0, 팀1]. 없으면 userControl(기본 켜짐)로 팀 0만 */
  userTeams?: [boolean, boolean];
  /** 실제 킥오프 규칙(첫 패스 전 드리블 금지, 상대 서클 밖). 기본 켜짐, 드리블 단위 테스트는 끈다 */
  kickoffPass?: boolean;
  /** 고립된 개발 시나리오. 아웃·휘슬 뒤 재개 배치 없이 R 리셋을 기다린다. */
  practice?: boolean;
  random?: Random;
  createPlayerModel?: PlayerModelFactory;
  /** Node 시뮬레이션에서는 골망 정점 갱신을 생략하되 충돌체는 그대로 둔다. */
  goalVisuals?: boolean;
  /** AI 대 AI 검증에서도 실제 경기 루프를 그대로 사용한다. */
  userControl?: boolean;
  /** 무승부면 승부차기 (기본: 설정값) */
  shootout?: boolean;
  /**
   * 킥 동작: 버튼을 뗀 뒤 동작에 맞춰 몸 방향을 정하고 발이 닿는 순간에 공이 나간다 (기본 켜짐).
   * 끄면 예전처럼 즉시 찬다 (기존 물리·조작 테스트용)
   */
  kickMotion?: boolean;
  /** 터치 드리블 (기본 켜짐). 끄면 공이 발 앞에 붙어 다닌다 */
  dribbleTouches?: boolean;
}


/**
 * 한 팀을 사람이 조작할 때 필요한 상태. 멀티플레이에서는 두 팀이 각각 하나씩 가진다.
 * Match의 같은 이름 필드는 지금 처리 중인 팀(side)의 값을 가리킨다.
 */
const btn = (): ButtonState => ({ held: false, pressed: false, released: false });
/** 입력 없음 */
export const IDLE_COMMAND: UserCommand = { move: new THREE.Vector3(), sprint: false, shoot: btn(), pass: btn(), through: btn(), lob: btn(), modifier: btn(), finesse: btn(), contain: btn(), tackle: btn() };

export class UserSide {
  /** 사람이 이 팀을 조작 중인지 */
  active = false;
  controlled!: Player;
  charge: UserKick | null = null;
  pendingUserKick: { player: Player; kick: UserKick; move: THREE.Vector3 } | null = null;
  powerTiming: { player: Player; kick: UserKick; move: THREE.Vector3; elapsed: number; timed: boolean; tapped: boolean } | null = null;
  holding: Player | null = null;
  holdTime = 0;
  holdJudge = 0;
  /** 공이 오기 전에 미리 입력한 원터치 동작 */
  queued: (UserKick & { ttl: number }) | null = null;
  readonly skillInput = new SkillInput();
  readonly skillInputHeld = new SkillInput(true);
  readonly lastMove = new THREE.Vector3();
  /** Shift를 누르기 직전의 이동 방향 (개인기 커맨드 입력 중 유지) */
  readonly skillHeldMove = new THREE.Vector3();
  switchAimHeld = false;
  /** 녹온 뒤 공을 쫓는 동안 (소유 상실 거리를 늘린다) */
  knockTimer = 0;
  /** 앞 개인기가 끝나면 이어서 낼 개인기 */
  skillBuffer: { def: SkillDef; ttl: number } | null = null;
  prevSprint = false;
  sprintTaps = 0;
  lastSprintTap = -9;
  shiftDownAt = -9;
  /** 패스로 조작 선수가 바뀐 뒤 지난 시간 (자동 전환 이동 보조용) */
  receiveTimer = 0;
  /** Q 꾹: 가장 가까운 AI 동료가 공 소유자를 압박 */
  teammatePress = false;
  /** W (상대 공격 중): 키퍼 돌진 */
  keeperRush = false;
  /** 공을 가진 채 손을 뗐다: 앞으로 치지 않고 발로 세운다 */
  trapping = false;

  constructor(readonly team: 0 | 1) {}
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
  readonly skills: SkillRunner;
  readonly shootout: Shootout;
  readonly officials: Officials;
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
  /** 고립 연습에만 적용한다. 일반 경기 AI의 의사결정은 그대로 둔다. */
  practiceOpponent: PracticeOpponent | null = null;
  practiceControlLocked = false;
  /** 슛/패스 파워 게이지 (0..1), 차지 중이 아니면 null */
  /** 공이 오기 전에 미리 입력한 원터치 동작 */
  /** 팀별 사람 조작 상태 (멀티플레이: 두 팀 모두 사람일 수 있다). [0]이 이 화면의 기본 조작 팀 */
  readonly sides: [UserSide, UserSide] = [new UserSide(0), new UserSide(1)];
  get localTeam(): 0 | 1 { return this.options.localTeam ?? 0; }
  /** 이 화면 사람의 조작 상태 (HUD·카메라용). 경기 계산은 항상 팀을 명시하거나 sides[0] 기준이라 화면마다 같다 */
  get local(): UserSide { return this.sides[this.localTeam]; }
  /** 지금 처리 중인 조작 팀. handleUser 밖에서는 항상 팀 0 — 화면(팀)마다 다르면 경기가 갈라진다. 화면 표시는 local */
  private side: UserSide;
  get skillInput(): UserSide['skillInput'] { return this.side.skillInput; }
  get skillInputHeld(): UserSide['skillInputHeld'] { return this.side.skillInputHeld; }
  get keeperRush(): UserSide['keeperRush'] { return this.side.keeperRush; }
  set keeperRush(v: UserSide['keeperRush']) { this.side.keeperRush = v; }
  get controlled(): UserSide['controlled'] { return this.side.controlled; }
  set controlled(v: UserSide['controlled']) { this.side.controlled = v; }
  get charge(): UserSide['charge'] { return this.side.charge; }
  set charge(v: UserSide['charge']) { this.side.charge = v; }
  get pendingUserKick(): UserSide['pendingUserKick'] { return this.side.pendingUserKick; }
  set pendingUserKick(v: UserSide['pendingUserKick']) { this.side.pendingUserKick = v; }
  get powerTiming(): UserSide['powerTiming'] { return this.side.powerTiming; }
  set powerTiming(v: UserSide['powerTiming']) { this.side.powerTiming = v; }
  get holding(): UserSide['holding'] { return this.side.holding; }
  set holding(v: UserSide['holding']) { this.side.holding = v; }
  get holdTime(): UserSide['holdTime'] { return this.side.holdTime; }
  set holdTime(v: UserSide['holdTime']) { this.side.holdTime = v; }
  get holdJudge(): UserSide['holdJudge'] { return this.side.holdJudge; }
  set holdJudge(v: UserSide['holdJudge']) { this.side.holdJudge = v; }
  get queued(): UserSide['queued'] { return this.side.queued; }
  set queued(v: UserSide['queued']) { this.side.queued = v; }
  get lastMove(): UserSide['lastMove'] { return this.side.lastMove; }
  get switchAimHeld(): UserSide['switchAimHeld'] { return this.side.switchAimHeld; }
  set switchAimHeld(v: UserSide['switchAimHeld']) { this.side.switchAimHeld = v; }
  get knockTimer(): UserSide['knockTimer'] { return this.side.knockTimer; }
  get skillBuffer(): UserSide['skillBuffer'] { return this.side.skillBuffer; }
  set skillBuffer(v: UserSide['skillBuffer']) { this.side.skillBuffer = v; }
  set knockTimer(v: UserSide['knockTimer']) { this.side.knockTimer = v; }
  get prevSprint(): UserSide['prevSprint'] { return this.side.prevSprint; }
  set prevSprint(v: UserSide['prevSprint']) { this.side.prevSprint = v; }
  get sprintTaps(): UserSide['sprintTaps'] { return this.side.sprintTaps; }
  set sprintTaps(v: UserSide['sprintTaps']) { this.side.sprintTaps = v; }
  get lastSprintTap(): UserSide['lastSprintTap'] { return this.side.lastSprintTap; }
  set lastSprintTap(v: UserSide['lastSprintTap']) { this.side.lastSprintTap = v; }
  get shiftDownAt(): UserSide['shiftDownAt'] { return this.side.shiftDownAt; }
  set shiftDownAt(v: UserSide['shiftDownAt']) { this.side.shiftDownAt = v; }
  get skillHeldMove(): UserSide['skillHeldMove'] { return this.side.skillHeldMove; }
  get receiveTimer(): UserSide['receiveTimer'] { return this.side.receiveTimer; }
  set receiveTimer(v: UserSide['receiveTimer']) { this.side.receiveTimer = v; }
  get teammatePress(): UserSide['teammatePress'] { return this.side.teammatePress; }
  set teammatePress(v: UserSide['teammatePress']) { this.side.teammatePress = v; }
  stats: MatchStats = emptyStats();
  duration: number = MATCH.durationSeconds;
  private pendingPass: 0 | 1 | null = null;
  private dinkFlight = false;
  passTarget: Player | null = null;
  lastScorer: Player | null = null;
  private kickoffTeam: 0 | 1 = 0;
  /** 킥 동작 중 공이 발에 닿기까지 남은 시간과 그때 실행할 킥 */
  private readonly windups = new Map<Player, { timer: number; run: () => void }>();
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
    this.side = this.sides[0];
    this.sides[0].active = this.options.userTeams?.[0] ?? this.options.userControl !== false;
    this.sides[1].active = this.options.userTeams?.[1] ?? false;
    for (const side of this.sides) side.controlled = this.forward(side.team);
    this.ai = new TeamAI(this, options.dribbleTouches !== false);
    this.kicks = new Kicks(this);
    this.setPieces = new SetPieces(this);
    this.keepers = new Keepers(this, physics);
    this.rules = new Rules(this);
    this.skills = new SkillRunner(this);
    this.shootout = new Shootout(this);
    this.officials = new Officials(this, options.createPlayerModel);
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
    return -(this.teams[team][0] ?? this.roster.find((p) => p.team === team)!).attackDir * PITCH.halfL;
  }

  get userControl(): boolean {
    return this.options.userControl !== false;
  }

  get practice(): boolean { return this.options.practice === true; }

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
    const side = this.sides[p.team];
    return side.active && p === side.controlled && this.phase !== 'goal' && this.phase !== 'fulltime' &&
      this.phase !== 'halftime' && this.phase !== 'shootout';
  }

  inOwnBox(p: Player, x: number, z: number): boolean {
    const gx = this.ownGoalX(p.team);
    return Math.abs(x - gx) < PITCH.boxDepth && Math.abs(z) < PITCH.boxWidth / 2 && Math.sign(x) === Math.sign(gx);
  }

  /**
   * 감아차기는 주발로: 공이 약발 쪽에 있고 약발이 3 이하면 한 발 맞춰 공을 주발 쪽으로 옮겨 찬다
   * (휘는 방향이 차는 발로 정해지므로 오른발잡이는 늘 왼쪽으로 감기는 슛을 쓴다). 약발 4~5는 그대로 약발로 찬다.
   */
  private preferStrongFoot(p: Player): void {
    const foot = this.kicks.footFactor(p);
    if (!foot.weak || p.profile.weakFoot > 3) return;
    const b = this.ball.body.position;
    const rx = -p.facing.z, rz = p.facing.x; // 몸 오른쪽
    const side = (b.x - p.pos.x) * rx + (b.z - p.pos.z) * rz;
    const shift = -2 * side + (side >= 0 ? -0.12 : 0.12);
    b.x += rx * shift;
    b.z += rz * shift;
  }

  /** 발 위치 (공을 다루는 기준점) */
  footPoint(p: Player, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(p.pos).addScaledVector(p.facing, 0.35);
  }

  // ---------------------------------------------------------------- 진행

  startKickoff(team: 0 | 1): void {
    this.resetSides();
    this.keepers.reset();
    this.kickoffTeam = team;
    this.phase = 'kickoff';
    this.phaseTimer = MATCH.kickoffDelay;
    this.ball.reset(0, 0);
    this.skills.clear();
    this.passTarget = null;
    this.setPieces.current = null;
    this.rules.clearPlay();
    this.windups?.clear();
    this.officials?.reset();
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
      else if (p === this.kickoffPartner(team)) p.pos.set(-a * 0.4, 0, 1.6);
      else p.pos.set(a * Math.min(slot.fx, -PITCH.centerCircle - 1), 0, slot.z * a);
      p.facing.set(a, 0, 0);
    }
    const taker = this.forward(team);
    // 실제 킥오프: 공 옆 2명, 첫 패스(또는 슛)로 시작. 그 전에는 드리블 금지·상대는 센터 서클 밖
    this.kickoffTaker = this.options.kickoffPass === false ? null : taker;
    this.kickoffClock = 0;
    this.ball.owner = taker;
    this.ball.lastTouch = taker;
    this.ball.body.position.set(taker.pos.x + taker.attackDir * 0.35, BALL.radius, 0);
    for (const side of this.sides) side.controlled = side.team === team ? taker : this.forward(side.team);
  }

  /** 킥오프를 차기 전인 선수 (첫 킥 전까지 드리블 못 함). null이면 진행 중 */
  kickoffTaker: Player | null = null;
  private kickoffClock = 0;

  /** 킥오프 때 공 옆에 서는 두 번째 선수: 공격수 다음으로 앞에 있는 필드 선수 */
  kickoffPartner(team: 0 | 1): Player {
    const f = this.forward(team);
    return this.teams[team].filter((p) => p !== f && !p.isKeeper).sort((x, y) => y.slot.fx - x.slot.fx)[0];
  }

  /** 킥오프 전: 차는 선수는 제자리, AI 킥오프는 옆 선수에게 패스, 상대는 서클 밖 */
  private updateKickoffRule(dt: number): void {
    const t = this.kickoffTaker;
    if (!t) return;
    if (this.ball.owner !== t || this.phase !== 'playing') {
      this.kickoffTaker = null;
      return;
    }
    this.kickoffClock += dt;
    t.vel.set(0, 0, 0);
    if (!this.isUserControlled(t) && this.kickoffClock > 0.7 && !this.windups.has(t)) {
      const mate = this.kickoffPartner(t.team);
      this.pass(t, tmp.set(mate.pos.x - t.pos.x, 0, mate.pos.z - t.pos.z).normalize(), 'short', 0.3);
    }
    const r = PITCH.centerCircle + 0.3;
    for (const p of this.teams[1 - t.team]) {
      const d = Math.hypot(p.pos.x, p.pos.z);
      if (d < r && d > 0.01) {
        p.pos.x *= r / d;
        p.pos.z *= r / d;
      }
    }
  }

  /** team 조작 측을 지금 처리 중인 측으로 두고 fn 실행 (세트피스·승부차기에서 그 팀 게이지·조작 선수를 쓰게) */
  withSide<T>(team: 0 | 1, fn: () => T): T {
    const prev = this.side;
    this.side = this.sides[team];
    try { return fn(); } finally { this.side = prev; }
  }

  /** 조작 선수가 키퍼면 가까운 필드 선수로 (사람이 조작하는 모든 팀) */
  switchOffKeepers(): void {
    for (const side of this.sides) if (side.active && side.controlled.isKeeper) this.withSide(side.team, () => this.switchToNearest());
  }

  /** cmd: 팀 0 명령(한 사람) 또는 [팀0, 팀1] 명령 (두 사람, 멀티플레이) */
  update(dt: number, input: UserCommand | readonly [UserCommand | null, UserCommand | null]): void {
    const cmds = Array.isArray(input) ? input as readonly [UserCommand | null, UserCommand | null] : [input as UserCommand, null] as const;
    this.elapsed += dt;
    this.phaseTimer -= dt;

    // 고립된 연습은 휘슬 뒤 새 인원을 배치하지 않는다. 동작·물리는 마저 진행해 접지 높이를 볼 수 있다.
    if (this.practice && this.phase !== 'playing') {
      for (const p of this.players) {
        p.steer(tmp.set(0, 0, 0), false, false, dt);
        p.update(dt);
      }
      this.stepWorld(dt);
      for (const g of this.goals) g.update(dt);
      return;
    }

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
        if (this.phase === 'playing') this.updatePlaying(dt, cmds);
        else this.setPieces.update(dt, cmds);
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
        this.shootout.update(dt, cmds);
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
    if (!this.practice) this.officials.update(dt);
  }

  /** 킥 동작 진행: 발이 닿는 순간 공이 아직 발 앞에 있으면 찬다 (그 사이 뺏기면 취소) */
  private updateWindups(dt: number): void {
    for (const [p, w] of this.windups) {
      p.vel.multiplyScalar(Math.exp(-4 * dt)); // 차는 동안 속도가 준다
      w.timer -= dt;
      if (w.timer > 0) continue;
      this.windups.delete(p);
      const bp = this.ball.position;
      const atFeet = this.ball.owner === p || (!this.ball.owner && Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z) < 1.6);
      if (atFeet) w.run();
    }
  }

  /** 지금 킥 동작 중인지 (입력·AI 판단을 막는다) */
  kicking(p: Player): boolean {
    return this.windups.has(p);
  }

  /** 킥 전에 공까지 달려가는 중 (도착하면 go로 킥 동작 시작, 뺏기거나 너무 오래 걸리면 취소) */
  private readonly approaches = new Map<Player, { ttl: number; go: () => void }>();

  private updateApproaches(dt: number): void {
    for (const [p, a] of this.approaches) {
      const bp = this.ball.position;
      a.ttl -= dt;
      if (this.ball.owner !== p || a.ttl <= 0) { this.approaches.delete(p); continue; }
      this.footPoint(p, tmp);
      if (Math.hypot(bp.x - tmp.x, bp.z - tmp.z) <= 0.55) {
        this.approaches.delete(p);
        a.go();
        continue;
      }
      // 공 뒤로 들어가 발이 공에 닿게 달린다 (입력은 잠깐 막는다)
      tmp2.set(bp.x - p.pos.x, 0, bp.z - p.pos.z).normalize();
      p.actionLock = Math.max(p.actionLock, 0.05);
      p.facing.copy(tmp2);
      p.steer(tmp2, true, true, dt);
    }
  }

  cancelWindups(): void {
    this.approaches.clear();
    this.windups.clear();
    this.cancelUserCharge();
  }

  /**
   * 동작 라이브러리에서 상황에 맞는 킥 동작을 골라 재생하고, 터치 순간에 run(실제 킥)을 실행한다.
   * instant면 동작만 맞추고 바로 찬다 (PK처럼 키퍼 반응을 차는 순간에 정해야 할 때)
   */
  private withKickMotion(p: Player, kind: MotionKind, vel: CANNON.Vec3, run: () => void, instant = false): void {
    if (this.windups.has(p) || this.approaches.has(p)) return;
    // 공이 발에서 한 걸음 이상 앞서 굴러가 있으면 공까지 달려가서 찬다 (그 자리에서 차면 공이 순간이동해 보인다)
    const bp0 = this.ball.position;
    this.footPoint(p, tmp);
    if (!instant && this.ball.owner === p && bp0.y < 0.5 && Math.hypot(bp0.x - tmp.x, bp0.z - tmp.z) > 0.7) {
      this.approaches.set(p, { ttl: 1.2, go: () => this.withKickMotion(p, kind, vel, run) });
      return;
    }
    const foot = this.kicks.footFactor(p).side === 1 ? 'R' : 'L';
    // 키퍼가 손에 든 공: 짧은 패스는 던지기, 긴 공은 손에서 떨어뜨려 차기(드롭킥 = 로빙 동작, 땅 높이 기준)
    const inHands = p.isKeeper && this.ball.owner === p && this.ball.position.y > 0.4;
    if (inHands) kind = kind === 'pass' ? 'throw' : 'lob';
    const plan = this.options.kickMotion !== false
      ? planKick(p, kind, vel.x, vel.z, foot, this.random.next(), inHands && kind === 'throw' ? undefined : inHands ? 0.11 : this.ball.position.y) : null;
    if (!plan) {
      run();
      return;
    }
    const windup = instant ? 0 : plan.windup;
    p.facing.set(Math.sin(plan.facing), 0, Math.cos(plan.facing));
    p.facingLock = windup + 0.35;
    p.playMotion(plan.entry, plan.entry.key - windup);
    if (windup <= 0) {
      run();
      return;
    }
    p.actionLock = Math.max(p.actionLock, windup);
    this.windups.set(p, { timer: windup, run });
  }

  private endHalf(): void {
    this.resetSides();
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
    for (const side of this.sides) if (side.controlled === p) {
      this.side = side;
      this.switchToNearest();
      this.side = this.sides[0];
    }
  }

  private updatePlaying(dt: number, cmds: readonly [UserCommand | null, UserCommand | null]): void {
    for (const p of this.players) p.contactScale = 1;
    const holder = this.ball.owner ?? this.ball.lastTouch;
    if (holder) this.stats.possession[holder.team] += dt;
    // W는 상대 공격 중에만 키퍼 지시다. 공격 스루/로빙 스루 입력은 그대로 둔다.
    const attackingTeam = this.ball.owner?.team ?? this.ball.lastTouch?.team;
    for (const side of this.sides) {
      const cmd = cmds[side.team];
      side.keeperRush = side.active && !!cmd && attackingTeam === 1 - side.team && cmd.through.held;
      if (!cmd || !this.isUserControlled(side.controlled)) continue;
      this.side = side;
      this.handleUser(dt, cmd);
    }
    this.side = this.sides[0];
    this.ai.update(dt);
    this.updateKickoffRule(dt);
    this.keepers.update(dt);

    this.skills.driveBodies(dt);
    for (const p of this.players) p.update(dt);
    this.separatePlayers();
    this.resolveTackles();
    if (this.phase !== 'playing') return; // 반칙 휘슬
    this.contestBall(dt);
    this.rules.update(dt);
    if (this.phase !== 'playing') return; // 어드밴티지 무효 → 프리킥
    this.updateApproaches(dt);
    this.updateWindups(dt);
    this.carryBall(dt, this.options.dribbleTouches !== false);
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
    const side = this.sides[p.team];
    const q = this.isUserControlled(p) ? side.queued : null;
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
          ? this.kicks.volley(p, q?.value ?? 0.55, side.lastMove, assist)
          : this.kicks.pass(p, side.lastMove.lengthSq() > 0.01 ? side.lastMove : p.facing, 'short', q?.value ?? 0.5, this.assistFor(p, 'pass'));
      this.kickBall(p, r.vel, r.spin);
    } else {
      const aim = this.isUserControlled(p) ? side.lastMove : new THREE.Vector3();
      r = this.kicks.header(p, mode, aim, this.assistFor(p, mode === 'pass' ? 'pass' : 'shot'));
      p.facing.set(r.vel.x, 0, r.vel.z).normalize();
      p.playAction('header', 0.5);
      if (mode !== 'clear') this.rules.recordKick(p);
      this.ball.kick(r.vel, r.spin, p);
      p.kickCooldown = PLAYER.kickCooldown;
      this.events.push({ type: 'kick', speed: r.vel.length() * 0.6, player: p });
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
        if (r.receiver && this.sides[p.team].active && !r.receiver.isKeeper) {
      if (!this.practiceControlLocked) this.sides[p.team].controlled = r.receiver;
      this.sides[p.team].receiveTimer = 0;
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
    this.events.push({ type: 'kick', speed: vel.length() * 0.5, player: p });
    this.ball.shot = null;
    this.passTarget = receiver;
    this.stats.passes[p.team]++;
    this.pendingPass = p.team;
    if (receiver && this.sides[p.team].active && !receiver.isKeeper) {
      if (!this.practiceControlLocked) this.sides[p.team].controlled = receiver;
      this.sides[p.team].receiveTimer = 0;
    }
  }

  // ---------------------------------------------------------------- 사용자 조작

  /** 터치 라벨과 경기 판정이 같은 공격/수비 경계를 사용한다. */
  /** 이 화면 사람 기준 공격 중인지 (HUD·터치 버튼용) */
  get localAttacking(): boolean {
    return this.withSide(this.localTeam, () => this.userAttacking);
  }

  get userAttacking(): boolean {
    const p = this.controlled, owner = this.ball.owner, bp = this.ball.position;
    const incoming = !owner && (this.passTarget === p || this.ballComingTo(p));
    return owner === p || (!owner && (Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z) < 4.5 || incoming));
  }

  /** 이 화면 사람의 게이지·예약을 취소 (UI 조작). 온라인에서는 입력 기록 밖 변경이라 Game이 부르지 않는다 */
  cancelUserCharge(): void {
    const side = this.local;
    side.charge = null;
    side.queued = null;
    side.pendingUserKick = null;
    side.powerTiming = null;
  }

  /** 킥오프·하프 종료: 두 팀 조작 상태를 모두 비운다 (화면마다 다른 팀 기준으로 비우면 경기가 갈라진다) */
  private resetSides(): void {
    for (const side of this.sides) {
      side.charge = null;
      side.queued = null;
      side.pendingUserKick = null;
      side.powerTiming = null;
      side.holding = null;
      side.holdTime = side.holdJudge = 0;
      side.keeperRush = false;
      side.knockTimer = 0;
      side.skillBuffer = null;
      side.trapping = false;
      side.skillInput.reset();
      side.skillInputHeld.reset();
    }
  }

  /**
   * 공을 손에 든 키퍼 (FC 온라인 키보드): 방향키로 겨누고
   *  S 던지기 · Z+S 강하게 던지기 · D 또는 A 드롭킥 · Z+A 낮고 빠른 킥 · W 발 앞에 내려놓기 (그 뒤엔 발로 플레이)
   */
  private keeperHands(p: Player, cmd: UserCommand): void {
    const aim = cmd.move.lengthSq() > 0.01 ? cmd.move.clone().setY(0).normalize() : p.facing.clone();
    if (cmd.move.lengthSq() > 0.01) p.faceTowards(p.pos.x + aim.x, p.pos.z + aim.z);
    if (this.windups.has(p)) return;
    const z = cmd.finesse.held;
    if (cmd.pass.pressed) this.pass(p, aim, z ? 'driven' : 'short', z ? 0.8 : 0.45);
    else if (cmd.shoot.pressed || cmd.lob.pressed) this.pass(p, aim, z ? 'lowLob' : 'lob', 0.8);
    else if (cmd.through.pressed) {
      // 내려놓기: 공을 발 앞 땅에 두고 키퍼가 발로 다룬다
      this.footPoint(p, tmp2);
      this.ball.body.position.set(tmp2.x, BALL.radius, tmp2.z);
      this.ball.body.velocity.set(0, 0, 0);
      p.basePose = null;
      return;
    } else return;
    p.basePose = null;
    // 받을 동료가 없어 조작이 키퍼에 남았으면 가까운 필드 선수로
    if (this.controlled === p) this.switchToNearest();
  }

  private handleUser(dt: number, cmd: UserCommand): void {
    const p = this.controlled;
    const owner = this.ball.owner;
    const hasBall = owner === p;
    const teamHasBall = owner?.team === p.team;
    const oppHasBall = !!owner && owner.team !== p.team;
    const bp = this.ball.position;
    const clearance = !owner && this.ball.lastTouch?.team !== p.team && this.passTarget !== p && Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z) <= COMMAND.clearanceRange && bp.y < 0.8;
    const attacking = this.userAttacking && !clearance;
    if (p.isKeeper && hasBall && bp.y > 0.4) {
      this.keeperHands(p, cmd);
      return;
    }
    let consumed = false;
    const queued = this.queued;
    if (queued && !hasBall && !oppHasBall && cmd[queued.kind].pressed && this.elapsed - (queued.started ?? -Infinity) <= INPUT.doubleTap + 1e-9) {
      queued.double = true;
      consumed = true;
    }
    const pending = this.pendingUserKick;
    if (pending) {
      if (pending.player !== p || owner !== p) this.pendingUserKick = null;
      else {
        const second = cmd[pending.kick.kind].pressed && this.elapsed - (pending.kick.started ?? 0) <= INPUT.doubleTap + 1e-9;
        if (second || this.elapsed - (pending.kick.started ?? 0) > INPUT.doubleTap) {
          this.pendingUserKick = null;
          pending.kick.double = second;
          this.executeUserKick(p, pending.kick, pending.move);
          consumed = second;
        } else if (KICK_KINDS.some((k) => cmd[k].pressed && k !== pending.kick.kind)) this.pendingUserKick = null;
      }
    }
    const timing = this.powerTiming;
    if (timing) {
      consumed = true;
      if (owner !== timing.player || p !== timing.player) this.powerTiming = null;
      else {
        timing.elapsed += dt;
        if (cmd.shoot.pressed && !timing.tapped) {
          timing.tapped = true;
          timing.timed = Math.abs(timing.elapsed - COMMAND.powerCenter) <= COMMAND.powerWindow / 2 + 1e-9;
        }
        if (timing.elapsed + 1e-9 >= COMMAND.powerWindup) {
          this.powerTiming = null;
          const r = this.kicks.shot(p, timing.kick.value, false, timing.move, this.assistFor(p, 'shot'), 'power', timing.timed);
          this.applyShot(p, r, true, 'powerShot', timing.timed);
        }
      }
    }
    if (this.charge && !hasBall && oppHasBall) this.cancelUserCharge();

    // S (수비 시) = 선수 변경
    if (cmd.pass.pressed && !attacking && !teamHasBall) this.switchToNearest();
    // Shift + 방향 (수비) = 그 화면 방향에 있는 동료로 전환 (오른쪽 스틱 전환)
    // 수비 중 Shift는 다른 쓰임이 없으므로 Shift 전부터 누르던 방향(달리던 방향)으로도 전환한다
    const sm = cmd.skillMove && cmd.skillMove.lengthSq() > 0.25 ? cmd.skillMove : !attacking || !teamHasBall ? cmd.move : cmd.skillMove;
    const aimNow = !!cmd.skill?.held && !!sm && sm.lengthSq() > 0.25;
    if (!attacking && !teamHasBall && aimNow && !this.switchAimHeld) this.switchToward(p, sm!);
    this.switchAimHeld = aimNow;

    const move = cmd.move.clone();
    // 치고 달리기: 움직이는 중 Shift 짧게(짧은 녹온, EE보다 짧다) / E 두 번(녹온) / E 세 번(아주 긴 녹온)
    this.knockTimer = Math.max(0, this.knockTimer - dt);
    if (cmd.sprint && !this.prevSprint) {
      this.sprintTaps = this.elapsed - this.lastSprintTap < 0.3 ? this.sprintTaps + 1 : 1;
      this.lastSprintTap = this.elapsed;
    }
    this.prevSprint = cmd.sprint;
    if (cmd.skill?.pressed) this.shiftDownAt = this.elapsed;
    if (hasBall && attacking && !this.charge && !this.skills.isActive(p) && this.kickoffTaker !== p) {
      const shiftTap = cmd.skill?.released && cmd.move.lengthSq() > 0.04 && this.elapsed - this.shiftDownAt < 0.25 && (cmd.skillMove?.lengthSq() ?? 0) < 0.01;
      const eTaps = this.elapsed - this.lastSprintTap > 0.3 && this.sprintTaps >= 2 ? this.sprintTaps : 0;
      if (shiftTap || eTaps) {
        this.knockOn(p, shiftTap ? 2.2 : eTaps >= 3 ? 7 : 3.2, move);
        this.sprintTaps = 0;
      }
    }
    // 개인기: 보조키를 누른 순간 몸 방향을 유지한다. Z 패스 게이지는 이동·조준 입력을 그대로 받는다
    if (cmd.skill && hasBall && attacking && !this.charge) {
      // 두 갈래로 읽는다: 새로 누른 키만(속임 동작처럼 탭 커맨드) / 달리던 키까지(스텝오버처럼 굴리는 커맨드). 둘 다 맞으면 긴 커맨드
      const usable = SKILLS.filter((s) => s.stars <= p.profile.skill);
      const a = this.skillInput.update(dt, cmd.skill.held, cmd.finesse.held, cmd.skillMove ?? cmd.move, p.facing, usable);
      const b = this.skillInputHeld.update(dt, cmd.skill.held, cmd.finesse.held, cmd.move, p.facing, usable);
      const len = (s: typeof a) => (s && s.trigger.kind !== 'fake' ? s.trigger.seq.length : 0);
      const def = len(b) > len(a) ? b : a ?? b;
      if (def) {
        this.skillInput.chain();
        this.skillInputHeld.chain();
      }
      if (cmd.skill.held || (cmd.finesse.held && !KICK_KINDS.some((kind) => cmd[kind].held))) move.copy(this.skillHeldMove);
      else this.skillHeldMove.copy(move);
      // 앞 개인기가 아직 도는 중이면 끝날 때 바로 이어서 낸다 (연속 헛다리 등, 0.5초 안에 끝나는 경우만)
      if (def && !this.skills.start(p, def) && this.skills.isActive(p)) this.skillBuffer = { def, ttl: 0.5 };
      if (this.skillBuffer) {
        this.skillBuffer.ttl -= dt;
        if (this.skillBuffer.ttl <= 0) this.skillBuffer = null;
        else if (!this.skills.isActive(p)) {
          this.skills.start(p, this.skillBuffer.def);
          this.skillBuffer = null;
        }
      }
      this.skills.hold(p, cmd.skill.held, cmd.move);
    } else {
      this.skillInput.reset();
      this.skillInputHeld.reset();
      this.skillHeldMove.copy(move);
    }
    // 추격 보정이 입력을 바꾸더라도 다음 터치는 사용자가 꺾으려던 방향으로 보낸다.
    // (공을 가진 사람만: 두 사람이 조작할 때 공 없는 쪽이 의도를 덮어쓰지 않게)
    if (hasBall) {
      this.dribbleIntent.copy(move).setY(0);
      this.dribbleIntentOwner = p;
      if (this.dribbleIntent.lengthSq() > 0.01) this.dribbleIntent.normalize();
      else this.dribbleIntent.set(0, 0, 0);
    }
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
      // 원터치를 미리 눌러 둔 동안 방향키는 조준이다 → 이동은 계속 공을 받으러 간다 (조준 방향으로 걸어가 공을 지나치지 않게)
      if (!hasInput || towardBall || this.queued || this.receiveTimer < MOVE_ASSIST_TIME[this.options.assists?.[this.side.team].move ?? settings.moveAssist]) {
        move.copy(dd > 0.25 ? tmp.normalize().multiplyScalar(Math.min(1, dd / 1.8)) : tmp.set(0, 0, 0));
        autoSprint = dd > 4 && (cmd.sprint || bp.y > 1.2);
        if (dd < 2) p.faceTowards(bp.x, bp.z);
      }
    }
    // Q 꾹 = 동료 압박 (가장 가까운 AI 동료가 같이 붙는다)
    this.teammatePress = oppHasBall && cmd.modifier.held;
    // D 꾹 = 압박 (바짝 붙음) / C 꾹 = 견제 (거리를 두고 길목을 막으며 천천히)
    const holding = oppHasBall && cmd.tackle.held;
    const pressing = oppHasBall && (cmd.shoot.held || holding);
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
      if (containing) speedScale = cmd.sprint ? COMMAND.contactSprintSpeed : COMMAND.contactSpeed;
    }
    // 공을 가진 채 손을 떼면 굴러가는 공까지 걸어가 발로 세운다 (FC처럼)
    this.side.trapping = hasBall && move.lengthSq() < 0.01;
    if (hasBall && this.options.dribbleTouches !== false) {
      this.footPoint(p, tmp2);
      tmp.set(bp.x - tmp2.x, 0, bp.z - tmp2.z);
      const d = tmp.length();
      if (this.side.trapping) {
        if (d > 0.25) move.copy(tmp.multiplyScalar(Math.min(1, d / 1.5) / d));
      } else this.guideDribble(p, move);
    }
    // C 볼 지키기: 공을 가진 채 C 유지 → 느리게, 가까운 상대에게 등을 돌려 몸으로 공을 가린다
    p.shielding = hasBall && attacking && cmd.contain.held && !this.pendingUserKick && !this.powerTiming && !this.windups.has(p) && !this.charge && !this.skills.isActive(p) && !KICK_KINDS.some((k) => cmd[k].held || cmd[k].pressed);
    if (p.shielding) {
      speedScale = Math.min(speedScale, 0.55);
      let near: Player | null = null, nd = 3;
      for (const q of this.teams[1 - p.team]) {
        const d = q.pos.distanceTo(p.pos);
        if (d < nd) { nd = d; near = q; }
      }
      if (near) {
        p.faceTowards(2 * p.pos.x - near.pos.x, 2 * p.pos.z - near.pos.z);
        p.facingLock = Math.max(p.facingLock, 0.05);
      }
    }
    // 킥오프를 차기 전에는 드리블할 수 없다 (패스·슛으로만 시작)
    if (this.kickoffTaker === p) move.set(0, 0, 0);
    if (!p.busy) p.steer(move, cmd.sprint || autoSprint, hasBall, dt, speedScale);
    // 압박/견제 중에는 상대를 바라본다 (뒷걸음질)
    if ((pressing || containing) && !p.busy) {
      const d = owner!.pos.distanceTo(p.pos);
      if (d < 4) p.faceTowards(owner!.pos.x, owner!.pos.z);
    }

    this.handleContact(dt, p, owner, cmd);
    if (clearance && cmd.shoot.pressed && !p.busy && p.kickCooldown <= 0) {
      const d = cmd.move.lengthSq() > 0.01 ? cmd.move.clone().normalize() : new THREE.Vector3(p.attackDir, 0, Math.sign(bp.z || 1) * 0.4).normalize();
      this.withKickMotion(p, 'lob', cv.set(d.x * COMMAND.clearanceSpeed, COMMAND.clearanceLift, d.z * COMMAND.clearanceSpeed), () => {
        this.kickBall(p, new CANNON.Vec3(d.x * COMMAND.clearanceSpeed, COMMAND.clearanceLift, d.z * COMMAND.clearanceSpeed), new CANNON.Vec3());
        this.describeKick('clearance', null);
        this.passTarget = null;
      }, true);
      consumed = true;
    }

    // 파워 게이지: D 슛 / S 패스 / W 스루 / A 로빙. Z = 감아차기, Q = 칩슛 / 로빙 스루
    // Z + C + D = 페이크 슛 (FC 온라인 키보드)
    if (!consumed && !this.pendingUserKick && !this.powerTiming && attacking && hasBall && !this.charge && cmd.finesse.held && cmd.contain.held && cmd.shoot.pressed) {
      this.startSkill(p, 'fake_shot');
    } else if (!consumed && !this.pendingUserKick && !this.powerTiming && attacking && !this.charge && !this.windups.has(p) && !this.skills.isActive(p)) {
      for (const kind of KICK_KINDS) {
        if (cmd[kind].pressed && !(kind === 'through' && this.keeperRush)) {
          this.charge = { kind, value: 0, finesse: cmd.finesse.held, chip: cmd.modifier.held, flair: cmd.contain.held, power: kind === 'shoot' && !!cmd.power?.held, keyboard: cmd.keyboardKick, started: this.elapsed };
          break;
        }
      }
    }
    if (this.charge) {
      const c = this.charge;
      // 패스를 누른 채 스루/로빙이 함께 눌리면 그 킥으로 바꾼다 (터치 스와이프)
      if (c.kind === 'pass') for (const k of ['through', 'lob'] as const) if (cmd[k].held) c.kind = k;
      // 슛·로빙 게이지 중 S = 페이크 (차는 척만 하고 공을 세운다)
      if ((c.kind === 'shoot' || c.kind === 'lob') && c.value > 0 && cmd.pass.pressed && this.ball.owner === p) {
        this.charge = null;
        // 달리는 중이면 달리며 페이크, 멈춰 있거나 C를 같이 누르면(C+A+S) 제자리 헛발질
        const running = Math.hypot(p.vel.x, p.vel.z) > 1.5 && !cmd.contain.held;
        this.startSkill(p, running ? 'fake_shot_run' : c.kind === 'shoot' ? 'fake_shot' : 'fake_pass');
      }
    }
    if (this.charge) {
      const c = this.charge;
      const btn = cmd[c.kind];
      c.value = Math.min(1, c.value + dt / (c.kind === 'shoot' ? SHOT.chargeTime : PASS.chargeTime));
      if (cmd.finesse.held) c.finesse = true;
      if (cmd.modifier.held) c.chip = true;
      if (cmd.contain.held) c.flair = true;
      // D를 먼저 누르고 F를 눌러도 파워슛 (누르는 순서와 무관하게)
      if (c.kind === 'shoot' && cmd.power?.held) c.power = true;
      if (oppHasBall) {
        this.charge = null; // 차는 도중 공을 뺏김
      } else if (btn.released || !btn.held) {
        if (this.ball.owner === p) {
          if (c.power) this.executeUserKick(p, c, cmd.move);
          else if (c.keyboard && this.elapsed - (c.started ?? 0) < INPUT.doubleTap) this.pendingUserKick = { player: p, kick: c, move: cmd.move.clone() };
          else this.executeUserKick(p, c, cmd.move);
        }
        else this.queued = { ...c, ttl: bp.y > 1 ? 1.4 : 0.7 };
        this.charge = null;
      }
    }
    if (this.queued) {
      this.queued.ttl -= dt;
      // 공이 아직 나에게 오는 중이면 예약을 유지한다 (멀리서 미리 누른 원터치가 도착 직전에 사라지지 않게)
      if (this.passTarget === p || this.ballComingTo(p)) this.queued.ttl = Math.max(this.queued.ttl, 0.2);
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


  /** 지금 선수에서 dir 쪽으로 가장 잘 맞는 동료(각도 우선, 가까울수록)로 전환 */
  switchToward(from: Player, dir: THREE.Vector3): void {
    const d = dir.clone().setY(0).normalize();
    let best: Player | null = null, bestScore = Infinity;
    for (const q of this.teams[from.team]) {
      if (q === from || q.isKeeper || q.sentOff) continue;
      tmp.set(q.pos.x - from.pos.x, 0, q.pos.z - from.pos.z);
      const dist = tmp.length();
      const ang = tmp.normalize().angleTo(d);
      if (ang > 1.0) continue;
      const score = ang * 12 + dist * 0.15;
      if (score < bestScore) { bestScore = score; best = q; }
    }
    if (best) {
      this.controlled = best;
      this.receiveTimer = 0;
    }
  }
  /** 녹온 뒤 공을 쫓는 동안 (소유 상실 거리를 늘린다) */

  /** 녹온: 공을 진행 방향으로 distance(m)만큼 길게 치고 질주로 쫓는다. 가속·속력이 좋을수록 더 길게 */
  knockOn(p: Player, distance: number, move: THREE.Vector3): void {
    const dir = move.lengthSq() > 0.01 ? move.clone().setY(0).normalize() : p.facing.clone();
    const st = p.profile.stats;
    const d = distance * (0.85 + 0.3 * n(st.sprintSpeed));
    // 선수 속도 위에, 구름 감속(rollDecel)으로 d만큼 앞서 나갈 속도를 더한다 (질주하는 선수가 바로 따라잡지 않게)
    const vp = Math.hypot(p.vel.x, p.vel.z);
    const u = vp + Math.sqrt(2 * (DRIBBLE.rollDecel + DRIBBLE.rollDamping * (vp + 2)) * d);
    this.ball.body.velocity.set(dir.x * u, 0, dir.z * u);
    this.knockTimer = 3;
    this.touchGap = 0.6;
    p.facing.copy(dir);
    this.events.push({ type: 'touch', speed: u, player: p });
    this.events.push({ type: 'skill', id: 'knock_on', player: p });
  }
  /** Shift를 누르기 직전의 이동 방향 (개인기 커맨드 입력 중 유지) */

  /** id로 개인기 시작 (별이 모자라면 무시) */
  startSkill(p: Player, id: string): boolean {
    const def = SKILLS.find((s) => s.id === id);
    return !!def && this.skills.start(p, def);
  }
  /** 패스로 조작 선수가 바뀐 뒤 지난 시간 (자동 전환 이동 보조용) */

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

  private executeUserKick(p: Player, c: UserKick, move: THREE.Vector3): void {
    if (c.power && c.kind === 'shoot') {
      this.powerTiming = { player: p, kick: c, move: move.clone(), elapsed: 0, timed: false, tapped: false };
      p.actionLock = Math.max(p.actionLock, COMMAND.powerWindup);
      p.vel.multiplyScalar(0.2);
      p.playAction('kick', COMMAND.powerWindup);
      return;
    }
    if (c.kind === 'shoot') {
      if (c.chip && !c.finesse && !c.double && !c.flair) { this.chipShot(p, c.value, move); return; }
      const style = c.double ? 'driven' : c.flair ? 'flair' : 'normal';
      if (style === 'normal') { this.shoot(p, c.value, c.finesse, move); return; }
      // D+D는 첫 D를 짧게 떼야 인식돼 게이지가 거의 안 찬다 → 드리븐은 원래 강하게 깔아 차는 슛이므로 최소 세기를 보장
      const value = style === 'driven' ? Math.max(c.value, COMMAND.drivenMinCharge) : c.value;
      const r = this.kicks.shot(p, value, c.finesse, move, this.assistFor(p, 'shot'), style);
      this.applyShot(p, r, false, c.finesse && c.double ? 'finesseDrivenShot' : `${style}Shot`);
      return;
    }
    const dir = move.lengthSq() > 0.01 ? move : p.facing;
    const cross = c.kind === 'lob' && Math.abs(p.pos.z) > PITCH.boxWidth / 2 && Math.abs(this.oppGoalX(p.team) - p.pos.x) < COMMAND.crossRange;
    let kind: PassKind;
    if (cross) kind = c.finesse ? 'fastCross' : c.chip ? 'highCross' : c.flair && p.profile.skill >= 3 ? 'flairCross' : c.double ? 'lowCross' : 'cross';
    else if (c.kind === 'through') kind = c.chip ? c.finesse ? 'lowLobThrough' : 'highLobThrough' : c.finesse ? 'drivenThrough' : c.double ? 'dinkThrough' : 'through';
    else if (c.kind === 'pass') kind = c.finesse ? 'driven' : c.chip ? 'oneTwo' : c.flair && p.profile.skill >= 3 ? 'flair' : c.double ? 'dink' : 'short';
    else kind = c.finesse || c.double ? 'lowLob' : 'lob';
    this.pass(p, dir, kind, c.value);
  }

  /** 발사 순간의 종류와 목표를 이벤트에 붙여 JSON 재생에서도 명령을 식별한다. */
  private describeKick(kind: string, r: KickResult | null, timed?: boolean): void {
    const event = this.events[this.events.length - 1];
    if (event?.type !== 'kick') return;
    Object.assign(event, { kind, receiver: r?.receiver ?? null, origin: [this.ball.position.x, this.ball.position.y, this.ball.position.z], aimOrigin: r?.origin?.toArray(), receiverPosition: r?.receiver?.pos.toArray(), velocity: [this.ball.velocity.x, this.ball.velocity.y, this.ball.velocity.z], spin: r ? [r.spin.x, r.spin.y, r.spin.z] : [0, 0, 0], target: r?.target?.toArray(), timed, flair: r?.flair ?? false });
  }

  private handleContact(dt: number, p: Player, owner: Player | null, cmd: UserCommand): void {
    if (!owner || owner.team === p.team || p.stunned > 0 || owner.pos.distanceTo(p.pos) > COMMAND.contactRange) {
      this.holding = null; this.holdTime = this.holdJudge = 0;
      return;
    }
    const hold = cmd.tackle.held;
    if (hold) {
      if (this.holding !== owner) { this.holding = owner; this.holdTime = this.holdJudge = 0; }
      this.holdTime += dt;
      owner.contactScale = COMMAND.holdSlow;
      if (this.holdTime >= this.holdJudge) {
        this.events.push({ type: 'contact', kind: 'hold', success: true, player: p, opponent: owner, duration: this.holdTime });
        this.holdJudge = this.holdTime + COMMAND.holdJudgePeriod;
        // 오래 잡을수록 접촉 한 번의 반칙 위험을 높인다. 실제 파울·카드 처리는 기존 심판 경로다.
        if (this.holdTime > COMMAND.holdFoulAfter) {
          p.tackleKind = 'stand';
          const foul = this.rules.judgeTackle(p, owner, false, Math.min(1, (this.holdTime - COMMAND.holdFoulAfter) / COMMAND.holdFoulAfter));
          if (foul) this.rules.call(foul, true);
        }
      }
    } else { this.holding = null; this.holdTime = this.holdJudge = 0; }
    const shoulder = cmd.contain.held && cmd.move.lengthSq() > 0.01;
    if ((cmd.shoot.pressed || shoulder) && !p.busy && p.tackleCooldown <= 0) {
      const attack = p.stat('strength') * 0.7 + p.stat('balance') * 0.3;
      const resist = owner.stat('strength') * 0.5 + owner.stat('balance') * 0.5;
      const success = this.random.next() < THREE.MathUtils.clamp(0.5 + attack - resist, 0.1, 0.9);
      p.tackleCooldown = PLAYER.standTackleCooldown;
      if (success) {
        owner.stunned = Math.max(owner.stunned, COMMAND.pushStun);
        owner.vel.multiplyScalar(0.6);
      }
      this.events.push({ type: 'contact', kind: cmd.shoot.pressed ? 'push' : 'shoulder', success, player: p, opponent: owner, duration: success ? COMMAND.pushStun : 0 });
    }
  }

  /** 사용자 팀은 설정한 보정, AI는 항상 보조 (오차는 능력치로) */
  assistFor(p: Player, kind: 'pass' | 'shot'): AssistLevel {
    const a = this.options.assists?.[p.team];
    if (a) return kind === 'pass' ? a.pass : a.shot;
    if (p.team !== 0) return 'assisted';
    return kind === 'pass' ? settings.passAssist : settings.shotAssist;
  }

  /** Q+D 칩슛 */
  chipShot(p: Player, charge: number, aim: THREE.Vector3): void {
    this.applyShot(p, this.kicks.chip(p, charge, aim, this.assistFor(p, 'shot')), false, 'chipShot');
  }

  switchToNearest(): void {
    let best: Player | null = null;
    let bestD = Infinity;
    for (const p of this.teams[this.practiceControlLocked ? this.controlled.team : this.side.team]) {
      if (p.isKeeper || p === this.controlled) continue;
      const d = p.pos.distanceToSquared(tmp.set(this.ball.position.x, 0, this.ball.position.z));
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best && !this.practiceControlLocked) this.controlled = best;
  }

  // ---------------------------------------------------------------- 액션

  /** 슛. charge 0..1, aim = 입력 방향. 파워가 너무 세면 공이 뜬다 (FIFA식) */
  shoot(p: Player, charge: number, finesse: boolean, aim: THREE.Vector3, instant = false): void {
    if (this.windups.has(p)) return;
    if (finesse) this.preferStrongFoot(p);
    this.applyShot(p, this.kicks.shot(p, charge, finesse, aim, this.assistFor(p, 'shot')), instant, finesse ? 'finesseShot' : 'shot');
  }

  private applyShot(p: Player, r: KickResult, instant = false, kind = 'shot', timed?: boolean): void {
    this.withKickMotion(p, 'shot', r.vel, () => {
      this.kickBall(p, r.vel, r.spin);
      if (r.flair) p.playAction('kick', 0.4, { flair: true, side: this.kicks.footFactor(p).side });
      this.describeKick(kind, r, timed);
      this.ball.newShot(p);
      this.stats.shots[p.team]++;
      this.passTarget = null;
    }, instant);
  }

  /** 패스. short = 땅볼, through = 침투 공간으로, lob = 띄워서, lobThrough = 띄운 스루 */
  pass(p: Player, dir: THREE.Vector3, kind: PassKind = 'short', charge = 0.5): void {
    if (this.windups.has(p)) return;
    const r = this.kicks.pass(p, dir, kind, charge, this.assistFor(p, 'pass'));
    this.withKickMotion(p, ['lob', 'lobThrough', 'lowLob', 'highLobThrough', 'lowLobThrough', 'cross', 'lowCross', 'highCross', 'flairCross', 'fastCross'].includes(kind) ? 'lob' : 'pass', r.vel, () => {
      this.kickBall(p, r.vel, r.spin);
      this.rules.recordPass(p);
      this.dinkFlight = kind === 'dink' || kind === 'dinkThrough';
      if (r.flair) p.playAction('kick', 0.4, { flair: true, side: this.kicks.footFactor(p).side });
      this.describeKick(kind, r);
      this.ball.shot = null;
      this.passTarget = r.receiver;
      this.stats.passes[p.team]++;
      this.pendingPass = p.team;
      if (r.receiver && this.sides[p.team].active && !r.receiver.isKeeper) {
        if (!this.practiceControlLocked) this.sides[p.team].controlled = r.receiver;
        this.sides[p.team].receiveTimer = 0;
      }
    });
  }

  private kickBall(p: Player, vel: CANNON.Vec3, spin: CANNON.Vec3): void {
    // 공이 몸의 오른쪽에 있으면 오른발로 찬다
    // 킥 동작(모션)이 몸 방향을 정했으면 그대로 두고, 아니면 공 방향으로 돌려 코드 오버레이로 찬다
    if (p.facingLock <= 0) {
      const { side } = this.kicks.footFactor(p);
      p.facing.set(vel.x, 0, vel.z).normalize();
      p.playAction('kick', 0.4, { side });
    }
    // 들고 있던 공(키퍼)은 발 앞에서 출발
    if (this.ball.position.y > 0.5 && p.isKeeper) {
      this.ball.body.position.set(p.pos.x + p.facing.x * 0.6, 0.9, p.pos.z + p.facing.z * 0.6);
    }
    this.rules.recordKick(p);
    this.dinkFlight = false;
    this.ball.kick(vel, spin, p);
    p.kickCooldown = PLAYER.kickCooldown;
    p.basePose = null;
    this.events.push({ type: 'kick', speed: vel.length(), player: p });
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

  /**
   * 받는 첫 터치: 공을 선수 진행 방향(또는 바라보는 방향)으로, 선수 속도보다 조금 빠르게 놓는다.
   * 볼 컨트롤이 낮을수록 공이 조금 더 튄다 (튀어 나가는 '헤비 터치'는 checkPossession이 따로 판정).
   */
  private firstTouch(p: Player): void {
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const dir = speed > 0.6 ? tmp.set(p.vel.x / speed, 0, p.vel.z / speed) : tmp.copy(p.facing);
    const ctrl = n(p.profile.stats.ballControl);
    const T = DRIBBLE.touchPeriod;
    const b = this.ball.body;
    let u = 0;
    if (speed > 0.6) {
      // 받는 순간도 이미 벌어진 거리를 빼고 다음 발 앞으로 잡는다. 옆에서 받은 공을 나란히 밀어내지 않는다.
      const travel = speed * T + DRIBBLE.leadWalk * (1.3 - 0.6 * ctrl);
      this.footPoint(p, tmp2).addScaledVector(dir, travel);
      dir.set(tmp2.x - b.position.x, 0, tmp2.z - b.position.z);
      u = dir.length() / T + 0.5 * (DRIBBLE.rollDecel + DRIBBLE.rollDamping * speed) * T;
      dir.normalize();
    } else if (this.isUserControlled(p)) {
      // 사람이 멈춰서 받을 때: 그 자리에 죽이지 않고 발 앞으로 끌어와 세운다 (멀리서 잡힌 공이 발에서 떨어져 남지 않게)
      this.footPoint(p, tmp2);
      dir.set(tmp2.x - b.position.x, 0, tmp2.z - b.position.z);
      const gap = dir.length();
      if (gap > 0.2) {
        u = gap / T + 0.5 * DRIBBLE.rollDecel * T;
        dir.normalize();
      }
    }
    b.velocity.set(dir.x * u, Math.min(0, b.velocity.y), dir.z * u);
    b.angularVelocity.set(b.velocity.z / BALL.radius, 0, -b.velocity.x / BALL.radius);
    // 받는 동작 (화면용): 공 높이·속도에 맞는 트래핑 클립. 경기 판정에는 쓰지 않는다
    if (!p.busy && !this.windups.has(p) && !this.sides[p.team].queued) {
      const trap = selectMotion(MOTION_CATALOG, { kind: 'trap', speed: speedClass(p), angle: 0, height: b.position.y, random: visualRandom.next() });
      if (trap) p.playMotion(trap.entry, 0, 1.2);
    }
    this.touchGap = DRIBBLE.touchGap;
    this.events.push({ type: 'touch', speed: u, player: p });
  }

  /** 소유 중인 공 다루기. touches면 터치 드리블, 아니면 발 앞에 붙여 다닌다 (킥오프 대기 등) */
  private touchGap = 0;
  private readonly dribbleIntent = new THREE.Vector3();
  private dribbleIntentOwner: Player | null = null;
  /** 사용자가 공을 가진 채 입력을 뗐다: 앞으로 치지 않고 발로 세운다 */

  /** 사용자와 AI 모두 원래 의도를 보관하고 발이 닿지 않는 공만 쫓는다. */
  guideDribble(p: Player, move: THREE.Vector3): void {
    if (this.options.dribbleTouches === false) return;
    this.dribbleIntent.copy(move).setY(0);
    this.dribbleIntentOwner = p;
    if (this.dribbleIntent.lengthSq() > 0.01) this.dribbleIntent.normalize();
    else this.dribbleIntent.set(0, 0, 0);
    this.footPoint(p, tmp2);
    const bp = this.ball.position;
    tmp.set(bp.x - tmp2.x, 0, bp.z - tmp2.z);
    const d = tmp.length();
    if (d > DRIBBLE.recoverStart && d <= DRIBBLE.recoverDistance && this.dribbleIntent.lengthSq() > 0.01 &&
        this.dribbleIntent.dot(tmp) / d < Math.cos(DRIBBLE.recoverAngle)) {
      // 공은 터치 전까지 그대로 굴리고, 몸만 공을 향해 발이 빨리 닿게 한다.
      p.faceTowards(bp.x, bp.z);
    }
    if (d <= DRIBBLE.reach) return;
    // 실시간 조정으로 reach가 완전 추격 거리 이상이 되어도 보간 비중이 음수가 되지 않게 한다.
    const pull = THREE.MathUtils.lerp(DRIBBLE.pullMin, 1,
      Math.min(1, (d - DRIBBLE.reach) / Math.max(1e-6, DRIBBLE.pullFullDistance - DRIBBLE.reach)));
    // 입력이 없거나(목표 도착) 작아도 굴러가는 공은 쫓는다
    const len = Math.max(move.length(), Math.min(1, d / 1.5));
    if (move.lengthSq() < 1e-6) move.copy(tmp.normalize()).multiplyScalar(len);
    else move.normalize().lerp(tmp.normalize(), pull).normalize().multiplyScalar(len);
  }

  private carryBall(dt: number, touches = false): void {
    const o = this.ball.owner;
    if (!o) return;
    if (o.isKeeper && this.ball.position.y > 0.4) {
      // 키퍼가 손에 들고 있음
      tmp.copy(o.pos).addScaledVector(o.facing, 0.32);
      cv.set(tmp.x, 0, tmp.z);
      this.ball.carry(cv, o.cannonVel, dt, 1.15);
      return;
    }
    if (this.skills.driveBall(dt, this.isUserControlled(o) ? this.sides[o.team].lastMove : null)) return;
    // 킥 동작 중에는 발 앞에 붙여 둔다 (차는 순간 위치가 흔들리지 않게)
    if (touches && !this.windups.has(o)) {
      this.touchDribble(o, dt);
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

  /**
   * 터치 드리블: 공은 굴러가고(구름 감속), 선수가 따라가 발이 닿을 때 다시 툭 찬다.
   *  - 공이 몸 앞 가까이 오거나, 의도 방향과 공 방향이 어긋나면(방향 전환) 터치
   *  - 질주 터치는 길게 치고 나가고, 드리블·볼 컨트롤이 좋을수록 짧고 정확하다
   *  - 멈추면 발바닥으로 세워 발 앞에 둔다
   *  - 공이 너무 멀어지면(헤비 터치) 소유를 잃는다
   */
  private touchDribble(o: Player, dt: number): void {
    const body = this.ball.body, bp = body.position, bv = body.velocity;
    const speed = Math.hypot(o.vel.x, o.vel.z);
    const fx = o.facing.x, fz = o.facing.z;
    const rx = bp.x - o.pos.x, rz = bp.z - o.pos.z;
    const dist = Math.hypot(rx, rz);
    // 녹온: 발이 닿는 거리까지 따라잡으면 평소 드리블로 돌아간다
    const knock = this.sides[o.team];
    if (knock.knockTimer > 0 && knock.knockTimer < 2.6 && dist < DRIBBLE.reach) knock.knockTimer = 0;
    if (dist > (knock.knockTimer > 0 ? 9 : DRIBBLE.leash)) {
      this.ball.owner = null; // 헤비 터치: 이제 누구 공도 아니다
      this.events.push({ type: 'heavyTouch', player: o });
      return;
    }
    const ahead = rx * fx + rz * fz;
    // 구름 감속
    let vx = bv.x, vz = bv.z;
    const v = Math.hypot(vx, vz);
    if (v > 0) {
      const k = Math.max(0, v - (DRIBBLE.rollDecel + DRIBBLE.rollDamping * v) * dt) / v;
      vx *= k;
      vz *= k;
    }
    const st = o.profile.stats;
    const ctrl = n(st.dribbling) * 0.6 + n(st.ballControl) * 0.4;
    // 몸이 돌기 전의 사용자 입력·AI 목표 방향을 쓴다. 소유자가 바뀌면 이전 의도를 버린다.
    const intent = this.dribbleIntentOwner === o ? this.dribbleIntent : o.facing;
    const hasIntent = intent.lengthSq() > 0.01;
    const ix = hasIntent ? intent.x : fx, iz = hasIntent ? intent.z : fz;
    this.footPoint(o, tmp2);
    const footX = bp.x - tmp2.x, footZ = bp.z - tmp2.z;
    const along = footX * ix + footZ * iz;
    const sideX = footX - ix * along, sideZ = footZ - iz * along;
    const intentAngle = Math.atan2(iz, ix);
    const ballAngle = v > 0.3 ? Math.atan2(vz, vx) : Math.atan2(fz, fx);
    const angle = Math.atan2(Math.sin(intentAngle - ballAngle), Math.cos(intentAngle - ballAngle));
    const moving = speed > 0.6 && !(this.sides[o.team].trapping && this.isUserControlled(o));
    this.touchGap -= dt;
    // 발끝 기준 거리: 몸 옆이나 앞으로 굴러간 공은 따라가서 발이 닿아야 건드린다
    const footDist = Math.hypot(footX, footZ);
    const inReach = footDist < DRIBBLE.reach;
    const close = ahead > -0.2 && ahead < DRIBBLE.touchLead + speed * 0.05;
    // 방향을 꺾는 터치는 공이 발 바로 앞에 있을 때만
    const turning = (Math.abs(angle) > DRIBBLE.turnAngle || Math.hypot(sideX, sideZ) > DRIBBLE.lateralTouch) &&
      footDist < DRIBBLE.turnReach;
    if (moving && inReach && this.touchGap <= 0 && (close || turning)) {
      // 상대가 가까우면 공을 짧게 붙여 지킨다 (압박 속 질주 터치로 공을 흘리지 않게)
      const opp = this.nearestOpponentDist(o);
      const guard = opp < DRIBBLE.pressureRange ? THREE.MathUtils.lerp(DRIBBLE.pressureKnock, 1, opp / DRIBBLE.pressureRange) : 1;
      // 이미 앞서 있거나 옆에 남은 거리까지 빼서 다음 발 디딤 앞으로 보낸다.
      // 매번 현재 속도에 lead/T만 더하면 회전 터치 때 벌어진 간격이 그대로 누적된다.
      const lead = (o.sprinting ? DRIBBLE.leadSprint : DRIBBLE.leadWalk) * guard * (1.25 - 0.6 * ctrl) * (0.85 + 0.3 * this.random.next());
      const T = DRIBBLE.touchPeriod;
      const travel = Math.max(DRIBBLE.recenterMinDistance, speed * T + lead);
      const targetX = ix * travel - footX, targetZ = iz * travel - footZ;
      const targetAngle = Math.atan2(targetZ, targetX);
      const targetTurn = Math.atan2(Math.sin(targetAngle - ballAngle), Math.cos(targetAngle - ballAngle));
      const targetSpeed = Math.hypot(targetX, targetZ) / T + 0.5 * (DRIBBLE.rollDecel + DRIBBLE.rollDamping * speed) * T;
      const skill = (n(st.dribbling) + n(st.agility)) / 2;
      const limit = THREE.MathUtils.lerp(DRIBBLE.turnMin, DRIBBLE.turnMax, skill);
      const turn = THREE.MathUtils.clamp(targetTurn, -limit, limit);
      const direction = ballAngle + turn;
      const u = targetSpeed * Math.max(DRIBBLE.turnMinSpeedFactor, 1 - DRIBBLE.turnSlowdown * Math.abs(turn) / (Math.PI / 2));
      vx = Math.cos(direction) * u;
      vz = Math.sin(direction) * u;
      const facingAngle = Math.atan2(fz, fx);
      const bodyTurn = Math.atan2(Math.sin(direction - facingAngle), Math.cos(direction - facingAngle));
      const facing = facingAngle + bodyTurn * DRIBBLE.turnFacing;
      o.facing.set(Math.cos(facing), 0, Math.sin(facing));
      this.touchGap = DRIBBLE.touchGap;
      this.dribbleTouch++;
      this.events.push({ type: 'touch', speed: u, player: o });
    } else if (!moving && inReach && this.touchGap <= 0) {
      // 발바닥으로 한 번 세운다. 매 스텝 목표점으로 끌면 터치 없이 공이 꺾이게 된다.
      if (v > 1) {
        this.events.push({ type: 'touch', speed: v, player: o });
        this.touchGap = DRIBBLE.touchGap;
      }
      vx = vz = 0;
    }
    body.velocity.set(vx, Math.min(bv.y, 0), vz);
    body.angularVelocity.set(vz / BALL.radius, 0, -vx / BALL.radius);
  }

  private resolveTackles(): void {
    for (const p of this.players) {
      if (p.tackleTimer <= 0 || p.tackleResolved) continue;
      const o = this.ball.owner;
      this.footPoint(p, tmp).addScaledVector(p.facing, 0.25);
      const bp = this.ball.position;
      const d = Math.hypot(bp.x - tmp.x, bp.z - tmp.z);
      // 딩크의 발 높이 제한은 소유권 인터셉트와 실제 태클 양쪽에서 같아야 한다.
      if (d > p.tackleRange || bp.y > 0.8 || (this.dinkFlight && bp.y > PLAYER.dinkInterceptHeight)) continue;
      if (o && o.team !== p.team) {
        // 정면 태클이 성공률이 높다
        const facingDot = -o.facing.dot(p.tackleDir);
        const ts = p.profile.stats, os = o.profile.stats;
        const tackleSkill =
          p.tackleKind === 'stand'
            ? n(ts.standingTackle) * 0.6 + n(ts.defAwareness) * 0.4
            : n(ts.slidingTackle) * 0.8 + n(ts.defAwareness) * 0.2;
        const evade = n(os.dribbling) * 0.4 + n(os.balance) * 0.35 + n(os.strength) * 0.25;
        // 개인기 중에는 공이 몸에 감춰져 있어 빼앗기 어렵다
        const chance = THREE.MathUtils.clamp(0.22 + 0.5 * tackleSkill - 0.28 * evade + 0.3 * Math.max(0, facingDot), 0.08, 0.92) * this.skills.shield(o) *
          // 볼 지키기: 몸싸움이 강할수록 빼앗기 어렵다
          (o.shielding ? 0.75 - 0.35 * n(os.strength) : 1);
        const success = this.random.next() < chance;
        p.tackleResolved = true;
        p.tackleTimer = Math.min(p.tackleTimer, 0.08);
        this.events.push({ type: 'tackle', success });
        const foul = this.rules.judgeTackle(p, o, success, o.facing.dot(p.tackleDir));
        if (foul) {
          o.stunned = 0.55;
          // 어드밴티지(공을 지킨 채 계속)면 넘어지지 않는다. 휘슬이 불리면 경기가 멈추므로 넘어져도 된다
          if (success) o.fall();
          o.basePose = null;
          this.sides[o.team].charge = null;
          this.rules.call(foul, !success);
          if (this.phase !== 'playing') return;
          continue;
        }
        if (success) {
          this.stats.tackles[p.team]++;
          o.stunned = 0.55;
          // 슬라이딩에 걸려 넘어지면 넘어지는 동작 길이만큼 못 움직인다 (누운 채 미끄러져 보이지 않게)
          if (p.tackleKind === 'slide') o.stunned = Math.max(o.stunned, o.fall());
          o.basePose = null;
          this.sides[o.team].charge = null;
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

  /**
   * 몸싸움 뺏기: 상대가 공에 발을 대고 있으면(소유자 발보다 가깝거나 비슷하게) 태클 없이도 공을 빼앗을 수 있다.
   * 가만히 서서 공을 끼고 있으면 빨리 뺏기고, 드리블·볼 지키기·개인기 중이면 버틴다. 사람·AI 공통.
   */
  private contestBall(dt: number): void {
    const o = this.ball.owner;
    if (!o || o.isKeeper || o.busy && o.tackleTimer > 0) return;
    const bp = this.ball.position;
    // 달리며 치고 나가는 드리블은 태클로만 뺏는다 (몸싸움 뺏기는 멈추거나 천천히 끄는 공만)
    if (bp.y > 0.5 || Math.hypot(o.vel.x, o.vel.z) > 2.5) return;
    const own = Math.hypot(bp.x - o.pos.x - o.facing.x * 0.35, bp.z - o.pos.z - o.facing.z * 0.35);
    for (const q of this.teams[1 - o.team]) {
      if (q.isKeeper || q.busy || q.stunned > 0 || q.kickCooldown > 0) continue;
      this.footPoint(q, tmp);
      const d = Math.hypot(bp.x - tmp.x, bp.z - tmp.z);
      if (d > 0.45 || d > own + 0.15) continue;
      const qs = q.profile.stats, os = o.profile.stats;
      const still = Math.hypot(o.vel.x, o.vel.z) < 1.2 ? 1.6 : 1;
      const win = (0.5 + n(qs.defAwareness) * 0.5 + n(qs.strength) * 0.3) / (0.6 + n(os.ballControl) * 0.4 + n(os.strength) * 0.4);
      const rate = 1.4 * still * win * this.skills.shield(o) * (o.shielding ? 0.75 - 0.35 * n(os.strength) : 1);
      if (this.random.next() < 1 - Math.exp(-rate * dt)) {
        o.stunned = Math.max(o.stunned, 0.25);
        this.sides[o.team].charge = null;
        this.stats.tackles[q.team]++;
        this.events.push({ type: 'tackle', success: true });
        this.gainPossession(q);
        return;
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
      // 딩크는 수비수의 발·슬라이딩을 넘긴다. 몸통 충돌은 기존 판정을 유지한다.
      if (intercepting && this.dinkFlight && bp.y > PLAYER.dinkInterceptHeight) continue;
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
    const side = this.sides[best.team];
    if (side.active && !best.isKeeper && !this.practiceControlLocked) side.controlled = best;
    // 사람 팀 키퍼가 손으로 잡으면 그 키퍼를 직접 조작한다 (S 던지기 · D/A 드롭킥 · W 내려놓기)
    else if (side.active && best.isKeeper && hands && !this.practiceControlLocked) side.controlled = best;
    // 방향 첫 터치: 받는 순간 누르고 있던 방향으로 공을 잡아 놓는다
    if (best === side.controlled && side.lastMove.lengthSq() > 0.01) best.facing.copy(side.lastMove).setY(0).normalize();
    // 터치 드리블에서는 받은 공의 속도를 죽여 발 앞에 놓아야 한다 (안 그러면 패스 속도 그대로 굴러가 버린다)
    if (this.options.dribbleTouches !== false && !best.isKeeper) this.firstTouch(best);
    if (best.isKeeper) {
      this.keepers.onCatch(best);
      if (hands && this.inOwnBox(best, bp.x, bp.z)) {
        best.basePose = 'hold';
        this.ball.body.position.y = Math.max(bp.y, 0.6);
      }
      return;
    }
    // 미리 입력해 둔 원터치 슛/패스
    if (best === side.controlled && side.queued) {
      const q = side.queued;
      side.queued = null;
      this.side = side;
      this.executeUserKick(best, q, this.lastMove);
      this.side = this.sides[0];
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
        // 일반 경기는 슬라이딩/다이빙의 몸 접촉을 허용하지만 연습에서는 거리 측정이 가능해야 한다.
        if ((!this.practice || a.isKeeper || b.isKeeper) &&
          (a.tackleTimer > 0 || b.tackleTimer > 0 || a.diveTimer > 0 || b.diveTimer > 0)) continue;
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
    this.resetSides();
    if (this.lastScorer) this.lastScorer.basePose = 'celebrate';
    for (const p of this.teams[team]) if (p !== this.lastScorer && !p.isKeeper) p.basePose = null;
    if (!this.lastScorer) {
      // 자책골이면 득점 팀 공격수를 기준으로 세리머니
      this.lastScorer = this.teams[team].length ? this.forward(team) : null;
      if (this.lastScorer) this.lastScorer.basePose = 'celebrate';
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

  /** 인원만 줄이고 소유권·터치·태클·킥·물리는 본 경기 경로로 실행한다. */
  startPractice(active: readonly Player[], controlled: Player, seed: number): void {
    if (!this.practice) throw new Error('practice 옵션이 필요합니다');
    this.restart();
    this.kickoffTaker = null;
    this.practiceOpponent = null;
    this.practiceControlLocked = false;
    this.random.reset(seed);
    this.events.length = 0;
    this.touchGap = this.dribbleTouch = this.aerialLock = 0;
    this.dribbleIntent.set(0, 0, 0);
    for (const side of this.sides) {
      side.receiveTimer = 0;
      side.lastMove.set(0, 0, 0);
    }
    this.dribbleIntentOwner = null;
    for (const p of this.roster) {
      p.vel.set(0, 0, 0);
      p.actionLock = p.facingLock = p.tackleCooldown = 0;
      p.tackleResolved = p.sprinting = false;
      p.diveVel.set(0, 0, 0);
      p.resetAnimation();
      p.model.root.visible = active.includes(p);
    }
    this.players.splice(0, this.players.length, ...active);
    for (const team of [0, 1] as const) this.teams[team].splice(0, this.teams[team].length, ...active.filter((p) => p.team === team));
    this.controlled = controlled;
    this.ball.reset();
    this.phase = 'playing';
    this.phaseTimer = 0;
    this.ai.reset();
    for (const o of this.officials.all) o.model.root.visible = o.item.visible = false;
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
