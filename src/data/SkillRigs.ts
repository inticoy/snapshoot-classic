import { BALL } from '../config';
import type { Key, RigFoot, RigPose } from '../gameplay/Skills';

/**
 * 다리를 직접 움직이는 개인기 (모션 데이터에 없는 헛다리·위아래·마르세유·사포).
 *
 * 좌표는 개인기 시작 위치·방향 기준 (x = 오른쪽, z = 앞, y = 위, m). yaw + = 오른쪽으로.
 * 캐릭터 치수 (GLB): 발목 높이 0.07, 발목→발끝 0.13, 허벅지 0.45 + 정강이 0.47, 서 있을 때 발목 x = ±0.11.
 * 공이 발에 닿는 순간은 sole·inside·heel 같은 도우미로 '그 공 자리에 발 부위가 오도록' 발목 위치를 계산한다.
 * 그래서 공 궤적과 발이 같은 숫자에서 나와 늘 맞는다.
 */

const R = BALL.radius;
const ANKLE = 0.07;
type V = [number, number, number, number, number]; // 발목 x, y, z, 발 yaw, 발 pitch

/** 시간 키 사이를 Catmull-Rom으로 잇는다. keys: [t, 값...] */
function track(keys: number[][]): (t: number) => number[] {
  const n = keys.length;
  return (t) => {
    if (t <= keys[0][0]) return keys[0].slice(1);
    if (t >= keys[n - 1][0]) return keys[n - 1].slice(1);
    let i = 0;
    while (keys[i + 1][0] < t) i++;
    const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(n - 1, i + 2)];
    const u = (t - p1[0]) / (p2[0] - p1[0]);
    const out: number[] = [];
    for (let k = 1; k < p1.length; k++) {
      const a = p0[k], b = p1[k], c = p2[k], d = p3[k];
      out.push(0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u));
    }
    return out;
  };
}

/**
 * 공은 곡선으로 잇지 않고 직선으로 잇는다: 발이 닿기 전엔 가만히 있다가(또는 일정하게 구르다가) 닿는 순간 속도가 바뀐다.
 * 곡선으로 이으면 발이 닿기도 전에 공이 미리 움직여 '혼자 움직이는 공'처럼 보인다.
 */
function linear(keys: number[][]): (t: number) => number[] {
  const n = keys.length;
  return (t) => {
    if (t <= keys[0][0]) return keys[0].slice(1);
    if (t >= keys[n - 1][0]) return keys[n - 1].slice(1);
    let i = 0;
    while (keys[i + 1][0] < t) i++;
    const a = keys[i], b = keys[i + 1], u = (t - a[0]) / (b[0] - a[0]);
    return a.slice(1).map((v, k) => v + (b[k + 1] - v) * u);
  };
}

const G = 9.81;
/** 떠 있는 공: t0에 p0에서 속도 v로 차올린 포물선을 촘촘한 키로 */
function flight(t0: number, p0: B, v: B, t1: number): number[][] {
  const keys: number[][] = [];
  for (let t = t0; t <= t1 + 1e-9; t += 0.02) {
    const s = t - t0;
    keys.push([t, p0[0] + v[0] * s, p0[1] + v[1] * s - 0.5 * G * s * s, p0[2] + v[2] * s]);
  }
  return keys;
}

const fwd = (yaw: number): [number, number] => [Math.sin(yaw), Math.cos(yaw)];
const right = (yaw: number): [number, number] => [Math.cos(yaw), -Math.sin(yaw)];
/** 몸 기준 (lx 오른쪽, lz 앞) → 시작 기준 좌표 */
function local(bx: number, bz: number, yaw: number, lx: number, lz: number): [number, number] {
  const [fx, fz] = fwd(yaw), [rx, rz] = right(yaw);
  return [bx + rx * lx + fx * lz, bz + rz * lx + fz * lz];
}

