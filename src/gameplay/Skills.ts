import * as THREE from 'three';
import { BALL, SKILL_INPUT } from '../config';
import { makeSkillDefs } from '../data/Skills';
import { MOTION_CATALOG } from '../data/MotionCatalog';
import type { MotionKind } from '../anim/MotionLibrary';
import type { Player } from '../entities/Player';
import type { LegPose } from '../entities/PlayerModel';
import type { Match } from './Match';

export { SKILL_INPUT } from '../config';

/**
 * 개인기 (FC 온라인 키보드 커맨드)
 *
 * 개인기 하나 = 데이터:
 *  - trigger: 커맨드. 방향은 개인기를 시작할 때 선수가 바라보던 방향 기준 8방향 (F = 앞, R = 오른쪽)
 *  - body / ball: 선수 기준 좌표(x = 오른쪽, z = 앞, m)의 시간별 위치. 그 사이는 부드럽게 잇는다
 *  - motion: 몸 동작 (구운 클립을 원하는 구간만 재생)
 *  - exit: 끝날 때 공·몸이 나가는 방향과 속도
 *  - bait / shield: AI 수비가 속는 방향, 동작 중 태클 성공률 배수
 * 좌우 대칭 개인기는 한쪽만 적고 mirror()로 만든다.
 */
export type Dir = 'F' | 'FR' | 'R' | 'BR' | 'B' | 'BL' | 'L' | 'FL';
const DIRS: Dir[] = ['F', 'FR', 'R', 'BR', 'B', 'BL', 'L', 'FL'];
const MIRROR: Record<Dir, Dir> = { F: 'F', FR: 'FL', R: 'L', BR: 'BL', B: 'B', BL: 'BR', L: 'R', FL: 'FR' };

/** 커맨드 한 칸. hold = 꾹 (HOLD초 이상), tap = 짧게 */
export interface Token { dir: Dir; hold?: boolean; tap?: boolean }

export type Trigger =
  | { kind: 'shift'; seq: Token[] } // Shift + 방향 순서
  | { kind: 'z'; seq: Token[] } // Z + 방향
  | { kind: 'fake'; from: 'shoot' | 'lob' }; // 슛(D)·로빙(A) 게이지 중 패스(S) = 페이크

/** 발 하나: 발목 위치(시작 기준 좌표, m)·발끝 방향(yaw, + = 오른쪽)·발끝 들기(pitch, + = 위)·IK 가중치 */
export interface RigFoot { x: number; y: number; z: number; yaw: number; pitch: number; w: number }
/**
 * 다리를 직접 움직이는 개인기의 한 순간 (모션 데이터에 없는 개인기용).
 * 몸·공·두 발을 같은 함수에서 만들어서 공이 늘 실제로 닿는 발 부위를 따라간다.
 * 좌표는 body/ball 키와 같다 (x = 오른쪽, z = 앞). roll/pitch/drop은 몸 기울기·낮추기
 */
export interface RigPose { x: number; z: number; yaw: number; ball: { x: number; y: number; z: number }; L: RigFoot; R: RigFoot; roll: number; pitch: number; drop: number }

/** 선수 기준 시간별 위치. yaw = 시작 방향 기준 몸 회전 (+ = 오른쪽으로) */
export interface Key { t: number; x: number; z: number; y?: number; yaw?: number }

