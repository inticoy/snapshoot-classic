/**
 * 외부 동작 → 우리 캐릭터용 동작 라이브러리.
 *   npx vite-node scripts/bake-motions.ts
 * 입력: mocap-local/ (git 제외: Rohr 모션캡처 FBX, Google Research Football .anim)
 * 출력: public/assets/motions.json (뼈 회전 키프레임), src/data/MotionCatalog.ts (선택기용 태그)
 *
 * 모든 클립은 "시작할 때 몸이 +Z를 보도록" 돌려서 굽고, 공이 나가는 방향은 그 시작 방향 기준 각도로 적는다.
 * 게임은 지금 바라보는 방향 그대로 클립을 시작하고, 원하는 공 방향과 가장 가까운 클립을 고른다 (GRF 엔진과 같은 방식).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { bakeClip, bodyYaw, sliceSource, type Joint, type PoseSource } from '../src/anim/Retarget';
import { fbxSource, grfSource, parseGrf, toThree, GRF_FPS, type GrfAnim } from '../src/anim/Sources';

const FPS = 30;
const ROOT = 'mocap-local';

// ---------------------------------------------------------------- 캐릭터
const glb = readFileSync('public/assets/models/player.glb');
const gltf = await new Promise<{ scene: THREE.Group }>((res, rej) =>
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', res as never, rej));
const character = gltf.scene;
character.updateMatrixWorld(true);

// ---------------------------------------------------------------- 태그
export type MotionKind = 'pass' | 'lob' | 'shot' | 'dive' | 'save' | 'slide' | 'fall' | 'getup' | 'throw' | 'celebrate' | 'card' | 'trap' | 'control';
interface Entry {
  id: string;
  kind: MotionKind;
  source: 'mocap' | 'grf';
  /** 공에 닿는 발 (킥) / 몸을 던지는 쪽 (다이빙: L = 왼쪽(+X)) */
  side: 'L' | 'R' | null;
  /** 들어올 때 속도: idle 정지, walk 걷기·드리블, sprint 질주 */
  speed: 'idle' | 'walk' | 'sprint';
  /** 핵심 순간(터치)까지 시간 (초) */
  key: number;
  duration: number;
  /** 몸 기준 공이 나가는 방향 (라디안, + = 왼쪽) */
  ballAngle: number;
  /** 핵심 순간 대비 클립이 끝날 때 몸이 돌아 있는 각도 */
  endYaw: number;
  /** 핵심 순간 대비 클립이 시작할 때 몸 각도 */
  startYaw: number;
  /** GRF 세기 상한 (0..1) */
  power: number;
  /** 터치 높이 (m, 대략) */
  height: number;
  /** 이 동작 뒤에 이어 붙일 동작 (슬라이딩·넘어짐 → 일어나기) */
  next?: string;
}

const catalog: Entry[] = [];
const clips: Record<string, { hips: number[]; q: number[] }> = {};
let boneNames: string[] = [];

const round = (v: number) => Math.round(v * 1000) / 1000;