type B = [number, number, number];
/** 발바닥을 공 위에 (밟기·끌기) */
function sole([x, y, z]: B, yaw: number): V {
  const [fx, fz] = fwd(yaw);
  return [x - fx * 0.05, y + R + ANKLE, z - fz * 0.05, yaw, 0.1];
}
/** 발 안쪽으로 공 뒤에서 민다 (발끝을 바깥으로 돌린다). side: 오른발 1, 왼발 -1 */
function inside([x, , z]: B, yaw: number, side: 1 | -1): V {
  const [fx, fz] = fwd(yaw), [rx, rz] = right(yaw);
  return [x - fx * (R + 0.03) + rx * side * 0.06, 0.08, z - fz * (R + 0.03) + rz * side * 0.06, yaw + side * 1.1, 0];
}
/** 발등(신발끈)으로 공 뒤에서 민다 */
function instep([x, , z]: B, yaw: number): V {
  const [fx, fz] = fwd(yaw);
  return [x - fx * (R + 0.08), 0.11, z - fz * (R + 0.08), yaw, -0.35];
}
/** 뒤꿈치로 공을 뒤로 친다 (발목이 공 앞에) */
function heel([x, y, z]: B, yaw: number): V {
  const [fx, fz] = fwd(yaw);
  return [x + fx * (R + 0.05), y + 0.04, z + fz * (R + 0.05), yaw, 0.25];
}
/** 몸 기준 자리에 디딘다 */
function plant(bx: number, bz: number, yaw: number, lx: number, lz: number, footYaw = 0): V {
  const [x, z] = local(bx, bz, yaw, lx, lz);
  return [x, ANKLE, z, yaw + footYaw, 0];
}
const at = (t: number, v: V) => [t, ...v];
/** 같은 자리에서 발을 든다 */
const lift = (v: V, y: number): V => [v[0], y, v[2], v[3], v[4]];
const foot = (v: number[], w = 1): RigFoot => ({ x: v[0], y: Math.max(ANKLE, v[1]), z: v[2], yaw: v[3], pitch: v[4], w });

/** 몸 [x, z, yaw, roll, pitch, drop] · 공 [x, y, z] · 두 발 트랙으로 자세 함수를 만든다 */
function rig(body: number[][], ball: number[][], L: number[][], R_: number[][]): (t: number) => RigPose {
  const b = track(body), o = linear(ball), l = track(L), r = track(R_);
  return (t) => {
    const [x, z, yaw, roll, pitch, drop] = b(t);
    const [bx, by, bz] = o(t);
    return { x, z, yaw, roll, pitch, drop, ball: { x: bx, y: Math.max(R, by), z: bz }, L: foot(l(t)), R: foot(r(t)) };
  };
}

/** body·ball 키 사본 (sustained 반복·텔레메트리·문서용) */
export function rigKeys(f: (t: number) => RigPose, duration: number): { body: Key[]; ball: Key[] } {
  const body: Key[] = [], ball: Key[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = (duration * i) / 12, p = f(t);
    body.push({ t, x: p.x, z: p.z, yaw: p.yaw });
    ball.push({ t, x: p.ball.x, z: p.ball.z, y: p.ball.y });
  }
  return { body, ball };
}

// ---------------------------------------------------------------- 헛다리 (오른쪽 스텝오버)
/** 오른발을 공 앞으로 안→밖 크게 돌려 넘기며 몸을 오른쪽으로 싣고(속임), 오른발을 공 오른쪽에 디딘 뒤
 *  왼발 발등으로 공을 왼쪽 앞으로 치고 나간다. 0.6초 */
export function stepOverRig(): (t: number) => RigPose {
  const b0: B = [0, R, 0.45];
  const out: B = [-0.05, R, 0.82];
  return rig(
    [[0, 0, 0, 0, 0, 0.05, 0.02], [0.18, 0.04, 0.05, 0.1, 0.06, 0.08, 0.05], [0.34, 0.14, 0.1, 0.3, 0.26, 0.08, 0.09],
      [0.48, 0.06, 0.2, 0, -0.06, 0.1, 0.05], [0.6, 0, 0.34, -0.2, -0.08, 0.1, 0.03]],
    [[0, ...b0], [0.46, ...b0], [0.6, ...out]],
    [at(0, plant(0, 0, 0, -0.11, -0.02)), at(0.38, plant(0, 0, 0, -0.11, -0.02, -0.1)), [0.42, -0.08, 0.14, 0.12, -0.3, 0],
      at(0.46, instep(b0, -0.12)), [0.6, -0.08, 0.12, 0.58, -0.12, 0]],
    [at(0, plant(0, 0, 0, 0.11, -0.02)), [0.1, -0.14, 0.22, 0.38, -0.3, 0.1], [0.2, -0.02, 0.42, 0.7, 0.2, 0.2],
      [0.28, 0.2, 0.32, 0.62, 0.7, 0.1], [0.36, 0.3, ANKLE, 0.42, 0.5, 0], [0.48, 0.3, ANKLE, 0.42, 0.5, 0], [0.6, 0.22, 0.1, 0.5, 0, 0]],
  );
}

