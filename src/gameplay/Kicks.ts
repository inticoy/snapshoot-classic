import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BALL, COMMAND, GOAL, PASS, PITCH, SHOT } from '../config';
import type { AssistLevel } from '../core/Settings';
import type { Player } from '../entities/Player';
import { n } from '../data/Stats';
import { activePhysics, magnusAccel } from '../physics/presets';
import type { Match } from './Match';

export type PassKind = 'short' | 'through' | 'lob' | 'lobThrough' | 'driven' | 'drivenThrough' | 'lowLob' | 'dink' | 'dinkThrough' | 'lowLobThrough' | 'highLobThrough' | 'oneTwo' | 'flair' | 'cross' | 'lowCross' | 'highCross' | 'flairCross' | 'fastCross';

export interface KickResult {
  vel: CANNON.Vec3;
  spin: CANNON.Vec3;
  /** 패스를 받을 선수 (조작 전환, AI 리시브용) */
  receiver: Player | null;
  /** 약발로 찼는지 (HUD 표시용) */
  weakFoot: boolean;
  target?: THREE.Vector3;
  origin?: THREE.Vector3;
  flair?: boolean;
}

const g = () => activePhysics().gravity;

/**
 * 슛 / 패스의 궤적 계산.
 *
 * 보정(어시스트)
 *  - 보조: 패스는 입력 방향의 넓은 범위에서 동료를 골라 세기까지 맞춰 주고, 슛은 골문 안을 노린다
 *  - 세미: 패스는 좁은 범위의 동료에게 방향과 세기를 맞추되 게이지가 조금 반영, 슛은 골문 근처까지만 보정
 *  - 수동: 입력 방향과 게이지 그대로
 *
 * 능력치
 *  - 골 결정력(박스 안) / 중거리 슛(박스 밖) / 커브(감아차기): 슛 오차
 *  - 슛 파워: 슛 속도 · 짧은 패스 / 긴 패스: 패스 방향·세기 오차 · 시야: 스루 패스 리드와 동료 탐색 범위
 *  - 침착성: 압박·질주 중 오차 증가를 줄임 · 약발: 주발이 아닌 발로 찼을 때 오차
 */
export class Kicks {
  constructor(private readonly m: Match) {}

  /** 공이 몸의 어느 쪽에 있는지로 차는 발을 정하고, 약발이면 오차 배율을 돌려준다 */
  footFactor(p: Player): { side: 1 | -1; weak: boolean; factor: number } {
    const bp = this.m.ball.position;
    const rx = -p.facing.z, rz = p.facing.x; // 오른쪽 벡터
    const side: 1 | -1 = (bp.x - p.pos.x) * rx + (bp.z - p.pos.z) * rz >= 0 ? 1 : -1;
    const foot = side === 1 ? 'R' : 'L';
    const weak = foot !== p.profile.foot;
    return { side, weak, factor: weak ? 1 + (5 - p.profile.weakFoot) * 0.22 : 1 };
  }

  /** 압박 / 질주에 따른 오차 증가 (침착성이 줄여 준다) */
  private pressureFactor(p: Player): number {
    const composure = n(p.profile.stats.composure);
    const d = this.m.nearestOpponentDist(p);
    const pressure = d < 1.8 ? (1.8 - d) / 1.8 : 0;
    return 1 + pressure * 0.8 * (1 - 0.65 * composure) + (p.sprinting ? 0.35 * (1 - 0.5 * composure) : 0);
  }

  // ---------------------------------------------------------------- 슛

