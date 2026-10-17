import * as THREE from 'three';
import { selectMotion } from '../anim/MotionLibrary';
import { MOTION_CATALOG } from '../data/MotionCatalog';
import { visualRandom } from '../core/Random';

/** 키퍼 선방 클립 (GRF deflect) */
const KEEPER_CLIPS = MOTION_CATALOG.filter((e) => e.kind === 'keeper' && e.speed === 'idle');
import * as CANNON from 'cannon-es';
import { GOAL, KEEPER, PITCH } from '../config';
import { n } from '../data/Stats';
import type { Player } from '../entities/Player';
import { KeeperBody } from '../physics/KeeperBody';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { activePhysics, KEEPER_BODY } from '../physics/presets';
import type { Match } from './Match';

interface KeeperState {
  threatTime: number;
  holdTime: number;
  smotherRolled: boolean;
  blockUntil: number;
}

/** 손 선방은 능력치 판정, 몸통 블록은 물리 접촉으로 역할을 나눈다. */
export class Keepers {
  readonly bodies: KeeperBody[];
  private readonly states = new Map<Player, KeeperState>();

  constructor(private readonly m: Match, physics: PhysicsWorld) {
    this.bodies = m.teams.map((team) => new KeeperBody(team[0], physics));
    for (const { player, body } of this.bodies) {
      this.states.set(player, { threatTime: 0, holdTime: 0, smotherRolled: false, blockUntil: 0 });
      body.addEventListener('collide', (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
        if (!m.players.includes(player) || e.body !== m.ball.body || (m.phase !== 'playing' && m.phase !== 'shootout') || m.ball.owner?.team === player.team) return;
        const state = this.states.get(player)!;
        if (m.elapsed < state.blockUntil) return;
        const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
        if (speed < 1) return;
        state.blockUntil = m.elapsed + KEEPER_BODY.blockCooldown;
        if (m.ball.shot && m.ball.shot.by.team !== player.team) m.stats.onTarget[m.ball.shot.by.team]++;
        m.ball.owner = null;
        m.ball.lastTouch = player;
        m.ball.shot = null;
        m.passTarget = null;
        // 반사 속도는 건드리지 않는다. Cannon이 실제 접촉 법선과 키퍼 속도로 푼다.
        m.events.push({ type: 'keeperBlock', keeper: player, speed });
      });
    }
  }

  reset(): void {
    for (const b of this.bodies) {
      Object.assign(this.states.get(b.player)!, { threatTime: 0, holdTime: 0, smotherRolled: false, blockUntil: 0 });
      b.reset();
    }
  }

  onCatch(k: Player): void { this.states.get(k)!.holdTime = 0; }

  syncBodies(dt: number): void {
    const live = this.m.phase === 'playing' || this.m.phase === 'shootout';
    for (const b of this.bodies) b.sync(dt, this.m.players.includes(b.player) && live && this.m.ball.owner?.team !== b.player.team);
  }

  update(dt: number): void {
    for (const { player } of this.bodies) if (this.m.players.includes(player)) this.updateKeeper(player, dt);
  }