function add(e: Omit<Entry, 'duration' | 'endYaw' | 'startYaw' | 'id'> & { name: string }, src: PoseSource, mirror: boolean): void {
  const id = mirror ? `${e.name}~m` : e.name;
  // 시작할 때 몸 방향을 정면으로 (게임은 지금 바라보는 방향 그대로 동작을 시작한다)
  const m0 = sliceSource(src, { mirror });
  const yaw = Math.atan2(
    [0, 0.05, 0.1].reduce((a, t) => a + Math.sin(bodyYaw(m0.sample(t))), 0),
    [0, 0.05, 0.1].reduce((a, t) => a + Math.cos(bodyYaw(m0.sample(t))), 0),
  );
  const s = sliceSource(src, { mirror, yaw, name: id });
  const clip = bakeClip(s, character, { fps: FPS, inPlace: true });
  const tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion'));
  if (!boneNames.length) boneNames = tracks.map((t) => t.name.replace('.quaternion', ''));
  const frames = tracks[0].times.length;
  const q: number[] = [];
  for (let f = 0; f < frames; f++) for (const t of tracks) for (let k = 0; k < 4; k++) q.push(round(t.values[f * 4 + k]));
  const hips = clip.tracks.find((t) => t.name === 'DEF-hips.position')!;
  // 부모 뼈는 Z-up이므로 로컬 Y만 남기면 실제 높이가 사라진다. 제자리 처리는 bakeClip의 월드 XZ에서 끝낸다.
  clips[id] = { hips: Array.from(hips.values, round), q };
  const flip = (side: 'L' | 'R' | null) => (mirror && side ? (side === 'L' ? 'R' : 'L') : side);
  catalog.push({
    ...e, id, side: flip(e.side), ballAngle: round(mirror ? -e.ballAngle : e.ballAngle),
    duration: round(s.duration), key: round(e.key),
    endYaw: round(wrap(bodyYaw(s.sample(s.duration)))), startYaw: round(wrap(bodyYaw(s.sample(0)))),
    ...(e.next ? { next: mirror ? `${e.next}~m` : e.next } : {}),
  } as Entry & { name?: string });
  delete (catalog[catalog.length - 1] as { name?: string }).name;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------- Rohr 모션캡처
const fbx = new FBXLoader();
function rohr(file: string): PoseSource {
  const b = readFileSync(join(ROOT, 'rohr', file));
  const obj = fbx.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  return fbxSource(file, obj, obj.animations[0]);
}

/** 발끝이 가장 빠른 순간과 그때 발끝이 움직이는 방향 */
function kickContact(src: PoseSource, toe: Joint, from: number, to: number): { t: number; dir: THREE.Vector3 } {
  let best = { t: from, v: 0, dir: new THREE.Vector3(0, 0, 1) };
  let prev = src.sample(from);
  for (let t = from + 1 / 60; t <= to; t += 1 / 60) {
    const p = src.sample(t);
    const d = p.get(toe)!.clone().sub(prev.get(toe)!);
    const v = d.length() * 60;
    if (v > best.v) best = { t, v, dir: d.setY(0).normalize() };
    prev = p;
  }
  return best;
}

/** 몸 기준 각도 (+ = 왼쪽): 방향 벡터 각도 - 몸 방향 */
const relAngle = (dir: THREE.Vector3, body: number) => wrap(Math.atan2(dir.x, dir.z) - body);

interface RohrKick { name: string; file: string; window: [number, number]; toe: Joint; kind: MotionKind; speed: Entry['speed'] }
const ROHR_KICKS: RohrKick[] = [
  { name: 'mc_pass_side', file: '08_Side_Foot_Kick.fbx', window: [1.0, 1.95], toe: 'rToe', kind: 'pass', speed: 'idle' },
  { name: 'mc_shot_power', file: '09_Power_Kick.fbx', window: [2.1, 3.25], toe: 'lToe', kind: 'shot', speed: 'walk' },
  { name: 'mc_shot_pk1', file: '10_Penalty_Kick_01.fbx', window: [5.95, 7.2], toe: 'rToe', kind: 'shot', speed: 'walk' },
  { name: 'mc_shot_pk2', file: '11_Penalty_Kick_02.fbx', window: [4.4, 5.6], toe: 'rToe', kind: 'shot', speed: 'walk' },
];
for (const k of ROHR_KICKS) {
  const full = rohr(k.file);
  const src = sliceSource(full, { start: k.window[0], end: k.window[1] });
  const c = kickContact(src, k.toe, 0.1, src.duration - 0.1);
  const body = bodyYaw(src.sample(0));
  for (const mirror of [false, true]) {
    add({ name: k.name, kind: k.kind, source: 'mocap', side: k.toe === 'lToe' ? 'L' : 'R', speed: k.speed, key: c.t, ballAngle: relAngle(c.dir, body), power: 1, height: 0.1 }, src, mirror);
  }
  console.log(`${k.name}: 터치 ${c.t.toFixed(2)}s, 공 방향 ${(relAngle(c.dir, body) * 180 / Math.PI).toFixed(0)}°`);
}

/** 키퍼 다이빙: 엉덩이가 옆으로 가장 빠르게 움직이는 순간 */
function diveMoment(src: PoseSource): { t: number; side: 'L' | 'R' } {
  let best = { t: 0, v: 0, side: 'L' as 'L' | 'R' };
  let prev = src.sample(0);
  for (let t = 1 / 30; t <= src.duration; t += 1 / 30) {
    const p = src.sample(t);
    const body = bodyYaw(p);
    const d = p.get('hips')!.clone().sub(prev.get('hips')!);
    const lateral = d.x * Math.cos(body) - d.z * Math.sin(body); // 몸 기준 +X(왼쪽) 성분
    if (Math.abs(lateral) * 30 > best.v) best = { t, v: Math.abs(lateral) * 30, side: lateral > 0 ? 'L' : 'R' };
    prev = p;
  }
  return best;
}
const ROHR_DIVES: [string, string, [number, number], MotionKind][] = [
  // Save 01은 수직 점프 선방이다. 낮게 눕는 다이빙에는 Save 03을 쓰고 원본 점프도 save로 보존한다.
  ['mc_save_1', '15_Goalkeeper_Save_01.fbx', [4.6, 6.2], 'save'],
  ['mc_dive_1', '17_Goalkeeper_Save_03.fbx', [5.9, 7.8], 'dive'],
  ['mc_save_2', '16_Goalkeeper_Save_02.fbx', [2.8, 4.0], 'save'],
];
for (const [name, file, w, kind] of ROHR_DIVES) {
  const src = sliceSource(rohr(file), { start: w[0], end: w[1] });
  const m = diveMoment(src);
  for (const mirror of [false, true]) add({ name, kind, source: 'mocap', side: m.side, speed: 'idle', key: m.t, ballAngle: 0, power: 1, height: 0.5 }, src, mirror);
  console.log(`${name}: ${m.side} 쪽으로 ${m.t.toFixed(2)}s`);
}

const ROHR_FULL: [string, string, [number, number], MotionKind, number][] = [
  ['mc_throw', '07_Throw_In.fbx', [5.8, 7.3], 'throw', 0.8],
  ['mc_celebrate_1', '12_Goal_Celebration_01.fbx', [0.2, 3.48], 'celebrate', 0],
  ['mc_celebrate_2', '13_Goal_Celebration_02.fbx', [0.2, 3.53], 'celebrate', 0],
  ['mc_celebrate_3', '14_Goal_Celebration_03.fbx', [0.2, 3.18], 'celebrate', 0],
  ['mc_card_yellow', '20_Yellow_Card.fbx', [0.2, 2.88], 'card', 0.2],
  ['mc_card_red', '21_Yellow_And_Red_Card.fbx', [0.2, 5.73], 'card', 0.3],
];
for (const [name, file, w, kind, key] of ROHR_FULL) {
  add({ name, kind, source: 'mocap', side: null, speed: 'idle', key, ballAngle: 0, power: 1, height: 0 }, sliceSource(rohr(file), { start: w[0], end: w[1] }), false);
}

// ---------------------------------------------------------------- Google Research Football
function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith('.anim')) out.push(p);
  }
  return out.sort();
}
const GRF_KIND: Record<string, MotionKind> = { shortpass: 'pass', highpass: 'lob', shot: 'shot', sliding: 'slide', trip: 'fall', trap: 'trap', ballcontrol: 'control', movement: 'turn' };
const SPEED: Record<string, Entry['speed']> = { idle: 'idle', walk: 'walk', dribble: 'walk', sprint: 'sprint' };

