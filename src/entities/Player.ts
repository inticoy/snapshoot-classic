import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GOAL, KEEPER, PITCH, PLAYER, TEAM_COLORS, VISUAL } from '../config';
import { PlayerModel, type AnimState, type CharacterModel, type ModelColors } from './PlayerModel';
import { SkinnedPlayerModel, hasCharacterAsset } from './SkinnedPlayerModel';
import type { PlayerProfile } from '../data/Teams';
import type { Role, Slot } from '../data/Formation';

export type { Role };
import { n, type OutfieldStats } from '../data/Stats';
import { appearance, backName } from '../data/Appearance';
import { visualRandom } from '../core/Random';
import { pickMotion, speedClass } from '../gameplay/Motions';
import type { MotionEntry } from '../anim/MotionLibrary';


export type PlayerModelFactory = (colors: ModelColors, number: number, keeper: boolean) => CharacterModel;

export const createPlayerModel: PlayerModelFactory = (colors, number, keeper) =>
  hasCharacterAsset() ? new SkinnedPlayerModel(colors, keeper) : new PlayerModel(colors, number);

export class Player {
  readonly model: CharacterModel;
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
  diveKind: 'save' | 'smother' = 'save';
  diveSide: 1 | -1 = 1;
  keeperAdvancing = false;
  /** 개인기에 속아 몸을 잘못 실은 남은 시간과 그 방향 */
  wrongFoot = 0;
  readonly baitDir = new THREE.Vector3();
  /** 액션 중에는 이동 입력을 무시 */
  actionLock = 0;
  readonly tackleDir = new THREE.Vector3();
  readonly diveVel = new THREE.Vector3();
  /** 이동 중이 아닐 때 기본 자세 (키퍼 공 잡기, 세리머니) */
  basePose: AnimState | null = null;
  private animTimer = 0;
  private visualTime = 0;
  private visualYaw: number | null = null;
  private shadowEnabled: boolean | null = null;

  constructor(
    readonly team: 0 | 1,
    readonly role: Role,
    readonly number: number,
    readonly name: string,
    readonly profile: PlayerProfile,
    /** 포메이션상 기본 위치 */
    readonly slot: Slot,
    modelFactory: PlayerModelFactory = createPlayerModel,
  ) {
    this.attackDir = team === 0 ? 1 : -1;
    const c = TEAM_COLORS[team];
    const keeper = role === 'GK';
    const look = appearance(profile.name);
    const colors: ModelColors = {
      shirt: keeper ? c.keeper : c.shirt,
      shorts: c.shorts,
      socks: keeper ? c.keeper : c.socks,
      skin: look.skin,
      hair: look.hair,
      hairStyle: look.hairStyle,
      style: keeper ? 0 : c.style,
      trim: c.trim,
      keeper,
      gloves: c.gloves,
      decal: {
        number,
        name: backName(profile.short),
        ink: keeper ? c.keeperInk : c.ink,
        inkEdge: keeper ? 'rgba(255, 255, 255, 0.55)' : c.inkEdge,
        look,
      },
    };
    // 캐릭터 에셋이 로드됐으면 스킨드 캐릭터, 아니면 절차적 모델로 대체
    this.model = modelFactory(colors, number, role === 'GK');
  }

  /** 팀이 공격하는 방향 (+1 = +X). 후반에 진영을 바꾸면 Match가 뒤집는다 */
  attackDir: 1 | -1 = 1;
  /** 킥 동작 중에는 몸 방향을 이동 방향으로 돌리지 않는다 (동작이 정한 방향 유지) */
  facingLock = 0;
  private celebrating = false;
  /** 이번 경기 경고 수와 퇴장 여부 */
  yellows = 0;
  sentOff = false;

  get isKeeper(): boolean {
    return this.role === 'GK';
  }

  get busy(): boolean {
    return this.tackleTimer > 0 || this.stunned > 0 || this.diveTimer > 0 || this.actionLock > 0;
  }

  /** 능력치 0..1 */
  stat(key: keyof OutfieldStats): number {
    return n(this.profile.stats[key]);
  }

  maxSpeed(hasBall: boolean): number {
    // 속력: 질주 최고 속도 (능력치 70 ≈ 7.6 m/s, 90 ≈ 8.4 m/s)
    const sprint = PLAYER.sprintSpeed - 1.3 + 2.2 * this.stat('sprintSpeed');
    let s = this.sprinting && this.stamina > 0.05 ? sprint : sprint * 0.72;
    // 스태미나가 떨어지면 느려진다
    s *= 0.8 + 0.2 * Math.min(1, this.stamina * 2);
    // 드리블: 공을 가지고 뛸 때 속도 손실
    if (hasBall) s *= PLAYER.dribbleSpeedFactor - 0.08 + 0.13 * this.stat('dribbling');
    return s;
  }