  private updateKeeper(k: Player, dt: number): void {
    const m = this.m, ball = m.ball, bp = ball.position, bv = ball.velocity;
    const a = k.attackDir, gx = m.ownGoalX(k.team), state = this.states.get(k)!;
    k.keeperAdvancing = false;
    if (ball.owner === k) {
      state.holdTime += dt;
      k.steer(new THREE.Vector3(), false, true, dt);
      k.faceTowards(k.pos.x + a, k.pos.z);
      if (state.holdTime > KEEPER.holdTime && !k.busy) {
        const target = m.teams[k.team].filter((p) => !p.isKeeper).sort((p, q) => m.openness(q) - m.openness(p))[0];
        // 키퍼만 남긴 연습에서는 받을 동료가 없으므로 공을 잡은 채 R 리셋을 기다린다.
        if (target) {
          // 가까운 동료는 던지고, 먼 동료는 드롭킥(로빙)
          const far = target.pos.distanceTo(k.pos) > 28;
          m.pass(k, target.pos.clone().sub(k.pos).setY(0).normalize(), far ? 'lob' : 'short', far ? 0.7 : 0.4);
          k.basePose = null;
        }
      }
      return;
    }

    this.trySmother(k);
    this.trySave(k);
    if (ball.owner === k || k.busy) return;
    k.basePose = null;
    const position = n(k.profile.stats.positioning ?? 60);
    const reflex = n(k.profile.stats.reflexes ?? 60);
    const diving = n(k.profile.stats.diving ?? 60);
    const dx = bp.x - gx, distance = Math.hypot(dx, bp.z);
    const depth = dx * a;
    const out = THREE.MathUtils.clamp(distance * (0.07 + 0.05 * position), 0.5, 3.2);
    const target = new THREE.Vector3(gx + dx / Math.max(distance, 0.001) * out, 0,
      THREE.MathUtils.clamp(bp.z / Math.max(distance, 0.001) * out, -GOAL.width / 2 + 0.3, GOAL.width / 2 - 0.3));
    let urgent = false;

    const opponent = ball.owner && ball.owner.team !== k.team ? ball.owner : null;
    const covering = opponent && m.teams[k.team].some((p) => !p.isKeeper && !p.busy &&
      (p.pos.x - opponent.pos.x) * a < 0 && p.pos.distanceTo(opponent.pos) < 5);
    const through = !ball.owner && !ball.shot && ball.lastTouch?.team !== k.team && bv.x * a < -3 && bp.y < 1.2;
    const threat = depth > 0 && depth < KEEPER.threatRange && Math.abs(bp.z) < PITCH.boxWidth / 2 &&
      (!!opponent && !covering || through);
    state.threatTime = threat ? state.threatTime + dt : 0;
    const manual = m.sides[k.team].keeperRush;
    const reacting = state.threatTime > KEEPER.reactionTime * (1.5 - reflex);
    if ((threat && reacting) || manual) {
      // 골문과 공을 잇는 선을 따라 각도를 좁히되 박스 밖까지 쫓아가지 않는다.
      const rushDepth = manual ? PITCH.boxDepth - 0.6 : Math.min(KEEPER.maxRushDepth, depth * (0.38 + 0.12 * position));
      target.set(gx + a * Math.max(0.5, Math.min(rushDepth, depth)), 0,
        THREE.MathUtils.clamp(bp.z * rushDepth / Math.max(depth, 1), -PITCH.boxWidth / 2 + 1, PITCH.boxWidth / 2 - 1));
      urgent = k.keeperAdvancing = true;
    }

    // 크로스는 내려오는 높이까지의 도착 시간과 주변 선수 수를 함께 본다.
    if (!ball.owner && !ball.shot && bp.y > 1.2) {
      const landing = m.predictBallAt(KEEPER.crossReach - 0.25);
      if (landing && m.inOwnBox(k, landing.x, landing.z)) {
        const t = (bv.y + Math.sqrt(Math.max(0, bv.y * bv.y + 2 * activePhysics().gravity * (bp.y - landing.y)))) / activePhysics().gravity;
        const d = Math.hypot(landing.x - k.pos.x, landing.z - k.pos.z);
        const crowd = this.crowd(k, landing.x, landing.z);
        if (d < KEEPER.crossRange * (0.7 + 0.3 * position) && d < KEEPER.speed * t + KEEPER.reach && crowd < 5) {
          target.copy(landing).setY(0);
          urgent = k.keeperAdvancing = true;
        }
      }
      if (this.tryCross(k)) return;
    }

    // 슛이 오면 공의 경로를 가로막고, 칩은 골라인으로 돌아가며 쫓는다.
    if (!ball.owner && ball.shot && bv.x * -a > 2.5) {
      const t = (gx - bp.x) / bv.x;
      const z = bp.z + bv.z * t;
      if (t > 0 && t < 2.5 && Math.abs(z) < GOAL.width / 2 + 0.8) {
        const tk = (k.pos.x - bp.x) / bv.x;
        const yk = bp.y + bv.y * Math.max(tk, 0) - activePhysics().gravity * Math.max(tk, 0) * Math.max(tk, 0) / 2; // ** 연산자는 엔진마다 결과가 다를 수 있어 곱셈으로
        target.x = yk > GOAL.height + 0.2 || tk < 0 ? gx + a * 0.6 : k.pos.x;
        target.z = THREE.MathUtils.clamp(bp.z + bv.z * Math.max(0, tk), -GOAL.width / 2 - 0.3, GOAL.width / 2 + 0.3);
        urgent = true;
        k.keeperAdvancing = false;
        const gap = target.z - k.pos.z;
        if (Math.abs(gap) > 0.9 && tk > 0.05 && tk < 0.25 + 0.35 * reflex && yk < KEEPER.crossReach) {
          const vz = THREE.MathUtils.clamp(gap / Math.max(tk, 0.15), -6 - 2 * diving, 6 + 2 * diving);
          const theta = Math.atan2(k.facing.x, k.facing.z);
          k.startDive(new THREE.Vector3(0, 0, vz), -Math.sin(theta) * Math.sign(vz) >= 0 ? 1 : -1);
        }
      }
    }

    const loose = !ball.owner && !ball.shot && bp.y < 1.2 && ball.speed() < 9 && m.inOwnBox(k, bp.x, bp.z);
    if (loose && m.closestToBall(k)) {
      target.set(bp.x, 0, bp.z);
      urgent = k.keeperAdvancing = true;
    }
    const gap = Math.hypot(bp.x - k.pos.x, bp.z - k.pos.z);
    if ((reacting || manual || loose) && bp.y < 0.8 && m.inOwnBox(k, bp.x, bp.z) &&
        gap < KEEPER.smotherRange * (0.8 + 0.3 * reflex) && gap > 0.4 && k.kickCooldown <= 0 && !ball.shot) {
      const direction = new THREE.Vector3(bp.x - k.pos.x, 0, bp.z - k.pos.z).normalize();
      state.smotherRolled = false;
      k.faceTowards(bp.x, bp.z);
      k.startDive(direction.multiplyScalar(4 + 3 * diving), bp.z >= k.pos.z ? 1 : -1, 'smother');
      return;
    }
    if (k.busy) return;
    const move = target.sub(k.pos).setY(0);
    const d = move.length();
    if (d > 0.1) move.multiplyScalar(Math.min(1, d / 1.2) / d);
    else move.set(0, 0, 0);
    const backpedal = move.x * a < 0 && !!ball.shot && bp.y > 2.2;
    k.sprinting = urgent;
    // 뒷걸음질(칩슛)은 앞으로 뛰는 것보다 느리지만 골문까지는 돌아갈 수 있어야 한다: 포지셔닝·민첩이 좋을수록 빠르게
    const back = 0.42 + 0.12 * position + 0.08 * n(k.profile.stats.agility ?? 60);
    k.steer(move, urgent, false, dt, KEEPER.speed / k.maxSpeed(false) * (0.88 + 0.22 * diving) * (backpedal ? back : 1));
    k.faceTowards(bp.x, bp.z);
  }

