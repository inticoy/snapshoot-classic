import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PITCH, PLAYER, TEAM_COLORS } from '../config';
import { PlayerModel, type AnimState } from './PlayerModel';
import type { PlayerProfile } from '../data/Teams';

export type Role = 'GK' | 'DEF' | 'FWD';

export class Player {
  readonly model: PlayerModel;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  /** 바라보는 방향 (단위 벡터, XZ 평면) */
  readonly facing = new THREE.Vector3(1, 0, 0);
  /** 물리 엔진과 주고받기 위한 속도 사본 */
  readonly cannonVel = new CANNON.Vec3();

  stamina = 1;
  sprinting = false;
  kickCooldown = 0;
  tackleTimer = 0;
  tackleCooldown = 0;
  /** 이번 태클이 이미 판정됐는지 (한 번의 태클 = 한 번의 판정) */
  tackleResolved = false;
  tackleKind: 'slide' | 'stand' = 'slide';
  stunned = 0;
  diveTimer = 0;
  /** 액션 중에는 이동 입력을 무시 */
  actionLock = 0;
  readonly tackleDir = new THREE.Vector3();
  readonly diveVel = new THREE.Vector3();
  /** 이동 중이 아닐 때 기본 자세 (키퍼 공 잡기, 세리머니) */
  basePose: AnimState | null = null;
  private animTimer = 0;

  constructor(
    readonly team: 0 | 1,
    readonly role: Role,
    readonly number: number,
    readonly name: string,
    readonly profile: PlayerProfile,
  ) {
    const c = TEAM_COLORS[team];
    this.model = new PlayerModel(
      { shirt: role === 'GK' ? c.keeper : c.shirt, shorts: c.shorts, socks: role === 'GK' ? c.keeper : c.socks },
      number,
    );
  }

  /** 팀이 공격하는 방향 (+1 = +X) */
  get attackDir(): 1 | -1 {
    return this.team === 0 ? 1 : -1;
  }

  get isKeeper(): boolean {
    return this.role === 'GK';
  }

  get busy(): boolean {
    return this.tackleTimer > 0 || this.stunned > 0 || this.diveTimer > 0 || this.actionLock > 0;
  }

  maxSpeed(hasBall: boolean): number {
    let s = this.sprinting && this.stamina > 0.05 ? PLAYER.sprintSpeed : PLAYER.jogSpeed;
    // 스태미나가 떨어지면 느려진다
    s *= 0.8 + 0.2 * Math.min(1, this.stamina * 2);
    if (hasBall) s *= PLAYER.dribbleSpeedFactor;
    return s;
  }

  /**
   * 원하는 방향(크기 0..1)으로 가속. 실제 축구 게임처럼 관성이 있어서
   * 급격한 방향 전환은 감속 → 가속으로 이어진다.
   */
  steer(desired: THREE.Vector3, sprint: boolean, hasBall: boolean, dt: number, speedScale = 1): void {
    this.sprinting = sprint && desired.lengthSq() > 0.01;
    const target = desired.clone().multiplyScalar(this.maxSpeed(hasBall) * speedScale);
    const diff = target.sub(this.vel);
    const rate = desired.lengthSq() > 0.01 ? PLAYER.accel : PLAYER.decel;
    const maxDelta = rate * dt;
    if (diff.length() > maxDelta) diff.setLength(maxDelta);
    this.vel.add(diff);

    if (this.sprinting) this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
    else this.stamina = Math.min(1, this.stamina + PLAYER.staminaRegen * dt);
  }

