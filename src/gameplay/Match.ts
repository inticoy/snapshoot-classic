import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BALL, GOAL, KEEPER, MATCH, PASS, PITCH, PLAYER, SHOT } from '../config';
import { Ball } from '../entities/Ball';
import { Goal } from '../entities/Goal';
import { Player } from '../entities/Player';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { TeamAI } from '../ai/TeamAI';

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

/** 사용자 입력을 월드 좌표로 변환한 명령 */
export interface UserCommand {
  move: THREE.Vector3; // XZ, 크기 0..1
  sprint: boolean;
  shootHeld: boolean;
  shootPressed: boolean;
  shootReleased: boolean;
  finesseHeld: boolean;
  finessePressed: boolean;
  finesseReleased: boolean;
  passPressed: boolean;
  switchPressed: boolean;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const cv = new CANNON.Vec3();
const cspin = new CANNON.Vec3();

export function gauss(): number {
  // Box-Muller
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Match {
  readonly players: Player[] = [];
  readonly teams: [Player[], Player[]] = [[], []];
  readonly ball: Ball;
  readonly goals: [Goal, Goal];
  readonly score: [number, number] = [0, 0];
  readonly events: MatchEvent[] = [];
  readonly ai: TeamAI;

  phase: Phase = 'kickoff';
  phaseTimer = 0;
  clock = 0; // 경기 진행 시간 (실제 초)
  controlled: Player;
  /** 슛/감아차기 차지 (0..1), 차지 중이 아니면 null */
  charge: { kind: 'shoot' | 'finesse'; value: number } | null = null;
  passTarget: Player | null = null;
  lastScorer: Player | null = null;
  private kickoffTeam: 0 | 1 = 0;
  private keeperHold = 0;
  private dribbleTouch = 0;

  constructor(private readonly physics: PhysicsWorld) {
    this.ball = new Ball(physics);
    // goals[0] = 홈팀이 공격하는 +X 골대, goals[1] = -X 골대
    this.goals = [new Goal(1, physics), new Goal(-1, physics)];

    const roster: [Player['role'], number, string][] = [
      ['GK', 1, 'Keeper'],
      ['DEF', 4, 'Defender'],
      ['FWD', 9, 'Striker'],
    ];
    for (const team of [0, 1] as const) {
      for (const [role, num, name] of roster) {
        const p = new Player(team, role, team === 0 ? num : num + 10, name);
        this.players.push(p);
        this.teams[team].push(p);
      }
    }
    this.controlled = this.teams[0][2];
    this.ai = new TeamAI(this);
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
        if (this.clock >= MATCH.durationSeconds) {
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
    const hasBall = this.ball.owner === p;

    // 선수 전환: 공에 가장 가까운 (키퍼 제외) 팀원으로
    if (cmd.switchPressed || (cmd.passPressed && !hasBall && this.ball.owner?.team !== 0)) {
      this.switchToNearest();
    }

    // 패스 받는 중이고 입력이 없으면 공 쪽으로 자동으로 다가간다
    const move = cmd.move.clone();
    if (move.lengthSq() < 0.01 && this.passTarget === p && !this.ball.owner) {
      tmp.set(this.ball.position.x - p.pos.x, 0, this.ball.position.z - p.pos.z);
      if (tmp.length() > 0.6) move.copy(tmp.normalize()).multiplyScalar(0.8);
    }
    if (!p.busy) p.steer(move, cmd.sprint, hasBall, dt);

    // 차지 슛 (J / Space) & 감아차기 (L)
    if (hasBall) {
      if (cmd.shootPressed) this.charge = { kind: 'shoot', value: 0 };
      if (cmd.finessePressed) this.charge = { kind: 'finesse', value: 0 };
    }
    if (this.charge) {
      const held = this.charge.kind === 'shoot' ? cmd.shootHeld : cmd.finesseHeld;
      const released = this.charge.kind === 'shoot' ? cmd.shootReleased : cmd.finesseReleased;
      this.charge.value = Math.min(1, this.charge.value + dt / SHOT.chargeTime);
      if (this.ball.owner !== p) {
        this.charge = null; // 차는 도중 공을 뺏김
      } else if (released || !held) {
        this.shoot(p, this.charge.value, this.charge.kind === 'finesse', cmd.move);
        this.charge = null;
      }
    }

    if (hasBall && cmd.passPressed && !this.charge) {
      this.pass(p, cmd.move.lengthSq() > 0.01 ? cmd.move : p.facing);
    }

    // 공이 없을 때 J = 태클
    if (!hasBall && cmd.shootPressed && !p.busy && p.tackleCooldown <= 0) {
      const dir = cmd.move.lengthSq() > 0.01 ? cmd.move.clone() : p.facing.clone();
      // 상대 공 소유자를 향해 약간 보정
      if (this.ball.owner && this.ball.owner.team !== p.team) {
        tmp.copy(this.ball.owner.pos).sub(p.pos).setY(0);
        if (tmp.length() < 3.5) dir.lerp(tmp.normalize(), 0.6).normalize();
      }
      p.startTackle(dir);
    }
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

  /**
   * 슛. charge 0..1, aim = 입력 방향 (없으면 골문 중앙 근처).
   * 파워가 너무 세면 공이 뜬다 (FIFA식).
   */
  shoot(p: Player, charge: number, finesse: boolean, aim: THREE.Vector3): void {
    const goalX = this.oppGoalX(p.team);
    const bp = this.ball.position;
    const hw = GOAL.width / 2;
    const toGoalX = goalX - bp.x;

    let targetZ: number;
    let targetX = goalX;
    const dir = aim.lengthSq() > 0.01 ? aim.clone().normalize() : null;
    if (dir && dir.x * p.attackDir > 0.15) {
      const t = toGoalX / dir.x;
      targetZ = THREE.MathUtils.clamp(bp.z + dir.z * t, -hw - 1.5, hw + 1.5);
    } else if (dir && dir.x * p.attackDir <= 0.15 && Math.abs(toGoalX) > 25) {
      // 골대 반대쪽을 보고 차면 그냥 그 방향으로 걷어낸다
      targetX = bp.x + dir.x * 30;
      targetZ = bp.z + dir.z * 30;
    } else {
      // 입력이 없으면 먼 쪽 포스트를 노린다
      targetZ = (bp.z > 0 ? -1 : 1) * (hw - 0.9) * (0.3 + Math.random() * 0.7);
    }

    if (finesse) {
      // 감아차기는 먼 쪽 포스트 안쪽
      const side = dir && Math.abs(dir.z) > 0.25 ? Math.sign(dir.z) : bp.z > 0 ? -1 : 1;
      targetZ = side * (hw - 0.55);
    }

    // 정확도: 파워가 셀수록, 스프린트 중일수록, 압박받을수록 흔들린다
    const pressure = this.nearestOpponentDist(p) < 1.6 ? 0.35 : 0;
    const spread = (finesse ? 0.25 : 0.2) + 0.9 * charge * charge + (p.sprinting ? 0.35 : 0) + pressure;
    targetZ += gauss() * spread;

    const speed = finesse
      ? SHOT.finesseMinSpeed + (SHOT.finesseMaxSpeed - SHOT.finesseMinSpeed) * charge
      : SHOT.minSpeed + (SHOT.maxSpeed - SHOT.minSpeed) * charge;
    const targetY = THREE.MathUtils.clamp(
      // 80% 이상 차지하면 급격히 뜬다 (크로스바 위로 넘어갈 위험)
      (finesse ? 0.9 : 0.3) + 1.6 * charge * charge + Math.max(0, charge - 0.8) * 9 + gauss() * spread * 0.4,
      0.15,
      6,
    );

    const target = new THREE.Vector3(targetX, targetY, targetZ);
    const horiz = new THREE.Vector3(target.x - bp.x, 0, target.z - bp.z);
    const dist = horiz.length();
    horiz.normalize();
    // 공기 저항으로 느려지는 만큼 비행 시간을 늘려 잡는다
    const T = (dist / speed) * (1 + dist * 0.008);
    const g = -this.physics.world.gravity.y;

    let launchDir = horiz.clone();
    cspin.set(0, 0, 0);
    if (finesse) {
      // 마그누스 횡가속도만큼 반대쪽으로 겨냥하고, 회전으로 휘어 들어오게
      const aLat = (BALL.magnus * SHOT.finesseSpin * speed) / BALL.mass;
      const offset = Math.min(3.5, 0.5 * aLat * T * T * 0.8);
      const lateral = new THREE.Vector3(-horiz.z, 0, horiz.x); // horiz 기준 왼쪽
      const curlSide = Math.sign(targetZ - bp.z) * Math.sign(lateral.z) || 1;
      // 목표에서 바깥쪽으로 offset 만큼 밀어서 출발
      const aimPoint = target.clone().addScaledVector(lateral, -curlSide * offset);
      launchDir = new THREE.Vector3(aimPoint.x - bp.x, 0, aimPoint.z - bp.z).normalize();
      // F = s * (vz, 0, -vx) 가 lateral*curlSide 쪽을 향하도록 부호 결정
      const fx = launchDir.z, fz = -launchDir.x;
      const s = Math.sign(fx * lateral.x * curlSide + fz * lateral.z * curlSide) || 1;
      cspin.set(0, s * SHOT.finesseSpin, 0);
    }

    const vy = (targetY - bp.y + 0.5 * g * T * T) / T;
    cv.set(launchDir.x * speed, Math.max(0.5, vy), launchDir.z * speed);
    this.kickBall(p, cv, cspin);
    this.ball.newShot(p);
    this.passTarget = null;
  }

  pass(p: Player, dir: THREE.Vector3): void {
    const d = dir.clone().setY(0).normalize();
    let best: Player | null = null;
    let bestScore = Infinity;
    for (const m of this.teams[p.team]) {
      if (m === p) continue;
      tmp.copy(m.pos).sub(p.pos).setY(0);
      const dist = tmp.length();
      if (dist < 2) continue;
      const angle = tmp.normalize().angleTo(d);
      if (angle > 1.25) continue;
      // 키퍼에게 백패스는 정말 그 방향일 때만
      const keeperPenalty = m.isKeeper ? 1.2 : 0;
      const score = angle * 2.2 + dist * 0.03 + keeperPenalty + this.laneBlocked(p, m) * 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }

    const bp = this.ball.position;
    let tx: number, tz: number, dist: number, speed: number;
    if (best) {
      dist = best.pos.distanceTo(tmp.set(bp.x, 0, bp.z));
      speed = THREE.MathUtils.clamp(6 + dist * 0.72, PASS.minSpeed, PASS.maxSpeed);
      // 받는 선수가 뛰는 방향으로 리드
      const lead = (dist / speed) * 0.85;
      tx = best.pos.x + best.vel.x * lead;
      tz = best.pos.z + best.vel.z * lead;
    } else {
      // 받을 사람이 없으면 그 방향 빈 공간으로
      dist = 12;
      speed = 13;
      tx = bp.x + d.x * dist;
      tz = bp.z + d.z * dist;
    }
    tmp2.set(tx - bp.x, 0, tz - bp.z).normalize();
    // 긴 패스는 살짝 띄운다
    const lift = dist > 22 ? 3.2 : dist > 14 ? 1.2 : 0.4;
    cv.set(tmp2.x * speed, lift, tmp2.z * speed);
    this.kickBall(p, cv, cspin.set(0, 0, 0));
    this.ball.shot = null;
    this.passTarget = best;
    if (best && p.team === 0 && !best.isKeeper) this.controlled = best;
  }

  private kickBall(p: Player, vel: CANNON.Vec3, spin: CANNON.Vec3): void {
    // 공을 찬 발 쪽 결정 (공이 몸의 오른쪽인지 왼쪽인지)
    tmp.set(this.ball.position.x - p.pos.x, 0, this.ball.position.z - p.pos.z);
    const right = new THREE.Vector3(-p.facing.z, 0, p.facing.x);
    p.facing.set(vel.x, 0, vel.z).normalize();
    p.playAction('kick', 0.4, {
      side: tmp.dot(right) > 0 ? -1 : 1,
    });
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
    const reach = PLAYER.dribbleOffset + (o.sprinting ? 0.3 : 0) + Math.max(0, Math.sin(this.dribbleTouch * Math.PI)) * 0.08 * Math.min(1, speed / 3);
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
      if (d > PLAYER.tackleRange || bp.y > 0.8) continue;
      if (o && o.team !== p.team) {
        // 정면 태클이 성공률이 높다
        const facingDot = -o.facing.dot(p.tackleDir);
        const chance = 0.42 + 0.33 * Math.max(0, facingDot);
        const success = Math.random() < chance;
        p.tackleResolved = true;
        p.tackleTimer = Math.min(p.tackleTimer, 0.08);
        this.events.push({ type: 'tackle', success });
        if (success) {
          o.stunned = 0.55;
          o.basePose = null;
          this.ball.owner = null;
          cv.set(p.tackleDir.x * 5 + gauss(), 0.6, p.tackleDir.z * 5 + gauss());
          this.ball.kick(cv, cspin.set(0, 0, 0), p);
          p.kickCooldown = 0.12;
          if (o.team === 0) this.charge = null;
        } else {
          p.kickCooldown = 0.4;
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
      this.footPoint(p, tmp);
      const d = Math.hypot(bp.x - tmp.x, bp.z - tmp.z);
      if (d > PLAYER.controlRadius) continue;
      // 너무 빠른 공은 트래핑 실패 (몸에 맞고 튕김)
      const rel = Math.hypot(bv.x - p.vel.x, bv.z - p.vel.z);
      if (rel > 19) continue;
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    if (!best) return;
    this.ball.owner = best;
    this.ball.lastTouch = best;
    this.ball.shot = null;
    this.passTarget = null;
    if (best.team === 0 && !best.isKeeper) this.controlled = best;
    if (best.isKeeper) {
      this.keeperHold = 0;
      if (this.inOwnBox(best, bp.x, bp.z)) {
        best.basePose = 'hold';
        this.ball.body.position.y = Math.max(bp.y, 0.6);
      }
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
        // 공을 가진 선수가 조금 더 버틴다
        const wa = this.ball.owner === a ? 0.35 : this.ball.owner === b ? 1.65 : 1;
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
      const out = THREE.MathUtils.clamp(dist * 0.1, 0.5, 3.2);
      targetX = gx + (dx / dist) * out;
      targetZ = (dz / dist) * out;
      targetZ = THREE.MathUtils.clamp(targetZ, -GOAL.width / 2 + 0.3, GOAL.width / 2 - 0.3);

      // 3) 박스 안의 느린 공은 직접 처리하러 나간다
      const loose = !this.ball.owner && this.ball.speed() < 9 && this.inOwnBox(k, bp.x, bp.z);
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
    k.steer(tmp, urgent, false, dt, KEEPER.speed / PLAYER.jogSpeed);
    // 키퍼는 항상 공을 바라본다
    if (!urgent || d < 1) k.faceTowards(bp.x, bp.z);
  }

  private trySave(k: Player): void {
    const shot = this.ball.shot;
    if (!shot || shot.saveRolled || shot.by.team === k.team || this.ball.owner) return;
    const bp = this.ball.position;
    if (bp.y > GOAL.height + 0.35) return;
    const reach = k.diveTimer > 0 ? KEEPER.diveReach : KEEPER.reach;
    // 다이빙 중에는 몸이 옆으로 누워 있으므로 손 위치는 다이빙 방향
    const hx = k.pos.x + (k.diveTimer > 0 ? k.diveVel.x * 0.12 : 0);
    const hz = k.pos.z + (k.diveTimer > 0 ? Math.sign(k.diveVel.z) * 0.6 : 0);
    const d = Math.hypot(bp.x - hx, bp.z - hz);
    if (d > reach) return;

    shot.saveRolled = true;
    const speed = this.ball.speed();
    const placement = Math.min(1, Math.abs(bp.z) / (GOAL.width / 2)); // 구석일수록 어렵다
    const curling = Math.abs(this.ball.body.angularVelocity.y) > 8 ? 0.12 : 0;
    const chance = THREE.MathUtils.clamp(
      1.2 - speed / 30 - placement * 0.45 - curling - (d > KEEPER.reach ? 0.12 : 0),
      0.15,
      0.95,
    );
    if (Math.random() > chance) return; // 실점!

    const a = k.attackDir;
    if (speed < 17 && Math.random() < 0.75) {
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
    this.clock = 0;
    this.lastScorer = null;
    for (const p of this.players) p.stamina = 1;
    this.startKickoff(0);
  }
}