  private crowd(k: Player, x: number, z: number): number {
    return this.m.players.filter((p) => p !== k && Math.hypot(p.pos.x - x, p.pos.z - z) < KEEPER.crossCrowdRadius).length;
  }

  private tryCross(k: Player): boolean {
    const m = this.m, bp = m.ball.position;
    // 동료가 발로 준 공(백패스)은 손으로 잡을 수 없다
    if (!m.rules.keeperMayHandle(k)) return false;
    if (!m.inOwnBox(k, k.pos.x, k.pos.z) || !m.inOwnBox(k, bp.x, bp.z) || k.kickCooldown > 0 || m.ball.velocity.y > 1 ||
        bp.y < 1.2 || bp.y > KEEPER.crossReach || Math.hypot(bp.x - k.pos.x, bp.z - k.pos.z) > KEEPER.reach) return false;
    const handling = n(k.profile.stats.handling ?? 60);
    const crowd = this.crowd(k, bp.x, bp.z);
    const caught = crowd < 2 && m.ball.speed() < 12 + 7 * handling && m.random.next() < 0.45 + 0.5 * handling;
    if (caught) m.gainPossession(k);
    else this.parry(k, true);
    this.playSave(k, caught);
    m.events.push({ type: 'cross', keeper: k, caught }, { type: 'save', caught });
    return true;
  }