  update(dt: number): void {
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    this.tackleCooldown = Math.max(0, this.tackleCooldown - dt);
    this.stunned = Math.max(0, this.stunned - dt);
    this.actionLock = Math.max(0, this.actionLock - dt);

    if (this.tackleTimer > 0) {
      this.tackleTimer -= dt;
      const slide = this.tackleKind === 'slide';
      const k = Math.max(0, this.tackleTimer / (slide ? PLAYER.tackleDuration : PLAYER.standTackleDuration));
      this.vel.copy(this.tackleDir).multiplyScalar((slide ? PLAYER.tackleSpeed : PLAYER.standTackleSpeed) * (0.3 + 0.7 * k));
      if (this.tackleTimer <= 0) {
        this.stunned = slide ? 0.35 : 0.08; // 일어나는 시간
        this.vel.multiplyScalar(slide ? 0.3 : 0.6);
      }
    }
    if (this.diveTimer > 0) {
      this.diveTimer -= dt;
      this.vel.copy(this.diveVel);
      this.diveVel.multiplyScalar(Math.exp(-3 * dt));
      if (this.diveTimer <= 0) {
        this.stunned = 0.45;
        this.vel.set(0, 0, 0);
      }
    }
    if (this.stunned > 0 && this.tackleTimer <= 0 && this.diveTimer <= 0) {
      this.vel.multiplyScalar(Math.exp(-8 * dt));
    }

    this.pos.addScaledVector(this.vel, dt);
    this.clampToArena();

    // 이동 방향으로 몸을 돌린다
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.4 && this.tackleTimer <= 0 && this.diveTimer <= 0) {
      const targetAngle = Math.atan2(this.vel.x, this.vel.z);
      const cur = Math.atan2(this.facing.x, this.facing.z);
      let d = targetAngle - cur;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = THREE.MathUtils.clamp(d, -PLAYER.turnRate * dt, PLAYER.turnRate * dt);
      const a = cur + turn;
      this.facing.set(Math.sin(a), 0, Math.cos(a));
    }
    this.cannonVel.set(this.vel.x, 0, this.vel.z);
  }

  faceTowards(x: number, z: number): void {
    const d = new THREE.Vector3(x - this.pos.x, 0, z - this.pos.z);
    if (d.lengthSq() > 1e-4) this.facing.copy(d.normalize());
  }

  startTackle(dir: THREE.Vector3, kind: 'slide' | 'stand' = 'slide'): void {
    this.tackleDir.copy(dir).setY(0).normalize();
    this.facing.copy(this.tackleDir);
    this.tackleKind = kind;
    this.tackleResolved = false;
    if (kind === 'slide') {
      this.tackleTimer = PLAYER.tackleDuration;
      this.tackleCooldown = PLAYER.tackleCooldown;
      this.model.play('tackle');
    } else {
      this.tackleTimer = PLAYER.standTackleDuration;
      this.tackleCooldown = PLAYER.standTackleCooldown;
      this.model.play('kick', { side: 1 });
    }
  }

  get tackleRange(): number {
    return this.tackleKind === 'slide' ? PLAYER.tackleRange : PLAYER.standTackleRange;
  }

  startDive(vel: THREE.Vector3, localSide: 1 | -1): void {
    this.diveVel.copy(vel);
    this.diveTimer = 0.55;
    this.model.play('dive', { side: localSide });
  }

  private clampToArena(): void {
    const mx = PITCH.halfL + PITCH.runoffEnd - 0.6;
    const mz = PITCH.halfW + PITCH.runoffSide - 0.6;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -mx, mx);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -mz, mz);
    // 골대 안쪽(그물 뒤)으로는 못 들어간다
    if (Math.abs(this.pos.x) > PITCH.halfL + 0.2 && Math.abs(this.pos.z) < 3.6) {
      this.pos.x = Math.sign(this.pos.x) * (PITCH.halfL + 0.2);
    }
  }

  /** 일회성 동작 재생 (킥 등). duration 동안 기본 동작으로 돌아가지 않는다 */
  playAction(state: AnimState, duration: number, opts: { side?: 1 | -1 } = {}): void {
    this.model.play(state, opts);
    this.animTimer = duration;
  }

  syncVisual(dt: number): void {
    this.model.root.position.set(this.pos.x, 0, this.pos.z);
    this.model.root.rotation.y = Math.atan2(this.facing.x, this.facing.z);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.model.setLocomotion(speed, this.sprinting);

    this.animTimer = Math.max(0, this.animTimer - dt);
    const inAction = this.animTimer > 0 || this.tackleTimer > 0 || this.diveTimer > 0 || this.stunned > 0;
    if (!inAction) {
      const base: AnimState = this.basePose ?? (speed > 0.6 ? 'run' : 'idle');
      if (this.model.current !== base) this.model.play(base);
    }
    this.model.update(dt);
  }
}
