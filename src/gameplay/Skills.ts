import * as THREE from 'three';
import { BALL } from '../config';
import { MOTION_CATALOG } from '../data/MotionCatalog';
import { selectMotion, type MotionKind } from '../anim/MotionLibrary';
import type { Player } from '../entities/Player';
import type { Match } from './Match';

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
  body: Key[];
  ball: Key[];
  /** 발이 공을 건드리는 순간 (터치 소리, 동작-공 일치 검증) */
  contacts: { t: number; foot: 'L' | 'R' }[];
  /** 몸 동작: 종류·공 방향(시작 기준 rad)으로 고른 클립의 [from, to) 구간 (to는 터치 순간 기준 비율) */
  motion?: { kind: MotionKind; angle: number; from?: number; toKey?: number; speed?: number };
  /** 끝날 때 공 방향(시작 기준 rad, + = 오른쪽)·속도와 몸 속도. input = 그때 누른 방향이 있으면 그쪽 */
  exit: { dir: number; speed: number; body: number; input?: boolean };
  /** AI 수비를 속이는 순간과 방향 (rad). 가까운 수비가 잠깐 그쪽으로 몸을 싣는다 */
  bait?: { t: number; dir: number; strength: number };
  shield: number;
}

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
    motion: d.motion && { ...d.motion, angle: -d.motion.angle },
    exit: { ...d.exit, dir: -d.exit.dir },
    bait: d.bait && { ...d.bait, dir: -d.bait.dir },
  };
}

// ---------------------------------------------------------------- 기준 개인기 3종

/** 페이크 슛 (D 게이지 중 S): 슛 동작을 공 직전에 멈추고 발바닥으로 공을 세운다. 누른 방향이 있으면 그쪽으로 접는다 */
const FAKE_SHOT: SkillDef = {
  id: 'fake_shot', name: '페이크 슛', stars: 1,
  trigger: { kind: 'fake', from: 'shoot' },
  duration: 0.62, carry: 0.25,
  body: [{ t: 0, x: 0, z: 0 }, { t: 0.3, x: 0, z: 0.12 }, { t: 0.62, x: 0, z: 0.2 }],
  ball: [{ t: 0, x: 0.12, z: 0.5 }, { t: 0.3, x: 0.1, z: 0.55 }, { t: 0.62, x: 0.08, z: 0.58 }],
  contacts: [{ t: 0.5, foot: 'R' }],
  motion: { kind: 'shot', angle: 0, toKey: 0.85 },
  exit: { dir: 0, speed: 1.2, body: 1, input: true },
  bait: { t: 0.25, dir: 0, strength: 1 },
  shield: 0.85,
};

/** 드래그백 (Z + ↓): 발바닥으로 공을 뒤로 끌며 몸을 돌린다 */
const DRAG_BACK: SkillDef = {
  id: 'drag_back', name: '드래그백', stars: 2,
  trigger: { kind: 'z', seq: [{ dir: 'B' }] },
  duration: 0.6, carry: 0,
  body: [{ t: 0, x: 0, z: 0, yaw: 0 }, { t: 0.2, x: 0, z: -0.08, yaw: 0.2 }, { t: 0.6, x: -0.05, z: -0.3, yaw: Math.PI }],
  ball: [{ t: 0, x: 0.1, z: 0.45 }, { t: 0.12, x: 0.1, z: 0.4 }, { t: 0.38, x: 0.04, z: -0.15 }, { t: 0.6, x: 0, z: -0.75 }],
  contacts: [{ t: 0.12, foot: 'R' }],
  motion: { kind: 'control', angle: Math.PI },
  exit: { dir: Math.PI, speed: 2.4, body: 1.6, input: true },
  bait: { t: 0.1, dir: 0, strength: 0.6 },
  shield: 0.7,
};

/** 속임 동작 (Shift + → 짧게): 몸을 오른쪽으로 실었다가 그대로 앞으로 */
const FEINT_RIGHT: SkillDef = {
  id: 'feint_r', name: '오른쪽 속임 동작', stars: 2,
  trigger: { kind: 'shift', seq: [{ dir: 'R', tap: true }] },
  duration: 0.45, carry: 0.7,
  body: [{ t: 0, x: 0, z: 0, yaw: 0 }, { t: 0.17, x: 0.12, z: 0, yaw: 0.45 }, { t: 0.45, x: 0.02, z: 0, yaw: 0 }],
  ball: [{ t: 0, x: 0, z: 0.5 }, { t: 0.45, x: 0, z: 0.55 }],
  contacts: [],
  motion: { kind: 'control', angle: Math.PI / 4, toKey: 0.7 },
  exit: { dir: 0, speed: 2.2, body: 2.5 },
  bait: { t: 0.12, dir: Math.PI / 2, strength: 1 },
  shield: 0.8,
};

export const SKILLS: SkillDef[] = [
  FAKE_SHOT,
  { ...FAKE_SHOT, id: 'fake_pass', name: '페이크 크로스', trigger: { kind: 'fake', from: 'lob' } },
  DRAG_BACK,
  FEINT_RIGHT,
  mirror(FEINT_RIGHT, 'feint_l', '왼쪽 속임 동작'),
];

// ---------------------------------------------------------------- 커맨드 인식

export const SKILL_INPUT = {
  /** 이 시간 이상 누르면 hold */
  hold: 0.3,
  /** 방향을 놓고 이 시간이 지나면 커맨드를 확정 */
  settle: 0.12,
  /** 칸 사이 최대 간격 (넘으면 처음부터) */
  gap: 0.45,
  /** 방향 입력으로 보는 최소 크기 */
  dead: 0.5,
};

interface Step { dir: Dir; t0: number; t1: number | null }