  private trySmother(k: Player): void {
    const m = this.m, state = this.states.get(k)!;
    if (!m.rules.keeperMayHandle(k)) return;
    if (k.diveTimer <= 0 || k.diveKind !== 'smother' || state.smotherRolled || m.ball.shot ||
        m.ball.owner?.team === k.team || m.ball.position.y > 0.8 || !m.inOwnBox(k, m.ball.position.x, m.ball.position.z)) return;
    const gap = Math.hypot(m.ball.position.x - k.pos.x, m.ball.position.z - k.pos.z);
    if (gap > 0.9 + 0.25 * n(k.profile.stats.diving ?? 60)) return;
    state.smotherRolled = true;
    const skill = n(k.profile.stats.handling ?? 60) * 0.55 + n(k.profile.stats.reflexes ?? 60) * 0.45;
    const caught = m.random.next() < THREE.MathUtils.clamp(0.35 + skill * 0.5 - m.ball.speed() * 0.012, 0.2, 0.9);
    if (caught) m.gainPossession(k);
    m.events.push({ type: 'smother', keeper: k, caught });
  }

  private parry(k: Player, cross = false): void {
    const b = this.m.ball, v = b.velocity;
    b.kick(new CANNON.Vec3(k.attackDir * (Math.abs(v.x) * 0.3 + (cross ? 8 : 3)),
      Math.abs(v.y) * 0.4 + (cross ? 5 : 2.5), v.z * 0.25 + this.m.random.gauss() * 5), new CANNON.Vec3(), k);
    b.shot = null;
    k.kickCooldown = 0.5;
  }

  /**
   * 머리 위로 넘어가는 공(칩슛·로빙 슛): 뒤로 점프해 손끝으로 크로스바 위로 쳐낸다.
   * 손이 닿는 높이(점프 포함 ~2.9m)·뒤로 넘어간 거리·반응·다이빙으로 성공률이 정해지고, 성공하면 골라인 밖(코너)으로 나간다.
   */
  /** 선방 동작 (화면용): 공 높이·방향과 잡기/쳐내기에 맞는 키퍼 클립. 다이빙 중이면 다이빙 동작을 그대로 둔다 */
  private playSave(k: Player, caught: boolean): void {
    if (k.diveTimer > 0) return;
    const bp = this.m.ball.position;
    const ballYaw = Math.atan2(bp.x - k.pos.x, bp.z - k.pos.z), bodyYaw = Math.atan2(k.facing.x, k.facing.z);
    const angle = Math.atan2(Math.sin(ballYaw - bodyYaw), Math.cos(ballYaw - bodyYaw));
    const pool = KEEPER_CLIPS.filter((e) => e.id.includes('holdball') === caught);
    const pick = selectMotion(pool, { kind: 'keeper', speed: 'idle', angle, height: bp.y, random: visualRandom.next() });
    if (pick) k.playMotion(pick.entry, Math.max(0, pick.entry.key - 0.12));
  }

  private tryTipOver(k: Player, shot: NonNullable<Match['ball']['shot']>, behind: number): void {
    const m = this.m, bp = m.ball.position, bv = m.ball.velocity;
    if (shot.tipRolled || k.busy || behind > 1.4 || bp.y < 1.6 || bp.y > KEEPER.jumpReach || bv.y > 2) return;
    if (Math.abs(bp.z - k.pos.z) > 1.3) return;
    shot.tipRolled = true;
    const gs = k.profile.stats;
    const chance = THREE.MathUtils.clamp(0.2 + 0.35 * n(gs.reflexes ?? 60) + 0.25 * n(gs.diving ?? 60) - behind * 0.3 - (bp.y - 2.2) * 0.4, 0.05, 0.75);
    if (m.random.next() > chance) {
      k.playAction('header', 0.5);
      return;
    }
    this.playSave(k, false);
    m.stats.onTarget[shot.by.team]++;
    // 위로·뒤로 쳐서 크로스바를 넘긴다
    m.ball.kick(new CANNON.Vec3(bv.x * 0.6, Math.abs(bv.y) * 0.3 + 4.5, bv.z * 0.4), new CANNON.Vec3(), k);
    m.ball.shot = null;
    k.kickCooldown = 0.6;
    m.events.push({ type: 'save', caught: false });
  }