export interface SkillDef {
  id: string;
  name: string;
  stars: number;
  trigger: Trigger;
  duration: number;
  /** 들어올 때 앞으로 가던 속도를 이만큼 유지하며 동작한다 (body·ball z에 더해짐) */
  carry: number;
  /** 옆 끌기는 보조키·방향을 누르는 동안 한 주기씩 이어 간다. */
  sustained?: boolean;
  body: Key[];
  ball: Key[];
  /** 발이 공을 건드리는 순간 (터치 소리, 동작-공 일치 검증) */
  contacts: { t: number; foot: 'L' | 'R' }[];
  /** 접촉을 구운 클립을 고정한다. [from, key × toKey) 구간을 duration에 맞춰 재생한다. */
  /** sprintId: 질주 중(5.2 m/s 이상)에 대신 쓸 클립. speed를 주면 그 배속으로 재생하고 toKey 지점에서 끊는다 */
  /** flat: 클립의 몸 회전(요)을 빼고 body 키의 yaw로만 돈다 */
  motion?: { id: string; sprintId?: string; flat?: boolean; kind: MotionKind; angle: number; from?: number; toKey?: number; speed?: number };
  /** 선수 별이 개인기 별보다 높을수록 더 빠르고 매끄럽게 (별 하나당 starScale만큼 빨라진다) */
  starScale?: number;
  /** 끝날 때 공 방향(시작 기준 rad, + = 오른쪽)·속도와 몸 속도. input = 그때 누른 방향이 있으면 그쪽 */
  exit: { dir: number; speed: number; body: number; input?: boolean };
  /** AI 수비를 속이는 순간과 방향 (rad). 가까운 수비가 잠깐 그쪽으로 몸을 싣는다 */
  bait?: { t: number; dir: number; strength: number };
  shield: number;
  /** 다리 IK 개인기: 있으면 body·ball 키 대신 이걸로 몸·공·발을 움직인다 (body·ball 키는 이걸 샘플링한 사본) */
  rig?: (t: number) => RigPose;
}

const flipId = (id: string) => (id.endsWith('~m') ? id.slice(0, -2) : `${id}~m`);

/** 좌우 반전 */
export function mirror(d: SkillDef, id: string, name: string): SkillDef {
  const flip = (k: Key): Key => ({ ...k, x: -k.x, yaw: k.yaw === undefined ? undefined : -k.yaw });
  const trig = d.trigger;
  return {
    ...d, id, name,
    trigger: trig.kind === 'fake' ? trig : { kind: trig.kind, seq: trig.seq.map((s) => ({ ...s, dir: MIRROR[s.dir] })) },
    body: d.body.map(flip),
    ball: d.ball.map(flip),
    contacts: d.contacts.map((c) => ({ t: c.t, foot: c.foot === 'L' ? 'R' : 'L' })),
    motion: d.motion && { ...d.motion, id: flipId(d.motion.id), sprintId: d.motion.sprintId && flipId(d.motion.sprintId), angle: -d.motion.angle },
    exit: { ...d.exit, dir: -d.exit.dir },
    bait: d.bait && { ...d.bait, dir: -d.bait.dir },
    rig: d.rig && mirrorRig(d.rig),
  };
}

function mirrorRig(rig: (t: number) => RigPose): (t: number) => RigPose {
  const foot = (f: RigFoot): RigFoot => ({ ...f, x: -f.x, yaw: -f.yaw });
  return (t) => {
    const r = rig(t);
    return { ...r, x: -r.x, yaw: -r.yaw, roll: -r.roll, ball: { ...r.ball, x: -r.ball.x }, L: foot(r.R), R: foot(r.L) };
  };
}

export const SKILLS: SkillDef[] = makeSkillDefs();

// ---------------------------------------------------------------- 커맨드 인식

/** seed: 직전 개인기의 마지막 칸을 이어받은 칸 (연속 헛다리처럼 굴리는 입력용, 혼자서는 커맨드가 되지 않는다) */
interface Step { dir: Dir; t0: number; t1: number | null; seed?: boolean }

/** 바라보는 방향(fwd) 기준 8방향 */
export function dirOf(move: THREE.Vector3, fwd: THREE.Vector3): Dir | null {
  if (move.lengthSq() < SKILL_INPUT.dead * SKILL_INPUT.dead) return null;
  const f = move.x * fwd.x + move.z * fwd.z;
  // 오른쪽 = forward × up = (-fz, 0, fx)
  const r = -move.x * fwd.z + move.z * fwd.x;
  const i = Math.round(Math.atan2(r, f) / (Math.PI / 4));
  return DIRS[(i + 8) % 8];
}