// ---------------------------------------------------------------- 위아래 (힐 투 힐 플릭)
/** 오른발을 공 너머로 뻗어 뒤꿈치로 공을 왼발 쪽 뒤로 끌어 치고, 왼발 안쪽으로 받아 바로 앞으로 밀고 나간다. 0.6초.
 *  공은 0.2초까지 그대로 → 뒤꿈치에 맞아 왼발 쪽으로 → 0.38초 왼발 안쪽에 맞아 앞으로 (닿을 때만 방향이 바뀐다) */
export function heelFlickRig(): (t: number) => RigPose {
  const b0: B = [0.06, R, 0.43], b2: B = [-0.13, R, 0.24], out: B = [0.02, R, 0.9];
  return rig(
    // 오른발을 뻗을 때 몸이 앞으로 실리고 왼쪽 디딤발 위로, 왼발로 밀 때 다시 오른쪽으로
    [[0, 0, 0, 0, 0, 0.06, 0.02], [0.16, 0, 0.1, 0, 0.04, 0.14, 0.06], [0.24, 0, 0.14, 0, 0.02, 0.12, 0.08],
      [0.38, -0.03, 0.2, -0.08, -0.06, 0.1, 0.06], [0.5, -0.01, 0.34, -0.04, -0.02, 0.1, 0.04], [0.6, 0, 0.46, 0, 0, 0.1, 0.03]],
    [[0, ...b0], [0.2, ...b0], [0.38, ...b2], [0.6, ...out]],
    [at(0, plant(0, 0, 0, -0.11, -0.02)), at(0.26, plant(0, 0, 0, -0.11, -0.02)), [0.32, -0.24, 0.13, 0.06, -0.9, 0],
      at(0.38, inside(b2, 0, -1)), [0.48, -0.12, 0.14, 0.42, -0.5, 0.1], [0.6, -0.08, ANKLE, 0.62, 0, 0]],
    [at(0, plant(0, 0, 0, 0.11, -0.02)), [0.09, 0.15, 0.2, 0.28, 0.1, 0.1], [0.16, 0.08, 0.22, 0.6, 0, 0.2],
      at(0.2, heel(b0, 0)), [0.29, -0.03, 0.16, 0.4, -0.25, 0.1], [0.38, 0.09, 0.1, 0.42, 0, 0], [0.44, 0.1, ANKLE, 0.46, 0, 0], [0.6, 0.12, ANKLE, 0.6, 0, 0]],
  );
}

// ---------------------------------------------------------------- 마르세유 (오른쪽 룰렛)
/** 오른발 바닥으로 공을 끌며 오른쪽으로 반 바퀴, 공을 등지고 왼발 바닥으로 이어 끌며 나머지 반 바퀴 돌아 앞으로 나간다. 0.9초.
 *  공은 거의 제자리에 두고 몸이 공 둘레를 돈다: 공의 몸 기준 자리와 월드 자리를 정해 몸 위치를 거꾸로 구한다.
 *  발바닥이 공 위에 있는 동안(끌기)만 공이 발을 따라 움직이고, 발을 바꾸는 사이에는 공이 멈춰 있다 */