  private trySave(k: Player): void {
    const shot = this.m.ball.shot;
    if (!shot || shot.saveRolled || shot.by.team === k.team || this.m.ball.owner) return;
    const bp = this.m.ball.position;
    if (!this.m.inOwnBox(k, bp.x, bp.z) || !this.m.inOwnBox(k, k.pos.x, k.pos.z)) return;
    const maxHeight = k.diveTimer > 0 && k.diveKind === 'smother' ? 0.85 : GOAL.height + 0.2;
    if (bp.y > maxHeight) return;
    // 이미 키퍼 머리 위로 넘어간 공(칩슛)은 손이 닿지 않는다
    const gx = this.m.ownGoalX(k.team);
    const behind = Math.abs(gx - k.pos.x) - Math.abs(gx - bp.x);
    if (behind > 0.35) {
      this.tryTipOver(k, shot, behind);
      return;
    }
    const gs = k.profile.stats;
    const reach = k.diveTimer > 0 ? KEEPER.diveReach * (0.85 + 0.25 * n(gs.diving ?? 60)) : KEEPER.reach;
    // 다이빙 중에는 몸이 옆으로 누워 있으므로 손 위치는 다이빙 방향
    const hx = k.pos.x + (k.diveTimer > 0 ? k.diveVel.x * 0.12 : 0);
    const hz = k.pos.z + (k.diveTimer > 0 ? Math.sign(k.diveVel.z) * 0.6 : 0);
    // 다이빙은 옆으로 팔을 뻗는 동작이다. 앞뒤로도 같은 원형 범위를 주면
    // 전진한 키퍼가 발밑 슛까지 수 미터 앞에서 순간적으로 잡아 버린다.
    const forward = (bp.x - hx) * k.facing.x + (bp.z - hz) * k.facing.z;
    const lateral = -(bp.x - hx) * k.facing.z + (bp.z - hz) * k.facing.x;
    const d = Math.hypot(forward / 0.8, lateral / reach) * KEEPER.reach;
    if (d > KEEPER.reach) return;

    shot.saveRolled = true;
    const speed = this.m.ball.speed();
    const placement = Math.min(1, Math.abs(bp.z) / (GOAL.width / 2)); // 구석일수록 어렵다
    const curling = Math.abs(this.m.ball.body.angularVelocity.y) > 8 ? 0.12 : 0;
    // 위에서 떨어지는 공은 잡기 어렵다
    const dropping = this.m.ball.velocity.y < -3 ? 0.3 : 0;
    const chance = THREE.MathUtils.clamp(
      1.28 - speed / 30 - placement * 0.45 - curling - dropping - (d > KEEPER.reach ? 0.12 : 0) +
        (n(gs.reflexes ?? 60) - 0.7) * 0.4 + (n(gs.positioning ?? 60) - 0.7) * 0.15,
      0.15,
      0.95,
    );
    if (this.m.random.next() > chance) return; // 실점!
    this.m.stats.onTarget[shot.by.team]++;

    // GK 핸들링이 좋을수록 빠른 슛도 잡아낸다 (아니면 쳐낸다)
    const handling = n(gs.handling ?? 60);
    if (speed < 13 + 7 * handling && this.m.random.next() < 0.45 + 0.45 * handling) {
      this.playSave(k, true);
      this.m.gainPossession(k);
      this.m.events.push({ type: 'save', caught: true });
    } else {
      this.playSave(k, false);
      this.parry(k);
      this.m.events.push({ type: 'save', caught: false });
    }
  }

}