function tokenOk(tok: Token, s: Step, now: number, release: boolean): boolean {
  // 이어받은 칸은 '꾹'이 될 수 없다 (사이드 스텝처럼 이미 꾹으로 쓴 입력을 다시 쓰지 않게)
  if (s.seed && tok.hold) return false;
  const held = (s.t1 ?? now) - s.t0;
  // 짧게(tap)는 뗀 뒤에야 짧았는지 안다 (보조키를 떼면 그 순간까지로 본다)
  const tapOk = !tok.tap || ((s.t1 !== null || release) && held < SKILL_INPUT.hold);
  return s.dir === tok.dir && (!tok.hold || held >= SKILL_INPUT.hold) && tapOk;
}

const DIAGONAL = new Set<Dir>(['FR', 'BR', 'BL', 'FL']);

function matches(seq: Token[], steps: Step[], now: number, release: boolean): boolean {
  if (steps.length === 1 && steps[0].seed) return false;
  if (seq.length === steps.length && seq.every((tok, i) => tokenOk(tok, steps[i], now, release))) return true;
  // 마르세유·엘라스티코처럼 크게 도는 커맨드(5칸 이상)는 키보드로 대각선을 정확히 거치기 어려우므로
  // 중간 대각선은 건너뛰어도 된다 (상하좌우 순서만 맞으면). 짧은 커맨드는 다른 개인기와 겹치므로 정확히
  if (seq.length < 5 || steps.length >= seq.length) return false;
  let j = 0;
  for (let i = 0; i < seq.length; i++) {
    const tok = seq[i];
    if (j < steps.length && tokenOk(tok, steps[j], now, release)) { j++; continue; }
    const middle = i > 0 && i < seq.length - 1;
    if (middle && DIAGONAL.has(tok.dir) && !tok.tap && !tok.hold) continue;
    return false;
  }
  return j === steps.length;
}

/**
 * Shift·Z를 누른 동안의 방향 입력을 모아 커맨드를 찾는다.
 * 방향은 보조키를 누른 순간의 몸 방향 기준으로 고정한다 (도는 중에 기준이 바뀌지 않게).
 */
export class SkillInput {
  /** includeHeld: 보조키 전부터 누르던 방향(달리던 방향)을 첫 칸으로 넣는다 (스텝오버처럼 굴리는 커맨드용) */
  constructor(private readonly includeHeld = false) {}

  private mode: 'shift' | 'z' | null = null;
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private steps: Step[] = [];
  private last: Dir | null = null;
  private time = 0;
  private changed = 0;
  /** 보조키를 누르기 직전 프레임에 누르고 있던 방향 */
  private before: Dir | null = null;
  /** 보조키를 누른 시각 */
  private started = 0;

  get active(): boolean { return this.mode !== null; }

  reset(): void {
    this.mode = null;
    this.steps = [];
    this.last = null;
  }

  update(dt: number, shift: boolean, z: boolean, move: THREE.Vector3, facing: THREE.Vector3, list: readonly SkillDef[]): SkillDef | null {
    this.time += dt;
    const mode = shift ? 'shift' : z ? 'z' : null;
    if (mode !== this.mode) {
      // 보조키를 떼는 순간 남은 커맨드를 확정한다
      const done = this.mode ? this.find(list, true) : null;
      this.reset();
      this.mode = mode;
      this.started = this.time;
      // 기준 방향은 상하좌우(월드 ±X·±Z = 화면 4방향) 중 가장 가까운 쪽 — 인벤 DB처럼 '바라보는 방향별 커맨드'가 예측 가능하게
      if (Math.abs(facing.x) >= Math.abs(facing.z)) this.fwd.set(Math.sign(facing.x) || 1, 0, 0);
      else this.fwd.set(0, 0, Math.sign(facing.z));
      // 보조키를 누르기 전부터 누르고 있던 방향(달리던 방향)은 커맨드에 넣지 않는다. 한 번 떼고 다시 누르면 넣는다
      const now = dirOf(move, this.fwd);
      this.last = mode && now === this.before && !this.includeHeld ? now : null;
      if (done) return done;
    }
    if (!this.mode) {
      this.before = dirOf(move, facing);
      return null;
    }
    const dir = dirOf(move, this.fwd);
    if (dir !== this.last) {
      const prev = this.steps.at(-1);
      if (prev && prev.t1 === null) prev.t1 = this.time;
      if (dir) {
        if (prev && this.time - this.changed > SKILL_INPUT.gap && prev.t1 !== null) this.steps = [];
        // 보조키 전부터 누르던 키(달리던 방향)는 '짧게 누른 칸'이 아니다 → 시작을 아주 이전으로 둔다
        const preHeld = this.includeHeld && this.steps.length === 0 && dir === this.before && this.time - this.started < 1e-6;
        this.steps.push({ dir, t0: preHeld ? -Infinity : this.time, t1: null });
      }
      this.last = dir;
      this.changed = this.time;
    }
    const found = this.find(list, false);
    if (found) this.chain();
    return found;
  }