  shot(p: Player, charge: number, finesse: boolean, aim: THREE.Vector3, assist: AssistLevel, style: 'normal' | 'driven' | 'flair' | 'power' = 'normal', timed = false): KickResult {
    const s = p.profile.stats;
    const goalX = this.m.oppGoalX(p.team);
    const bp = this.m.ball.position;
    const hw = GOAL.width / 2;
    const toGoal = Math.hypot(goalX - bp.x, bp.z);
    const inBox = Math.abs(goalX - bp.x) < PITCH.boxDepth + 1 && Math.abs(bp.z) < PITCH.boxWidth / 2;
    const dir = aim.lengthSq() > 0.01 ? aim.clone().setY(0).normalize() : null;
    const towardGoal = !!dir && dir.x * p.attackDir > 0.1;

    // 1) 조준점 (보정 단계별)
    let targetZ: number;
    let targetX = goalX;
    const rayZ = towardGoal ? bp.z + (dir!.z / dir!.x) * (goalX - bp.x) : null;
    if (assist === 'assisted') {
      // 입력이 어느 쪽이든 골문 안으로. 입력이 없으면 먼 쪽 구석
      const side = rayZ !== null ? Math.sign(rayZ || 1) : bp.z > 0 ? -1 : 1;
      const want = rayZ !== null ? Math.abs(rayZ) : hw - 0.7;
      targetZ = side * THREE.MathUtils.clamp(want, 0.2, hw - 0.45);
    } else if (assist === 'semi') {
      targetZ = rayZ !== null ? THREE.MathUtils.clamp(rayZ, -hw - 0.9, hw + 0.9) : (bp.z > 0 ? -1 : 1) * (hw - 1);
    } else {
      // 수동: 입력(없으면 바라보는 방향)으로 그대로
      const d = dir ?? p.facing;
      if (d.x * p.attackDir > 0.05) targetZ = bp.z + (d.z / d.x) * (goalX - bp.x);
      else {
        targetX = bp.x + d.x * 30;
        targetZ = bp.z + d.z * 30;
      }
      targetZ = THREE.MathUtils.clamp(targetZ!, -PITCH.halfW, PITCH.halfW);
    }
    if (finesse && assist !== 'manual') {
      // 감아차기는 먼 쪽 포스트 안쪽으로 감기게
      const side = dir && Math.abs(dir.z) > 0.25 ? Math.sign(dir.z) : bp.z > 0 ? -1 : 1;
      targetZ = side * (hw - 0.55);
    }

    // 2) 오차: 능력치 · 파워 · 거리 · 압박 · 약발
    const finishingStat = inBox ? s.finishing : s.finishing * 0.35 + s.longShots * 0.65;
    const acc = finesse ? n(finishingStat) * 0.5 + n(s.curve) * 0.5 : n(finishingStat);
    const foot = this.footFactor(p);
    const spread =
      (0.12 + 0.75 * charge * charge + toGoal * 0.012) * (1.7 - 1.2 * acc) * this.pressureFactor(p) * foot.factor * (style === 'driven' ? COMMAND.drivenShotError : style === 'flair' ? COMMAND.flairError : style === 'power' ? (timed ? COMMAND.timedError : COMMAND.powerError) : 1);
    targetZ += this.m.random.gauss() * spread;

    // 3) 속도 (슛 파워)
    const power = 0.86 + 0.24 * n(s.shotPower);
    let speed =
      (finesse
        ? SHOT.finesseMinSpeed + (SHOT.finesseMaxSpeed - SHOT.finesseMinSpeed) * charge
        : SHOT.minSpeed + (SHOT.maxSpeed - SHOT.minSpeed) * charge) * power;
    if (style === 'driven') speed *= COMMAND.drivenShotSpeed;
    if (style === 'power') speed = Math.min(speed * COMMAND.powerSpeed, COMMAND.powerMaxSpeed);
    // 80% 이상 차지하면 급격히 뜬다 (크로스바 위로 넘어갈 위험). 골 결정력이 높으면 덜 뜬다
    const sky = Math.max(0, charge - 0.8) * (11 - 4 * acc);
    const targetY = THREE.MathUtils.clamp(
      (finesse ? 0.9 : 0.3) + 1.5 * charge * charge + sky + this.m.random.gauss() * spread * 0.35,
      0.15,
      6,
    );

    const target = new THREE.Vector3(targetX, targetY, targetZ);
    const horiz = new THREE.Vector3(target.x - bp.x, 0, target.z - bp.z);
    const dist = horiz.length();
    horiz.normalize();
    const T = (dist / speed) * (1 + dist * 0.008);

    let launch = horiz.clone();
    const spin = new CANNON.Vec3();
    if (finesse) {
      // 마그누스 횡가속도만큼 반대쪽으로 겨냥하고 회전으로 휘어 들어오게 (커브가 높을수록 많이 감김)
      const spinAmt = SHOT.finesseSpin * (0.7 + 0.5 * n(s.curve)) * (style === 'driven' ? COMMAND.drivenCurl : 1);
      const aLat = magnusAccel(activePhysics(), BALL.radius, BALL.mass, spinAmt, speed);
      const offset = Math.min(3.5, 0.5 * aLat * T * T * 0.8);
      // 휘는 방향은 차는 발로 정해진다 (발 안쪽 감아차기): 오른발은 왼쪽으로, 왼발은 오른쪽으로 휜다.
      // 그래서 휘는 반대쪽(오른발이면 목표 오른쪽)을 겨냥해 차고 회전으로 목표에 들어오게 한다.
      // 마그누스 힘 = ω×v: ω가 +Y(위)면 진행 방향의 왼쪽으로 휜다 (오른쪽 = (-vz, 0, vx))
      const right = new THREE.Vector3(-horiz.z, 0, horiz.x);
      const bendLeft = foot.side === 1; // 오른발
      const aimPoint = target.clone().addScaledVector(right, bendLeft ? offset : -offset);
      launch = new THREE.Vector3(aimPoint.x - bp.x, 0, aimPoint.z - bp.z).normalize();
      spin.set(0, bendLeft ? spinAmt : -spinAmt, 0);
    }
    const vy = (targetY - bp.y + 0.5 * g() * T * T) / T;
    return { vel: new CANNON.Vec3(launch.x * speed, style === 'driven' ? COMMAND.drivenShotLift : Math.max(0.5, vy), launch.z * speed), spin, receiver: null, weakFoot: foot.weak, flair: style === 'flair', origin: new THREE.Vector3(bp.x, bp.y, bp.z), target };
  }