let grfCount = 0;
for (const file of files(join(ROOT, 'grf'))) {
  const rel = file.slice(ROOT.length + 5);
  const top = rel.split('/')[0];
  const anim: GrfAnim = parseGrf(readFileSync(file, 'utf8'));
  const type = anim.meta.get('type') ?? '';
  const getup = top === 'movement_special' && rel.includes('stand_up_from') && !rel.includes('holdball');
  // 공을 가진 방향 전환(movement/dribble)은 개인기 몸 동작으로 쓴다
  const dribbleTurn = top === 'movement' && rel.startsWith('movement/dribble/');
  // 키퍼 선방(deflect): 잡기(holdball)·쳐내기 — 종류 메타가 없어 폴더로 정한다
  const keeper = top === 'deflect';
  const kind: MotionKind | undefined = getup ? 'getup' : dribbleTurn ? 'turn' : keeper ? 'keeper' : GRF_KIND[type];
  if (!kind || !(getup || dribbleTurn || keeper || ['pass', 'highpass', 'shot', 'sliding', 'trip', 'trap', 'ballcontrol'].includes(top))) continue;
  const src = grfSource(rel, anim);
  const speedDir = rel.split('/')[top === 'trip' ? 2 : 1];
  const speed = SPEED[speedDir] ?? 'walk';
  // 터치 순간: 파일의 터치 프레임, 없으면(슬라이딩·넘어짐) 엉덩이가 가장 낮은 순간
  let key = Number(anim.meta.get('touchframe')) / GRF_FPS;
  let side: 'L' | 'R' | null = null;
  let height = 0.1;
  if (Number.isFinite(key)) {
    const pose = src.sample(key);
    const [bx, by, bz] = (anim.meta.get('touchpos') ?? '0,0,0').split(',').map(Number);
    const ball = toThree(new THREE.Vector3(bx, by, bz)).add(new THREE.Vector3(pose.get('hips')!.x, 0, pose.get('hips')!.z));
    side = pose.get('lToe')!.distanceTo(ball) < pose.get('rToe')!.distanceTo(ball) ? 'L' : 'R';
    height = ball.y;
  } else {
    let low = Infinity;
    key = 0;
    for (let t = 0; t <= src.duration; t += 0.02) {
      const y = src.sample(t).get('hips')!.y;
      if (y < low) { low = y; key = t; }
    }
  }
  const bd = (anim.meta.get('balldirection') ?? '0,-1,0').split(',').map(Number);
  const dir = toThree(new THREE.Vector3(bd[0], bd[1], bd[2] ?? 0)).setY(0);
  // GRF balldirection은 애니메이션 시작 방향 기준이다
  let ballAngle = dir.lengthSq() > 1e-6 ? relAngle(dir.normalize(), bodyYaw(src.sample(0))) : 0;
  if (keeper && Number.isFinite(Number(anim.meta.get('touchframe')))) {
    // 키퍼는 공이 오는 쪽(터치 순간 공 위치)이 기준: 시작 몸 방향에서 본 각도
    const pose = src.sample(key);
    const [bx, by, bz] = (anim.meta.get('touchpos') ?? '0,0,0').split(',').map(Number);
    const ball = toThree(new THREE.Vector3(bx, by, bz)).setY(0);
    if (ball.lengthSq() > 1e-4) ballAngle = relAngle(ball.normalize(), bodyYaw(src.sample(0)));
    void pose;
  }
  const power = Number(anim.meta.get('touch_maxpowerfactor') ?? 1) || 1;
  const name = `grf_${rel.replace('.anim', '').replace(/[^a-z0-9]+/gi, '_')}`;
  // 누운 자세로 끝나는 동작은 일어나기 동작으로 잇는다
  const lay = anim.meta.get('outgoing_special_state');
  const next = lay === 'lay_back' ? 'grf_movement_special_idle_special_000_stand_up_from_back'
    : lay === 'lay_front' ? 'grf_movement_special_idle_special_000_stand_up_from_front' : undefined;
  for (const mirror of [false, true]) add({ name, kind, source: 'grf', side, speed, key, ballAngle, power, height, next }, src, mirror);
  grfCount++;
}
console.log(`GRF ${grfCount}개 (+좌우 반전)`);

// ---------------------------------------------------------------- 저장
// 쿼터니언 성분(-1..1)을 16비트 정수로 묶어 base64로 (JSON 숫자 대비 약 1/4)
const packed: Record<string, { hips: number[]; q: string }> = {};
for (const [id, c] of Object.entries(clips)) {
  const ints = Int16Array.from(c.q, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767));
  packed[id] = { hips: c.hips, q: Buffer.from(ints.buffer).toString('base64') };
}
writeFileSync('public/assets/motions.json', JSON.stringify({ fps: FPS, bones: boneNames, clips: packed }));
const ts = `// 자동 생성: scripts/bake-motions.ts — 직접 고치지 말 것
import type { MotionEntry } from '../anim/MotionLibrary';

export const MOTION_CATALOG: MotionEntry[] = ${JSON.stringify(catalog, null, 0).replace(/},{/g, '},\n  {')};
`;
writeFileSync('src/data/MotionCatalog.ts', ts);
const size = statSync('public/assets/motions.json').size;
console.log(`클립 ${catalog.length}개, motions.json ${(size / 1024).toFixed(0)}KB`);