  /** 커맨드가 나간 뒤: 아직 누르고 있는 방향만 다음 커맨드의 첫 칸으로 남긴다 (← ↖ ↑ ↗ → 처럼 굴리면 헛다리가 이어서 나간다) */
  chain(): void {
    this.steps = this.mode && this.last ? [{ dir: this.last, t0: this.time, t1: null, seed: true }] : [];
    this.changed = this.time;
  }

  private find(list: readonly SkillDef[], release: boolean): SkillDef | null {
    if (!this.steps.length || !this.mode) return null;
    const settled = release || this.time - this.changed >= SKILL_INPUT.settle;
    const exact = list.filter((s) => s.trigger.kind === this.mode && matches(s.trigger.seq, this.steps, this.time, release));
    if (!exact.length) return null;
    // 더 긴 커맨드의 앞부분이면 손을 뗄 때(또는 잠깐 멈출 때)까지 기다린다
    const longer = list.some((s) => s.trigger.kind === this.mode && s.trigger.seq.length > this.steps.length &&
      s.trigger.seq.slice(0, this.steps.length).every((tok, i) => tok.dir === this.steps[i].dir));
    const holding = this.last !== null;
    // 더 이어질 커맨드가 없으면 잠깐 멈추기를 기다리지 않는다 (굴리듯 이어 누르는 입력이 끊기지 않게)
    if (!settled && longer) return null;
    if (holding && longer && !release && !exact.some((s) => s.sustained)) return null;
    // 별이 높은 개인기 우선 (같은 커맨드면 상위 개인기)
    return exact.sort((a, b) => b.stars - a.stars)[0];
  }
}

// ---------------------------------------------------------------- 실행

/** Catmull-Rom 보간 (키 사이를 부드럽게) */
function sample(keys: Key[], t: number, out: { x: number; z: number; y: number; yaw: number }): void {
  const n = keys.length;
  if (t <= keys[0].t || n === 1) return void Object.assign(out, { x: keys[0].x, z: keys[0].z, y: keys[0].y ?? BALL.radius, yaw: keys[0].yaw ?? 0 });
  if (t >= keys[n - 1].t) {
    const k = keys[n - 1];
    return void Object.assign(out, { x: k.x, z: k.z, y: k.y ?? BALL.radius, yaw: k.yaw ?? 0 });
  }
  let i = 0;
  while (keys[i + 1].t < t) i++;
  const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(n - 1, i + 2)];
  const u = (t - p1.t) / (p2.t - p1.t);
  const cr = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  out.x = cr(p0.x, p1.x, p2.x, p3.x);
  out.z = cr(p0.z, p1.z, p2.z, p3.z);
  out.y = cr(p0.y ?? BALL.radius, p1.y ?? BALL.radius, p2.y ?? BALL.radius, p3.y ?? BALL.radius);
  // 몸 회전은 넘치지 않게 부드러운 선형
  const s = u * u * (3 - 2 * u);
  out.yaw = (p1.yaw ?? 0) + ((p2.yaw ?? 0) - (p1.yaw ?? 0)) * s;
}