  /** Q+D 칩슛: 키퍼 머리 위로 띄워 크로스바 아래로 */
  chip(p: Player, charge: number, aim: THREE.Vector3, assist: AssistLevel): KickResult {
    const s = p.profile.stats;
    const goalX = this.m.oppGoalX(p.team);
    const bp = this.m.ball.position;
    const hw = GOAL.width / 2;
    let targetZ = bp.z * 0.3;
    if (aim.lengthSq() > 0.01 && aim.x * p.attackDir > 0.15) {
      const ray = bp.z + (aim.z / aim.x) * (goalX - bp.x);
      targetZ = assist === 'manual' ? ray : THREE.MathUtils.clamp(ray, -hw + 0.5, hw - 0.5);
    }
    const foot = this.footFactor(p);
    const acc = n(s.finishing) * 0.6 + n(s.composure) * 0.4;
    targetZ += this.m.random.gauss() * (0.25 + charge * 0.5) * (1.6 - 1.1 * acc) * foot.factor;
    const dist = Math.hypot(goalX - bp.x, targetZ - bp.z);
    const T = 1.0 + dist * 0.06;
    const landY = 0.9 + charge * 1.6 + this.m.random.gauss() * 0.25 * (1.5 - acc);
    const vh = (dist / T) * (1 + dist * 0.008);
    const vy = (landY - bp.y + 0.5 * g() * T * T) / T;
    const d = new THREE.Vector3(goalX - bp.x, 0, targetZ - bp.z).normalize();
    return { vel: new CANNON.Vec3(d.x * vh, vy, d.z * vh), spin: new CANNON.Vec3(), receiver: null, weakFoot: foot.weak };
  }

