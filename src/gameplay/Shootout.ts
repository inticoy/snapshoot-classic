import * as THREE from 'three';
import { BALL, GOAL, PITCH, RULES, SHOT } from '../config';
import type { Player } from '../entities/Player';
import type { Match, UserCommand } from './Match';
import { diveKeeper, keeperGuess, kickOrder, penaltyAim, penaltySpot, shootoutDecided, shotLineZ, sideFromInput } from './Penalty';

const tmp = new THREE.Vector3();

/**
 * 무승부 뒤 승부차기. 5번씩 차고, 같으면 서든 데스.
 * 모든 킥은 같은 골대(+X)로 찬다. 사용자 팀이 찰 때는 키커를, 막을 때는 키퍼 다이빙 방향을 고른다.
 *   찰 때: 방향키 위/아래 = 골문 좌우 구석, D = 세기 (뗄 때 찬다)
 *   막을 때: 상대가 차는 순간 누르고 있는 방향키 위/아래로 몸을 던진다
 */
export class Shootout {
  readonly results: [boolean[], boolean[]] = [[], []];
  active = false;
  turn: 0 | 1 = 0;
  stage: 'ready' | 'flight' | 'result' = 'ready';
  kicker: Player | null = null;
  keeper: Player | null = null;
  private timer = 0;
  private charge: number | null = null;
  private readonly spot = new THREE.Vector3();
  private readonly dir: 1 | -1 = 1;
  private aiAim = 0;

  constructor(private readonly m: Match) {}

  get score(): [number, number] {
    return [this.results[0].filter(Boolean).length, this.results[1].filter(Boolean).length];
  }

  /** 사용자 팀이 지금 차는 차례 */
  get userKicking(): boolean {
    return this.active && this.turn === 0 && this.m.userControl;
  }

  /** 지금 HUD에 보여 줄 파워 게이지 (0..1) */
  get power(): number | null {
    return this.charge;
  }

  reset(): void {
    this.results[0].length = 0;
    this.results[1].length = 0;
    this.active = false;
    this.turn = 0;
    this.kicker = this.keeper = null;
    this.charge = null;
  }

  start(): void {
    this.reset();
    this.active = true;
    this.m.phase = 'shootout';
    this.m.charge = null;
    this.setupKick();
  }

  private setupKick(): void {
    const m = this.m;
    const order = kickOrder(m.teams[this.turn]);
    this.kicker = order[this.results[this.turn].length % order.length];
    this.keeper = m.teams[1 - this.turn][0];
    this.stage = 'ready';
    this.timer = 0;
    this.charge = null;
    this.aiAim = (m.random.next() < 0.5 ? -1 : 1) * (0.3 + 0.7 * Math.sqrt(m.random.next()));
    penaltySpot(this.dir, this.spot);
    for (const p of m.players) {
      p.vel.set(0, 0, 0);
      p.stunned = p.tackleTimer = p.diveTimer = p.kickCooldown = 0;
      p.basePose = null;
      // 차는 팀이 +X로 공격하는 것으로 두면 키퍼 판정(ownGoalX)이 그대로 맞는다
      p.attackDir = (p.team === this.turn ? this.dir : -this.dir) as 1 | -1;
    }
    // 나머지 선수는 센터 서클에서 지켜본다
    const watchers = m.players.filter((p) => p !== this.kicker && p !== this.keeper);
    watchers.forEach((p, i) => {
      const a = (i / watchers.length) * Math.PI - Math.PI / 2;
      p.pos.set(Math.cos(a) * 3 * (p.team === 0 ? 1 : 1.6), 0, Math.sin(a) * 7);
      p.faceTowards(this.spot.x, this.spot.z);
    });
    const k = this.kicker!;
    k.pos.copy(this.spot).add(tmp.set(-1.6 * this.dir, 0, 0));
    k.facing.set(this.dir, 0, 0);
    const g = this.keeper;
    g.pos.set(this.dir * (PITCH.halfL - 0.3), 0, 0);
    g.facing.set(-this.dir, 0, 0);
    m.keepers.reset();
    if (this.turn === 0) m.controlled = k;
    this.holdBall();
  }

  private holdBall(): void {
    const b = this.m.ball;
    b.owner = null;
    b.shot = null;
    b.body.position.set(this.spot.x, BALL.radius, this.spot.z);
    b.body.velocity.setZero();
    b.body.angularVelocity.setZero();
  }

  update(dt: number, cmd: UserCommand): void {
    const m = this.m;
    this.timer += dt;
    for (const p of m.players) {
      if (!p.busy) p.steer(tmp.set(0, 0, 0), false, false, dt);
      p.update(dt);
    }

    if (this.stage === 'ready') {
      this.holdBall();
      // 사용자는 배치 직후부터 게이지를 모을 수 있다 (누른 순간을 놓치지 않게)
      if (this.userKicking) {
        if (this.charge === null && cmd.shoot.pressed) this.charge = 0;
        if (this.charge !== null) {
          this.charge = Math.min(1, this.charge + dt / SHOT.chargeTime);
          if (cmd.shoot.released || !cmd.shoot.held) this.kick(this.charge, cmd.move.z, cmd);
        }
      } else if (this.timer > 1.8) {
        this.kick(0.45 + m.random.next() * 0.3, this.aiAim, cmd);
      }
      return;
    }

    if (this.stage === 'flight') {
      m.keepers.update(dt);
      m.stepWorld(dt);
      const bp = m.ball.position;
      const crossed = bp.x * this.dir > PITCH.halfL + BALL.radius;
      const scored = crossed && Math.abs(bp.z) < GOAL.width / 2 && bp.y < GOAL.height;
      const dead = crossed || m.ball.owner === this.keeper || this.timer > RULES.shootoutKickTime ||
        (this.timer > 0.6 && m.ball.speed() < 0.6) || (m.ball.velocity.x * this.dir < -1 && this.timer > 0.4);
      if (dead) {
        this.results[this.turn].push(scored);
        m.events.push({ type: 'penaltyKick', team: this.turn, scored, kicker: this.kicker! });
        this.stage = 'result';
        this.timer = 0;
      }
      return;
    }

    // result
    m.stepWorld(dt);
    if (this.timer < RULES.shootoutPause) return;
    if (shootoutDecided(this.results)) {
      m.finish();
      m.events.push({ type: 'shootoutEnd', score: this.score });
      return;
    }
    this.turn = (1 - this.turn) as 0 | 1;
    this.setupKick();
  }

  private kick(charge: number, aim: number, cmd: UserCommand): void {
    const m = this.m;
    const k = this.kicker!;
    this.charge = null;
    m.shoot(k, charge, false, penaltyAim(this.spot, this.dir, aim), true);
    const z = shotLineZ(this.spot, m.ball.velocity, this.dir);
    const userKeeper = this.turn === 1 && m.userControl;
    diveKeeper(this.keeper!, userKeeper ? sideFromInput(cmd.move.z) : keeperGuess(() => m.random.next(), this.keeper!, z));
    this.stage = 'flight';
    this.timer = 0;
  }
}