interface Active {
  def: SkillDef;
  p: Player;
  t: number;
  origin: THREE.Vector3;
  fwd: THREE.Vector3;
  right: THREE.Vector3;
  /** 들어올 때 앞으로 가던 속도 */
  v0: number;
  contact: number;
  baited: boolean;
  holding: boolean;
  /** 시간 배속 (별 차이) */
  rate: number;
  /** 클립을 이 시각에 끊는다 (페이크) */
  cut: number | null;
  /** 다리 IK 개인기의 이번 틱 자세 */
  rig: RigPose | null;
  legs: LegPose | null;
}

const def = (id: string) => SKILLS.find((s) => s.id === id);
const pose = { x: 0, z: 0, y: 0, yaw: 0 };
const w = new THREE.Vector3();

export class SkillRunner {
  private readonly active = new Map<Player, Active>();

  constructor(private readonly m: Match) {}

  isActive(p: Player): boolean { return this.active.has(p); }
  current(p: Player): SkillDef | null { return this.active.get(p)?.def ?? null; }
  /** 태클 성공률 배수 */
  shield(p: Player): number { return this.active.get(p)?.def.shield ?? 1; }

  clear(): void {
    for (const p of this.active.keys()) {
      p.actionLock = p.facingLock = 0;
      p.legPose = null;
      p.model.stopMotion?.();
    }
    this.active.clear();
  }