  // ---------------------------------------------------------------- 패스

  pass(p: Player, input: THREE.Vector3, kind: PassKind, charge: number, assist: AssistLevel): KickResult {
    const dink = kind === 'dink' || kind === 'dinkThrough';
    const cross = kind.endsWith('Cross') || kind === 'cross';
    const flair = kind === 'flair' || kind === 'flairCross';
    const selectionKind = kind === 'dink' || kind === 'oneTwo' || kind === 'flair' ? 'short' : kind === 'dinkThrough' ? 'through' : kind === 'lowLobThrough' || kind === 'highLobThrough' ? 'lobThrough' : cross ? 'lob' : kind;
    const driven = kind === 'driven' || kind === 'drivenThrough' || kind === 'lowLob';
    const baseKind = kind === 'driven' ? 'short' : kind === 'drivenThrough' ? 'through' : kind === 'lowLob' ? 'lob' : selectionKind;
    const s = p.profile.stats;
    const bp = this.m.ball.position;
    const d = input.clone().setY(0).normalize();
    const aerial = baseKind === 'lob' || baseKind === 'lobThrough';
    const throughBall = baseKind === 'through' || baseKind === 'lobThrough' || kind === 'oneTwo';

    // 1) 받을 동료 찾기 (보조: 넓게, 세미: 좁게, 수동: 안 찾음). 시야가 좋으면 범위가 넓어진다
    const vision = n(s.vision);
    const cone = assist === 'assisted' ? 1.15 + 0.2 * vision : assist === 'semi' ? 0.55 + 0.15 * vision : 0;
    const receiver = cone > 0 ? this.pickReceiver(p, d, baseKind, cone) : null;

    // 2) 목표 지점과 이상적인 세기
    let tx: number, tz: number;
    if (receiver) {
      if (throughBall) {
        // 동료가 상대 골대 쪽으로 뛰어들어갈 공간. 보조는 자동, 세미는 게이지로 거리
        const run = new THREE.Vector3(p.attackDir, 0, 0).lerp(d, 0.35).normalize();
        let lead = assist === 'assisted' ? 4 + 5 * vision + 2 * charge : 3 + 9 * charge;
        // Z+W: 더 깊은 공간으로 (받는 선수가 뛰어서 따라잡는 공)
        if (kind === 'drivenThrough') lead = lead * PASS.drivenThroughLead + PASS.drivenThroughExtra;
        if (kind === 'oneTwo') lead *= COMMAND.oneTwoLead;
        tx = receiver.pos.x + run.x * lead;
        tz = receiver.pos.z + run.z * lead;
      } else {
        const dist = receiver.pos.distanceTo(new THREE.Vector3(bp.x, 0, bp.z));
        const lead = aerial ? 0.75 + dist * 0.035 : dist / 14;
        tx = receiver.pos.x + receiver.vel.x * lead * 0.85;
        tz = receiver.pos.z + receiver.vel.z * lead * 0.85;
      }
    } else {
      // 수동이거나 받을 사람이 없으면 입력 방향으로 게이지만큼
      const dist = aerial ? 8 + 32 * charge : 6 + 26 * charge;
      tx = bp.x + d.x * dist;
      tz = bp.z + d.z * dist;
    }
    tx = THREE.MathUtils.clamp(tx, -PITCH.halfL - 1, PITCH.halfL + 1);
    tz = THREE.MathUtils.clamp(tz, -PITCH.halfW + 0.5, PITCH.halfW - 0.5);

    // 3) 오차: 짧은 패스 / 긴 패스 능력치, 거리, 압박, 약발
    const D = Math.hypot(tx - bp.x, tz - bp.z);
    const long = aerial || D > 25;
    const acc = long ? n(s.longPassing) * 0.8 + n(s.vision) * 0.2 : n(s.shortPassing) * 0.85 + n(s.vision) * 0.15;
    const foot = this.footFactor(p);
    const err = (0.012 + 0.05 * (1 - acc)) * (1 + D / 35) * this.pressureFactor(p) * foot.factor;
    const angle = this.m.random.gauss() * err * (flair ? COMMAND.flairError : driven ? PASS.drivenError : 1);
    const dir2 = new THREE.Vector3(tx - bp.x, 0, tz - bp.z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    const speedErr = 1 + this.m.random.gauss() * (0.03 + 0.08 * (1 - acc)) * foot.factor;

    // 세기: 보조는 자동, 세미도 대부분 보정하되 게이지가 조금 반영됨, 수동은 이미 거리로 반영됨
    const powerScale =
      !receiver || assist === 'manual' ? 1 : assist === 'assisted' ? 0.96 + 0.08 * charge : 0.85 + 0.3 * charge;

    const vel = new CANNON.Vec3();
    if (aerial) {
      const T = (baseKind === 'lob' ? 0.75 + D * 0.035 : 0.6 + D * 0.026) * (kind === 'lowLob' || kind === 'lowCross' ? PASS.lowLobTime : kind === 'highCross' ? COMMAND.highCrossTime : kind === 'highLobThrough' ? COMMAND.lobThroughTime : 1);
      const vh = (D / T) * (1 + D * 0.0095) * powerScale * speedErr;
      vel.set(dir2.x * vh, 0.5 * g() * T, dir2.z * vh);
    } else {
      // 받는 위치에서 6~9 m/s 정도로 도착하는 세기
      const base = baseKind === 'through' ? 5.5 + D * 0.48 : PASS.shortBase + D * PASS.shortPerMetre;
      const speed = THREE.MathUtils.clamp(base * powerScale * speedErr, PASS.minSpeed * 0.8, PASS.maxSpeed + 3);
      const vh = speed * (kind === 'drivenThrough' ? PASS.drivenThroughSpeed : driven ? PASS.drivenSpeed : 1);
      vel.set(dir2.x * vh, driven ? PASS.drivenLift : D > 22 ? 2.2 : 0.4, dir2.z * vh);
    }

    if (dink) {
      vel.x *= COMMAND.dinkSpeed; vel.z *= COMMAND.dinkSpeed;
      vel.y = Math.sqrt(2 * g() * Math.max(0, COMMAND.dinkHeight - bp.y));
    }
    if (kind === 'lowLobThrough') {
      const vy = Math.sqrt(2 * g() * Math.max(0, COMMAND.lowThroughHeight - bp.y));
      const flight = 2 * vy / g();
      const speed = D / flight * (1 + D * 0.0095) * powerScale * speedErr * COMMAND.lowThroughSpeed;
      vel.set(dir2.x * speed, vy, dir2.z * speed);
    }
    if (kind === 'fastCross') {
      vel.x *= COMMAND.fastCrossSpeed; vel.z *= COMMAND.fastCrossSpeed;
      vel.y *= PASS.lowLobTime;
    }

    // 수동 패스는 공이 떨어질 곳에 가장 가까운 동료를 받는 선수로 본다
    const recv = receiver ?? this.nearestMateTo(p, tx, tz, 8);
    return { vel, spin: new CANNON.Vec3(), receiver: recv, weakFoot: foot.weak, target: new THREE.Vector3(tx, 0, tz), origin: new THREE.Vector3(bp.x, bp.y, bp.z), flair };
  }

  // ---------------------------------------------------------------- 공중볼

  /**
   * 헤더. shot = 골문으로, pass = 동료에게, clear = 걷어내기 (자기 골대 반대 방향 높고 멀리)
   * 헤더 능력치가 정확도와 세기를 정한다.
   */
  header(p: Player, mode: 'shot' | 'pass' | 'clear', aim: THREE.Vector3, assist: AssistLevel): KickResult {
    const s = p.profile.stats;
    const bp = this.m.ball.position;
    const inc = this.m.ball.velocity;
    const acc = n(s.heading);
    const incoming = Math.hypot(inc.x, inc.z);
    const vel = new CANNON.Vec3();
    let receiver: Player | null = null;

    if (mode === 'shot') {
      const goalX = this.m.oppGoalX(p.team);
      const hw = GOAL.width / 2;
      const dir = aim.lengthSq() > 0.01 ? aim.clone().setY(0).normalize() : null;
      let tz: number;
      if (dir && dir.x * p.attackDir > 0.1) {
        const ray = bp.z + (dir.z / dir.x) * (goalX - bp.x);
        tz = assist === 'manual' ? ray : THREE.MathUtils.clamp(ray, -hw + 0.4, hw - 0.4);
      } else {
        // 입력이 없으면 키퍼 반대쪽 구석
        tz = (bp.z > 0 ? -1 : 1) * (hw - 0.6);
      }
      const toGoal = Math.hypot(goalX - bp.x, tz - bp.z);
      tz += this.m.random.gauss() * (0.25 + toGoal * 0.035) * (1.7 - 1.2 * acc) * this.pressureFactor(p);
      // 헤더는 바운드를 노려 아래로 찍는다
      const ty = THREE.MathUtils.clamp(0.25 + this.m.random.next() * 0.9 + this.m.random.gauss() * 0.4 * (1.4 - acc), 0.1, 3.2);
      const speed = 10 + 8 * acc + incoming * 0.15 + 3 * n(s.strength);
      const T = Math.hypot(goalX - bp.x, tz - bp.z) / speed;
      const d = new THREE.Vector3(goalX - bp.x, 0, tz - bp.z).normalize();
      vel.set(d.x * speed, (ty - bp.y + 0.5 * g() * T * T) / T, d.z * speed);
    } else if (mode === 'pass') {
      const dir = aim.lengthSq() > 0.01 ? aim.clone().setY(0).normalize() : p.facing.clone();
      receiver = assist === 'manual' ? null : this.pickReceiver(p, dir, 'short', assist === 'assisted' ? 1.2 : 0.6);
      const target = receiver ? receiver.pos.clone() : new THREE.Vector3(bp.x, 0, bp.z).addScaledVector(dir, 10);
      const D = Math.min(18, Math.hypot(target.x - bp.x, target.z - bp.z));
      const d = new THREE.Vector3(target.x - bp.x, 0, target.z - bp.z)
        .normalize()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.m.random.gauss() * (0.04 + 0.1 * (1 - acc)));
      // 살짝 띄워서 동료 발 앞에 떨어지게
      const T = 0.5 + D * 0.04;
      const vh = D / T;
      vel.set(d.x * vh, (0.3 - bp.y + 0.5 * g() * T * T) / T, d.z * vh);
    } else {
      // 걷어내기: 자기 골대 반대 방향 + 바깥쪽으로 높고 멀리
      const away = new THREE.Vector3(p.attackDir, 0, Math.sign(bp.z || 1) * 0.6).normalize();
      if (aim.lengthSq() > 0.01 && aim.x * p.attackDir > 0) away.lerp(aim.clone().setY(0).normalize(), 0.5).normalize();
      const speed = 13 + 6 * acc + 2 * n(s.strength);
      vel.set(away.x * speed, 6 + 2 * acc, away.z * speed);
    }
    return { vel, spin: new CANNON.Vec3(), receiver, weakFoot: false };
  }