export function rouletteRig(): (t: number) => RigPose {
  const D = 0.9, s = (t: number) => t * D; // 1초 기준 키를 0.9초로
  const yawT = track([[0, 0], [s(0.12), 0.15], [s(0.5), Math.PI], [s(0.85), 2 * Math.PI - 0.12], [D, 2 * Math.PI]]);
  // 월드 공: 오른발로 끌기(0.12~0.34) → 멈춤 → 왼발로 끌기(0.55~0.75) → 멈춤 → 앞으로 밀기
  const ballKeys = [[0, 0.08, R, 0.42], [s(0.12), 0.08, R, 0.42], [s(0.34), 0.24, R, 0.33], [s(0.55), 0.24, R, 0.33], [s(0.75), 0.4, R, 0.42], [s(0.86), 0.4, R, 0.42], [D, 0.44, R, 0.62]];
  const ballT = linear(ballKeys);
  // 공의 몸 기준 자리: 앞 → 오른발 밑 → (반 바퀴) 왼발 앞 → 왼발 밑 → 다시 앞
  const ballLocal = track([[0, 0.08, 0.42], [s(0.3), 0.16, 0.24], [s(0.5), -0.12, 0.26], [s(0.75), -0.14, 0.22], [D, 0, 0.45]]);
  const bodyAt = (t: number): [number, number, number] => {
    const yaw = yawT(t)[0], [x, , z] = ballT(t), [lx, lz] = ballLocal(t);
    const [fx, fz] = fwd(yaw), [rx, rz] = right(yaw);
    return [x - rx * lx - fx * lz, z - rz * lx - fz * lz, yaw];
  };
  const times = Array.from({ length: 19 }, (_, i) => (D * i) / 18);
  // 돌 때 바깥으로 살짝 기울고 몸을 낮춘다
  const body = times.map((t) => { const [x, z, yaw] = bodyAt(t); return [t, x, z, yaw, 0.08 * Math.sin((t / D) * Math.PI * 2), 0.14, 0.08]; });
  const B3 = (t: number): B => ballT(t) as B;
  const yawAt = (t: number) => yawT(t)[0];
  const plantAt = (t: number, lx: number, lz: number, fy = 0) => { const [x, z, yaw] = bodyAt(t); return plant(x, z, yaw, lx, lz, fy); };
  return rig(
    body,
    ballKeys,
    // 왼발: 처음 반 바퀴는 축발 → 뜬 뒤 바닥으로 공을 받아 끈다 → 디딘다
    [at(0, plantAt(0, -0.11, -0.02)), at(s(0.36), plantAt(s(0.22), -0.11, -0.02)), at(s(0.46), lift(plantAt(s(0.46), -0.12, 0.1), 0.22)),
      at(s(0.55), sole(B3(s(0.55)), yawAt(s(0.55)))), at(s(0.75), sole(B3(s(0.75)), yawAt(s(0.75)))), at(s(0.83), lift(plantAt(s(0.83), -0.1, 0.05), 0.16)),
      at(s(0.93), plantAt(s(0.95), -0.11, 0)), at(D, plantAt(D, -0.11, 0))],
    // 오른발: 공을 밟아 끌며 돈다 → 왼발 뒤로 디뎌 축발 → 마지막에 공을 앞으로 민다
    [at(0, plantAt(0, 0.11, -0.02)), at(s(0.07), lift(plantAt(s(0.07), 0.1, 0.15), 0.2)), at(s(0.12), sole(B3(s(0.12)), yawAt(s(0.12)))), at(s(0.34), sole(B3(s(0.34)), yawAt(s(0.34)))),
      at(s(0.42), lift(plantAt(s(0.42), 0.14, -0.05), 0.2)), at(s(0.5), plantAt(s(0.6), 0.13, -0.05)), at(s(0.8), plantAt(s(0.6), 0.13, -0.05)),
      at(s(0.86), inside(B3(s(0.86)), yawAt(s(0.86)), 1)), at(D, lift(plantAt(D, 0.12, 0.25), 0.12))],
  );
}

// ---------------------------------------------------------------- 사포 (레인보우 플릭)
/** 오른발 바닥으로 공을 뒤로 굴려 왼발 뒤꿈치에 대고, 오른발 발끝으로 왼쪽 종아리 뒤로 들어 올린 뒤
 *  왼발 뒤꿈치로 차올려 머리 위로 넘긴다. 공은 뒤꿈치를 떠난 뒤 진짜 포물선(중력)으로 난다. 0.9초 */