  /** 개인기 시작. 별이 모자라거나 공이 발 근처에 없으면 false */
  start(p: Player, requested: SkillDef): boolean {
    // 같은 커맨드의 상위 기술을 요청해도 선수 별에 맞는 하위 후보로 내려간다.
    const def = requested.stars <= p.profile.skill ? requested : SKILLS
      .filter((s) => JSON.stringify(s.trigger) === JSON.stringify(requested.trigger) && s.stars <= p.profile.skill)
      .sort((a, b) => b.stars - a.stars)[0];
    if (!def) return false;
    const m = this.m;
    if (m.ball.owner !== p || p.busy || this.active.has(p) || p.profile.skill < def.stars) return false;
    const bp = m.ball.position;
    if (Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z) > 1.2 || bp.y > 0.6) return false;
    const fwd = p.facing.clone().setY(0).normalize();
    const v0 = Math.max(0, p.vel.x * fwd.x + p.vel.z * fwd.z);
    const a: Active = {
      def, p, t: 0, origin: p.pos.clone().setY(0), fwd, right: new THREE.Vector3(-fwd.z, 0, fwd.x), v0, contact: 0, baited: false, holding: false,
      rate: 1 + (def.starScale ?? 0) * Math.max(0, p.profile.skill - def.stars), cut: null, rig: null,
      legs: def.rig ? {
        L: { pos: new THREE.Vector3(), toe: new THREE.Vector3(), w: 0 }, R: { pos: new THREE.Vector3(), toe: new THREE.Vector3(), w: 0 },
        roll: 0, pitch: 0, drop: 0,
      } : null,
    };
    this.active.set(p, a);
    p.actionLock = p.facingLock = def.duration / a.rate;
    this.playMotion(a);
    m.events.push({ type: 'skill', id: def.id, player: p });
    return true;
  }

  /** 시작 때 잡은 기준 방향을 써야 몸이 돌아도 hold가 끊기지 않는다. 사이드 스텝 중 반대 방향이면 볼 롤 컷으로 이어진다 */
  hold(p: Player, shift: boolean, move: THREE.Vector3): void {
    const a = this.active.get(p);
    if (!a?.def.sustained) return;
    const trigger = a.def.trigger;
    const dir = dirOf(move, a.fwd);
    a.holding = shift && trigger.kind !== 'fake' && dir === trigger.seq[0].dir;
    // 사이드 스텝 중 반대 방향 = 볼 롤 컷 (← 꾹 → → / → 꾹 → ←)
    const back = trigger.kind !== 'fake' && trigger.seq[0].dir === 'L' ? 'R' : 'L';
    const cut = shift && dir === back && def(`ball_roll_cut_${back === 'R' ? 'r' : 'l'}`);
    if (cut && cut.stars <= p.profile.skill) {
      this.finish(a, false);
      this.start(p, cut);
      return;
    }
    if (!a.holding) this.finish(a, true);
  }

  private playMotion(a: Active): void {
    const motion = a.def.motion;
    if (!motion) return;
    const id = a.v0 > 5.2 && motion.sprintId ? motion.sprintId : motion.id;
    const entry = MOTION_CATALOG.find((e) => e.id === id);
    if (!entry) return;
    const end = motion.toKey === undefined ? entry.duration : entry.key * motion.toKey;
    const from = motion.from ?? 0;
    // 배속을 정했으면 제 속도로 재생하다 end에서 끊고(달리기로 섞여 돌아감), 아니면 개인기 길이에 맞춰 늘인다
    const speed = (motion.speed ?? (end - from) / a.def.duration) * a.rate;
    a.cut = motion.speed !== undefined ? (end - from) / speed : null;
    a.p.playMotion(entry, from, speed, motion.flat);
  }

  private toWorld(a: Active, x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(a.origin).addScaledVector(a.right, x).addScaledVector(a.fwd, z);
  }

  /** 몸: Player.update 전에 속도·방향을 정한다 */
  driveBodies(dt: number): void {
    for (const a of this.active.values()) {
      const { def, p } = a;
      if (this.m.ball.owner !== p) {
        // 뺏기거나 공이 떠났다 → 바로 끝
        this.finish(a, false);
        continue;
      }
      a.t += dt * a.rate;
      if (a.cut !== null && a.t >= a.cut * a.rate) {
        a.cut = null;
        p.model.stopMotion?.(true);
      }
      if (def.sustained && a.holding && a.t >= def.duration) {
        const end = def.body.at(-1)!;
        a.origin.addScaledVector(a.right, end.x).addScaledVector(a.fwd, end.z);
        a.t -= def.duration;
        a.contact = 0;
        this.playMotion(a);
      }
      p.actionLock = p.facingLock = Math.max(dt * 2, (def.duration - a.t) / a.rate);
      const t = Math.min(a.t, def.duration);
      if (def.rig) {
        a.rig = def.rig(t);
        Object.assign(pose, { x: a.rig.x, z: a.rig.z, yaw: a.rig.yaw });
        this.poseLegs(a, t);
      } else sample(def.body, t, pose);
      this.toWorld(a, pose.x, pose.z + a.v0 * def.carry * t, w);
      p.vel.set((w.x - p.pos.x) / dt, 0, (w.z - p.pos.z) / dt);
      const yaw = pose.yaw;
      p.facing.copy(a.fwd).multiplyScalar(Math.cos(yaw)).addScaledVector(a.right, Math.sin(yaw));
      if (def.bait && !a.baited && a.t >= def.bait.t) {
        a.baited = true;
        const ang = def.bait.dir;
        const dir = a.fwd.clone().multiplyScalar(Math.cos(ang)).addScaledVector(a.right, Math.sin(ang));
        this.bait(p, dir, def.bait.strength);
      }
      while (a.contact < def.contacts.length && a.t >= def.contacts[a.contact].t) {
        a.contact++;
        this.m.events.push({ type: 'touch', speed: 1.5, player: p });
      }
    }
  }

  /** 공: carryBall 대신 정해진 궤적을 따라가게 한다. 개인기 중이면 true */
  driveBall(dt: number, move: THREE.Vector3 | null): boolean {
    const o = this.m.ball.owner;
    const a = o && this.active.get(o);
    if (!a) return false;
    const { def } = a;
    if (a.t >= def.duration) {
      this.finish(a, true, move);
      return true;
    }
    if (a.rig) Object.assign(pose, a.rig.ball);
    else sample(def.ball, a.t, pose);
    this.toWorld(a, pose.x, pose.z + a.v0 * def.carry * a.t, w);
    const body = this.m.ball.body, bp = body.position;
    body.velocity.set((w.x - bp.x) / dt, (pose.y - bp.y) / dt, (w.z - bp.z) / dt);
    const v = body.velocity;
    body.angularVelocity.set(v.z / BALL.radius, 0, -v.x / BALL.radius);
    return true;
  }

  /** 다리 IK 목표를 월드로 바꿔 선수에 건다 (화면 전용) */
  private poseLegs(a: Active, t: number): void {
    const r = a.rig!, legs = a.legs!;
    const carry = a.v0 * a.def.carry * t;
    for (const side of ['L', 'R'] as const) {
      const f = r[side], out = legs[side];
      this.toWorld(a, f.x, f.z + carry, out.pos).setY(f.y);
      const c = Math.cos(f.pitch);
      out.toe.copy(a.fwd).multiplyScalar(Math.cos(f.yaw) * c).addScaledVector(a.right, Math.sin(f.yaw) * c).setY(Math.sin(f.pitch));
      out.w = f.w;
    }
    legs.roll = r.roll; legs.pitch = r.pitch; legs.drop = r.drop;
    a.p.legPose = legs;
  }

  private finish(a: Active, normal: boolean, move: THREE.Vector3 | null = null): void {
    const { def, p } = a;
    this.active.delete(p);
    p.legPose = null;
    p.actionLock = 0;
    p.facingLock = 0;
    p.model.stopMotion?.();
    if (!normal) return;
    // 끝 방향: 정해진 방향, 또는 그때 누른 방향
    let dir: THREE.Vector3;
    let speed = def.exit.speed + a.v0 * def.carry, vy = 0;
    if (def.rig) {
      // 다리 IK 개인기는 공이 마지막 순간 움직이던 그대로 나간다 (속도가 튀지 않게, 떠 있는 공은 포물선 그대로)
      const e = def.rig(def.duration).ball, s = def.rig(def.duration - 0.02).ball;
      const lx = (e.x - s.x) / 0.02, lz = (e.z - s.z) / 0.02 + a.v0 * def.carry;
      dir = a.fwd.clone().multiplyScalar(lz).addScaledVector(a.right, lx);
      speed = Math.max(def.exit.speed * 0.5, dir.length());
      dir.normalize();
      vy = (e.y - s.y) / 0.02;
    } else dir = a.fwd.clone().multiplyScalar(Math.cos(def.exit.dir)).addScaledVector(a.right, Math.sin(def.exit.dir));
    if (def.exit.input && move && move.lengthSq() > 0.25) dir = move.clone().setY(0).normalize();
    this.m.ball.body.velocity.set(dir.x * speed, vy, dir.z * speed);
    this.m.ball.body.angularVelocity.set(dir.z * speed / BALL.radius, 0, -dir.x * speed / BALL.radius);
    p.vel.copy(dir).multiplyScalar(def.exit.body + a.v0 * def.carry);
    p.facing.copy(dir);
    if (def.exit.speed > 1.5) this.m.events.push({ type: 'touch', speed, player: p });
  }

  /** 가까운 상대 수비가 dir 쪽으로 속는다 (사용자 조작 선수는 제외) */
  private bait(carrier: Player, dir: THREE.Vector3, strength: number): void {
    for (const d of this.m.players) {
      if (d.team === carrier.team || d.isKeeper || this.m.isUserControlled(d)) continue;
      const dist = d.pos.distanceTo(carrier.pos);
      if (dist > 4.5) continue;
      // 수비 능력이 좋을수록 덜 속는다
      const fooled = strength * (1.15 - 0.7 * d.stat('defAwareness')) * (1 - dist / 6);
      if (fooled <= 0.05) continue;
      d.wrongFoot = Math.max(d.wrongFoot, 0.45 * fooled + 0.1);
      d.baitDir.copy(dir);
    }
  }
}