  /** 발리: 공중에 뜬 공을 바로 차는 슛. 발리 슛 능력치가 낮으면 크게 빗나간다 */
  volley(p: Player, charge: number, aim: THREE.Vector3, assist: AssistLevel): KickResult {
    const r = this.shot(p, charge, false, aim, assist);
    const v = n(p.profile.stats.volleys);
    const err = this.m.random.gauss() * (0.03 + 0.1 * (1 - v));
    const h = new THREE.Vector3(r.vel.x, 0, r.vel.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), err);
    r.vel.x = h.x;
    r.vel.z = h.z;
    // 발리는 뜨기 쉽다
    r.vel.y += this.m.random.gauss() * 1.2 * (1.2 - v) + (1 - v) * 1.5;
    return r;
  }

  /** 스로인: 머리 위에서 양손으로 던진다. long = 롱 스로인 (A/W) */
  throwIn(p: Player, input: THREE.Vector3, long: boolean, charge: number, assist: AssistLevel): KickResult {
    const bp = this.m.ball.position;
    const d = input.clone().setY(0).normalize();
    const cone = assist === 'assisted' ? 1.3 : assist === 'semi' ? 0.7 : 0;
    let receiver = cone > 0 ? this.pickReceiver(p, d, long ? 'lob' : 'short', cone) : null;
    const maxD = long ? 26 : 15;
    if (receiver && receiver.pos.distanceTo(new THREE.Vector3(bp.x, 0, bp.z)) > maxD + 3) receiver = null;
    let tx: number, tz: number;
    if (receiver) {
      tx = receiver.pos.x + receiver.vel.x * 0.5;
      tz = receiver.pos.z + receiver.vel.z * 0.5;
    } else {
      const dist = long ? 10 + 16 * charge : 5 + 10 * charge;
      tx = bp.x + d.x * dist;
      tz = bp.z + d.z * dist;
    }
    tz = THREE.MathUtils.clamp(tz, -PITCH.halfW + 0.5, PITCH.halfW - 0.5);
    const D = Math.min(maxD, Math.hypot(tx - bp.x, tz - bp.z));
    const acc = n(p.profile.stats.shortPassing) * 0.5 + n(p.profile.stats.strength) * 0.5;
    const dir2 = new THREE.Vector3(tx - bp.x, 0, tz - bp.z)
      .normalize()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.m.random.gauss() * (0.02 + 0.05 * (1 - acc)));
    const T = (long ? 0.55 : 0.45) + D * 0.03;
    const vh = (D / T) * (1 + D * 0.006);
    const vy = (0.4 - bp.y + 0.5 * g() * T * T) / T;
    return {
      vel: new CANNON.Vec3(dir2.x * vh, vy, dir2.z * vh),
      spin: new CANNON.Vec3(),
      receiver: receiver ?? this.nearestMateTo(p, tx, tz, 6),
      weakFoot: false,
    };
  }

  private pickReceiver(p: Player, d: THREE.Vector3, kind: PassKind, cone: number): Player | null {
    const m = this.m;
    const aerial = kind === 'lob' || kind === 'lobThrough' || kind === 'lowLob';
    const throughBall = kind === 'through' || kind === 'lobThrough' || kind === 'drivenThrough';
    let best: Player | null = null;
    let bestScore = Infinity;
    const to = new THREE.Vector3();
    for (const mate of m.teams[p.team]) {
      if (mate === p) continue;
      to.copy(mate.pos).sub(p.pos).setY(0);
      const dist = to.length();
      if (dist < 2) continue;
      const angle = to.normalize().angleTo(d);
      if (angle > cone) continue;
      const keeperPenalty = mate.isKeeper ? (kind === 'short' ? 1.2 : 9) : 0;
      const forward = (mate.pos.x - p.pos.x) * p.attackDir;
      const blocked = aerial ? 0 : m.laneBlocked(p, mate) * 1.5;
      const score = angle * 2.2 + dist * 0.03 + keeperPenalty + blocked - (throughBall ? forward * 0.04 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = mate;
      }
    }
    return best;
  }

  private nearestMateTo(p: Player, x: number, z: number, maxD: number): Player | null {
    let best: Player | null = null;
    let bestD = maxD;
    for (const mate of this.m.teams[p.team]) {
      if (mate === p || mate.isKeeper) continue;
      const dd = Math.hypot(mate.pos.x - x, mate.pos.z - z);
      if (dd < bestD) {
        bestD = dd;
        best = mate;
      }
    }
    return best;
  }
}