/** 바라보는 방향(fwd) 기준 8방향 */
export function dirOf(move: THREE.Vector3, fwd: THREE.Vector3): Dir | null {
  if (move.lengthSq() < SKILL_INPUT.dead * SKILL_INPUT.dead) return null;
  const f = move.x * fwd.x + move.z * fwd.z;
  // 오른쪽 = forward × up = (-fz, 0, fx)
  const r = -move.x * fwd.z + move.z * fwd.x;
  const i = Math.round(Math.atan2(r, f) / (Math.PI / 4));
  return DIRS[(i + 8) % 8];
}

function matches(seq: Token[], steps: Step[], now: number, release: boolean): boolean {
  if (seq.length !== steps.length) return false;
  return seq.every((tok, i) => {
    const s = steps[i];
    const held = (s.t1 ?? now) - s.t0;
    // 짧게(tap)는 뗀 뒤에야 짧았는지 안다 (보조키를 떼면 그 순간까지로 본다)
    const tapOk = !tok.tap || ((s.t1 !== null || release) && held < SKILL_INPUT.hold);
    return s.dir === tok.dir && (!tok.hold || held >= SKILL_INPUT.hold) && tapOk;
  });
}

/**
 * Shift·Z를 누른 동안의 방향 입력을 모아 커맨드를 찾는다.
 * 방향은 보조키를 누른 순간의 몸 방향 기준으로 고정한다 (도는 중에 기준이 바뀌지 않게).
 */
export class SkillInput {
  private mode: 'shift' | 'z' | null = null;
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private steps: Step[] = [];
  private last: Dir | null = null;
  private time = 0;
  private changed = 0;
  /** 보조키를 누르기 직전 프레임에 누르고 있던 방향 */
  private before: Dir | null = null;

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
      this.fwd.copy(facing);
      // 보조키를 누르기 전부터 누르고 있던 방향(달리던 방향)은 커맨드에 넣지 않는다. 한 번 떼고 다시 누르면 넣는다
      const now = dirOf(move, this.fwd);
      this.last = mode && now === this.before ? now : null;
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
        if (prev && this.time - (prev.t1 ?? this.time) > SKILL_INPUT.gap) this.steps = [];
        this.steps.push({ dir, t0: this.time, t1: null });
      }
      this.last = dir;
      this.changed = this.time;
    }
    const found = this.find(list, false);
    if (found) this.steps = [];
    return found;
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
    if ((longer || holding) && !settled) return null;
    if (holding && longer) return null;
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
}

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
    for (const p of this.active.keys()) p.actionLock = p.facingLock = 0;
    this.active.clear();
  }

  /** 개인기 시작. 별이 모자라거나 공이 발 근처에 없으면 false */
  start(p: Player, def: SkillDef): boolean {
    const m = this.m;
    if (m.ball.owner !== p || p.busy || this.active.has(p) || p.profile.skill < def.stars) return false;
    const bp = m.ball.position;
    if (Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z) > 1.2 || bp.y > 0.6) return false;
    const fwd = p.facing.clone().setY(0).normalize();
    const v0 = Math.max(0, p.vel.x * fwd.x + p.vel.z * fwd.z);
    const a: Active = {
      def, p, t: 0, origin: p.pos.clone().setY(0), fwd, right: new THREE.Vector3(-fwd.z, 0, fwd.x), v0, contact: 0, baited: false,
    };
    this.active.set(p, a);
    p.actionLock = def.duration;
    p.facingLock = def.duration;
    if (def.motion) {
      const pick = selectMotion(MOTION_CATALOG, { kind: def.motion.kind, speed: v0 < 0.8 ? 'idle' : v0 < 5.2 ? 'walk' : 'sprint', angle: def.motion.angle, foot: 'R', random: m.random.next() });
      if (pick) {
        const e = pick.entry;
        // 구간 재생: toKey가 있으면 터치 순간 앞에서 끊는다 (페이크), 길이는 개인기 길이에 맞춘다
        const end = def.motion.toKey !== undefined ? e.key * def.motion.toKey : e.duration;
        const from = def.motion.from ?? 0;
        p.playMotion(e, from, def.motion.speed ?? Math.max(0.6, (end - from) / def.duration));
      }
    }
    m.events.push({ type: 'skill', id: def.id, player: p });
    return true;
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
      a.t += dt;
      const t = Math.min(a.t, def.duration);
      sample(def.body, t, pose);
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
    sample(def.ball, a.t + dt, pose);
    this.toWorld(a, pose.x, pose.z + a.v0 * def.carry * (a.t + dt), w);
    const body = this.m.ball.body, bp = body.position;
    body.velocity.set((w.x - bp.x) / dt, (pose.y - bp.y) / dt, (w.z - bp.z) / dt);
    const v = body.velocity;
    body.angularVelocity.set(v.z / BALL.radius, 0, -v.x / BALL.radius);
    return true;
  }

  private finish(a: Active, normal: boolean, move: THREE.Vector3 | null = null): void {
    const { def, p } = a;
    this.active.delete(p);
    p.actionLock = 0;
    p.facingLock = 0;
    if (!normal) return;
    // 끝 방향: 정해진 방향, 또는 그때 누른 방향
    let dir: THREE.Vector3;
    if (def.exit.input && move && move.lengthSq() > 0.25) dir = move.clone().setY(0).normalize();
    else dir = a.fwd.clone().multiplyScalar(Math.cos(def.exit.dir)).addScaledVector(a.right, Math.sin(def.exit.dir));
    const speed = def.exit.speed + a.v0 * def.carry;
    this.m.ball.body.velocity.set(dir.x * speed, 0, dir.z * speed);
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