  /**
   * 원하는 방향(크기 0..1)으로 가속. 실제 축구 게임처럼 관성이 있어서
   * 급격한 방향 전환은 감속 → 가속으로 이어진다.
   */
  steer(desired: THREE.Vector3, sprint: boolean, hasBall: boolean, dt: number, speedScale = 1): void {
    this.sprinting = sprint && desired.lengthSq() > 0.01;
    const target = desired.clone().multiplyScalar(this.maxSpeed(hasBall) * speedScale);
    if (this.wrongFoot > 0) {
      // 개인기에 속은 동안: 원래 가려던 방향 대신 속은 쪽으로 몸이 쏠리고, 다시 가속하기까지 느리다
      this.wrongFoot = Math.max(0, this.wrongFoot - dt);
      target.multiplyScalar(0.25).addScaledVector(this.baitDir, this.maxSpeed(false) * 0.55);
    }
    const diff = target.sub(this.vel);
    // 가속력: 출발/방향 전환 시 가속
    const rate = desired.lengthSq() > 0.01 ? PLAYER.accel - 5 + 10 * this.stat('acceleration') : PLAYER.decel;
    const maxDelta = rate * dt;
    if (diff.length() > maxDelta) diff.setLength(maxDelta);
    this.vel.add(diff);

    // 스태미너: 질주 시 소모 속도
    const drain = PLAYER.staminaDrain * (1.35 - 0.7 * this.stat('stamina'));
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - drain * dt);
    else this.stamina = Math.min(1, this.stamina + PLAYER.staminaRegen * dt);
  }

  update(dt: number): void {
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    this.tackleCooldown = Math.max(0, this.tackleCooldown - dt);
    this.stunned = Math.max(0, this.stunned - dt);
    this.actionLock = Math.max(0, this.actionLock - dt);
    this.facingLock = Math.max(0, this.facingLock - dt);

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
        this.stunned = KEEPER.recoveryTime;
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
    if (speed > 0.4 && this.tackleTimer <= 0 && this.diveTimer <= 0 && this.facingLock <= 0) {
      const targetAngle = Math.atan2(this.vel.x, this.vel.z);
      const cur = Math.atan2(this.facing.x, this.facing.z);
      let d = targetAngle - cur;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // 민첩성: 몸을 돌리는 속도
      const turnRate = PLAYER.turnRate - 3 + 6 * this.stat('agility');
      const turn = THREE.MathUtils.clamp(d, -turnRate * dt, turnRate * dt);
      const a = cur + turn;
      this.facing.set(Math.sin(a), 0, Math.cos(a));
    }
    this.cannonVel.set(this.vel.x, 0, this.vel.z);
  }

  faceTowards(x: number, z: number): void {
    const d = new THREE.Vector3(x - this.pos.x, 0, z - this.pos.z);
    if (d.lengthSq() > 1e-4) this.facing.copy(d.normalize());
  }

  /** 구운 동작 재생 (모션캡처·GRF). 데이터가 없으면 false → 기존 오버레이로 대체 */
  playMotion(entry: MotionEntry | null, startAt = 0, speed = 1): boolean {
    // 누운 채 끝나는 동작은 일어나기를 빠르게 이어 붙인다 (경기 판정상 일어나는 시간에 맞춤)
    const then = entry?.next ? { id: entry.next, speed: 1.7 } : undefined;
    if (!entry || !this.model.playMotion?.(entry.id, { startAt, speed, then })) return false;
    this.animTimer = Math.max(this.animTimer, (entry.duration - startAt) / speed + (then ? 0.6 : 0));
    return true;
  }

  /** 태클에 걸려 넘어짐. 넘어졌다 일어나기까지 걸리는 시간(초)을 돌려준다 (동작이 없으면 0) */
  fall(): number {
    const entry = pickMotion('fall', speedClass(this), null, visualRandom.next());
    if (!this.playMotion(entry)) return 0;
    return Math.min(1.4, this.animTimer);
  }

  startTackle(dir: THREE.Vector3, kind: 'slide' | 'stand' = 'slide'): void {
    this.tackleDir.copy(dir).setY(0).normalize();
    this.facing.copy(this.tackleDir);
    this.tackleKind = kind;
    this.tackleResolved = false;
    if (kind === 'slide') {
      this.tackleTimer = PLAYER.tackleDuration;
      this.tackleCooldown = PLAYER.tackleCooldown;
      // GRF 슬라이딩: 가장 낮은 순간(공을 걷어내는 순간) 조금 전부터
      const slide = pickMotion('slide', speedClass(this), null, visualRandom.next());
      if (!this.playMotion(slide, Math.max(0, (slide?.key ?? 0) - 0.25))) this.model.play('tackle');
    } else {
      this.tackleTimer = PLAYER.standTackleDuration;
      this.tackleCooldown = PLAYER.standTackleCooldown;
      this.model.play('kick', { side: 1 });
    }
  }

  get tackleRange(): number {
    return this.tackleKind === 'slide' ? PLAYER.tackleRange : PLAYER.standTackleRange;
  }

  startDive(vel: THREE.Vector3, localSide: 1 | -1, kind: 'save' | 'smother' = 'save'): void {
    this.diveVel.copy(vel);
    this.diveKind = kind;
    this.diveSide = localSide;
    this.diveTimer = kind === 'smother' ? KEEPER.smotherDuration : KEEPER.diveDuration;
    // 모션캡처 다이빙 (localSide 1 = 몸의 왼쪽). 발밑 다이빙은 해당 동작이 없어 오버레이
    const dive = kind === 'save' ? pickMotion('dive', 'idle', localSide === 1 ? 'L' : 'R', visualRandom.next()) : null;
    // 모션캡처 선방은 옆으로 뻗는 동작이라, 몸 전체를 눕히는 기존 기울기(오버레이)를 함께 얹어 '날아가는' 다이빙으로 만든다
    this.playMotion(dive, Math.max(0, (dive?.key ?? 0) - 0.12), 1.15);
    this.model.play(kind === 'smother' ? 'smother' : 'dive', { side: localSide });
  }

  private clampToArena(): void {
    const mx = PITCH.halfL + PITCH.runoffEnd - 0.6;
    const mz = PITCH.halfW + PITCH.runoffSide - 0.6;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -mx, mx);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -mz, mz);
    // 골대 안쪽(그물 뒤)으로는 못 들어간다
    if (Math.abs(this.pos.x) > PITCH.halfL + 0.2 && Math.abs(this.pos.z) < GOAL.width / 2 + PLAYER.radius) {
      this.pos.x = Math.sign(this.pos.x) * (PITCH.halfL + 0.2);
    }
  }

  /** 일회성 동작 재생 (킥 등). duration 동안 기본 동작으로 돌아가지 않는다 */
  playAction(state: AnimState, duration: number, opts: { side?: 1 | -1 } = {}): void {
    this.model.play(state, opts);
    this.animTimer = duration;
  }

  /** 연습 재시작에서 직전 킥·세리머니의 시각 타이머까지 비운다. */
  resetAnimation(): void {
    this.animTimer = this.visualTime = 0;
    this.visualYaw = null;
    this.celebrating = false;
    this.model.resetAnimation?.();
    this.model.play('idle');
  }

  syncVisual(dt: number, distance = 0): void {
    this.model.root.position.set(this.pos.x, 0, this.pos.z);
    const targetYaw = Math.atan2(this.facing.x, this.facing.z);
    if (this.visualYaw === null) this.visualYaw = targetYaw;
    const yawDelta = Math.atan2(Math.sin(targetYaw - this.visualYaw), Math.cos(targetYaw - this.visualYaw));
    this.visualYaw += THREE.MathUtils.clamp(yawDelta, -VISUAL.maxYawRate * dt, VISUAL.maxYawRate * dt);
    this.model.root.rotation.y = this.visualYaw;

    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.model.setLocomotion(speed, this.sprinting);

    this.animTimer = Math.max(0, this.animTimer - dt);
    const inAction = this.animTimer > 0 || this.tackleTimer > 0 || this.diveTimer > 0 || this.stunned > 0;
    if (!inAction) {
      const base: AnimState = this.basePose ?? (this.keeperAdvancing ? 'advance' : speed > 0.6 ? 'run' : 'idle');
      // 세리머니: 모션캡처 세리머니를 반복 (없으면 기존 춤 클립)
      if (base === 'celebrate' && !this.celebrating) {
        const c = pickMotion('celebrate', 'idle', null, visualRandom.next());
        this.celebrating = !!c && !!this.model.playMotion?.(c.id, { loop: true });
      } else if (base !== 'celebrate' && this.celebrating) {
        this.celebrating = false;
        this.model.stopMotion?.();
      }
      if (this.model.current !== base && !this.celebrating) this.model.play(base);
    }
    // 위치는 매 프레임 반영하고 멀리 있는 평상시 동작만 30Hz로 갱신한다.
    this.visualTime += dt;
    if (distance < VISUAL.animationDistance || inAction || this.visualTime >= 1 / VISUAL.animationHz) {
      this.model.update(this.visualTime);
      this.visualTime = 0;
    }
    const shadow = distance < VISUAL.shadowDistance;
    if (shadow !== this.shadowEnabled) {
      this.shadowEnabled = shadow;
      this.model.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = shadow; });
    }
  }
}