export function rainbowRig(): (t: number) => RigPose {
  // 등 뒤에서 머리(1.8m) 위 2.3m까지 크게 넘어가 3m쯤 앞에 떨어지는 속도 (몸을 빙 돌아 넘어가 보이게)
  const T = 0.42, p0: B = [-0.04, 0.32, -0.34], v: B = [0.06, 6.7, 2.3];
  return rig(
    // 올릴 때 몸을 숙였다가, 차올릴 땐 몸을 세우고 살짝 젖힌다 (공이 머리 위로 지나가게)
    [[0, 0, 0, 0, 0, 0.06, 0.02], [0.22, 0, 0.02, 0, 0.02, 0.16, 0.08], [0.36, 0, 0.02, 0, 0.04, 0.1, 0.07], [0.46, 0, 0.02, 0, 0, -0.06, 0.03],
      [0.7, 0, 0.12, 0, 0, 0.04, 0.02], [0.9, 0, 0.4, 0, 0, 0.12, 0.03]],
    [[0, 0.05, R, 0.42], [0.1, 0.05, R, 0.42], [0.24, 0.0, R, 0.02], [0.3, -0.03, R, -0.16], [0.38, -0.04, 0.24, -0.22], ...flight(T, p0, v, 0.9)],
    // 왼발: 공 뒤쪽으로 반걸음 디딤(뒤꿈치가 공 앞) → 뒤꿈치로 차올림(무릎을 굽혀 발이 뒤로 높이) → 내려와 앞으로
    [at(0, plant(0, 0, 0, -0.11, -0.02)), [0.14, -0.08, 0.14, -0.04, 0, 0.1], at(0.2, plant(0, 0, 0, -0.06, -0.06)), at(0.38, plant(0, 0, 0, -0.06, -0.06)),
      [0.48, -0.05, 0.42, -0.24, 0, -0.7], [0.6, -0.06, 0.16, -0.02, 0, 0], [0.7, -0.08, ANKLE, 0.12, 0, 0], [0.9, -0.1, ANKLE, 0.4, 0, 0]],
    // 오른발: 공 위에 바닥 → 굴려 당김 → 발끝을 공 밑에 넣어 왼발 뒤꿈치 위로 들어 올림 → 디딤
    [at(0, plant(0, 0, 0, 0.11, -0.02)), [0.06, 0.08, 0.22, 0.28, 0, 0.1], at(0.1, sole([0.05, R, 0.42], 0)), at(0.24, sole([0.0, R, 0.02], 0)),
      [0.32, 0.02, 0.12, 0.0, -0.3, -0.5], [0.38, 0.02, 0.2, -0.06, -0.3, -0.6], [0.46, 0.1, 0.1, 0.08, 0, 0], [0.52, 0.11, ANKLE, 0.1, 0, 0], [0.9, 0.12, ANKLE, 0.45, 0, 0]],
  );
}

// ---------------------------------------------------------------- 드래그백
/** 오른발 바닥으로 공을 밟아 몸 쪽으로 끌어당기며 한 걸음 물러나고, 오른쪽으로 반 바퀴 돌아 공을 몸 앞에 둔다. 0.6초.
 *  공은 발바닥이 공 위에 있는 동안 발과 함께 뒤로 구르고, 발을 떼면 그 속도로 계속 구른다 */
export function dragBackRig(): (t: number) => RigPose {
  const b0: B = [0.07, R, 0.42], b1: B = [0.07, R, 0.08], bEnd: B = [0.07, R, -0.6];
  return rig(
    // 공을 밟을 때 앞으로 실렸다가, 끌면서 뒤로 물러나며 오른쪽으로 돈다
    [[0, 0, 0, 0, 0, 0.06, 0.02], [0.12, 0, 0.02, 0, 0.03, 0.12, 0.05], [0.3, 0, -0.1, 0.2, 0, 0.04, 0.06],
      [0.45, 0.03, -0.2, Math.PI * 0.65, -0.04, 0.06, 0.06], [0.6, 0.06, -0.3, Math.PI, 0, 0.1, 0.03]],
    [[0, ...b0], [0.12, ...b0], [0.3, ...b1], [0.6, ...bEnd]],
    // 왼발: 축발로 버티다가 몸이 돌 때 한 걸음 옮긴다
    [at(0, plant(0, 0, 0, -0.11, -0.02)), at(0.3, plant(0, 0, 0, -0.11, -0.02)), [0.4, -0.02, 0.16, -0.24, 1.6, 0], at(0.5, plant(0.06, -0.3, Math.PI, -0.11, 0.05, 0)), at(0.6, plant(0.06, -0.3, Math.PI, -0.11, 0.05, 0))],
    // 오른발: 공 위로 → 바닥으로 밟아 끌기 → 공을 놓고 뒤로 디뎌 돌기
    [at(0, plant(0, 0, 0, 0.11, -0.02)), [0.07, 0.1, 0.22, 0.3, 0, 0.1], at(0.12, sole(b0, 0)), at(0.3, sole(b1, 0)),
      [0.38, 0.14, 0.14, -0.12, 0.6, 0], at(0.46, plant(0.06, -0.3, Math.PI, 0.12, -0.05, 0)), at(0.6, plant(0.06, -0.3, Math.PI, 0.12, 0.0, 0))],
  );
}
