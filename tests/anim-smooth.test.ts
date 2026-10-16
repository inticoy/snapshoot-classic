import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SkinnedPlayerModel, loadCharacterAsset, loadMotionLibrary } from '../src/entities/SkinnedPlayerModel';
import { Player } from '../src/entities/Player';
import { MOTION_CATALOG } from '../src/data/MotionCatalog';
import { VISUAL } from '../src/config';
import { visualRandom } from '../src/core/Random';

const DT = 1 / 60;
const COLORS = { shirt: 0x2244aa, shorts: 0xffffff, socks: 0x2244aa };
const BONES = ['DEF-hips', 'DEF-spine001', 'DEF-thighL', 'DEF-shinL', 'DEF-upper_armL', 'DEF-forearmL'];
function rotationStep(a: THREE.Quaternion, b: THREE.Quaternion): THREE.Vector3 {
  const q = a.clone().invert().multiply(b);
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const half = Math.atan2(Math.hypot(q.x, q.y, q.z), q.w);
  const scale = half < 1e-8 ? 2 : 2 * half / Math.sin(half);
  return new THREE.Vector3(q.x * scale, q.y * scale, q.z * scale);
}

type Sample = { bones: THREE.Quaternion[]; yaw: number };
function measure(name: string, run: (model: SkinnedPlayerModel, frame: number) => void | boolean, frames = 150) {
  visualRandom.reset(1234);
  const model = new SkinnedPlayerModel(COLORS, false);
  const samples: Sample[] = [];
  for (let frame = 0; frame < frames; frame++) {
    if (run(model, frame) !== true) model.update(DT);
    samples.push({
      bones: BONES.map((bone) => (model.root.getObjectByName(bone) as THREE.Bone).quaternion.clone()),
      yaw: model.root.rotation.y,
    });
  }
  let acceleration = 0;
  let yawStep = 0;
  let worst = '';
  for (let f = 2; f < samples.length; f++) {
    for (let b = 0; b < BONES.length; b++) {
      const before = rotationStep(samples[f - 2].bones[b], samples[f - 1].bones[b]);
      const after = rotationStep(samples[f - 1].bones[b], samples[f].bones[b]);
      const change = after.sub(before).length();
      if (change > acceleration) { acceleration = change; worst = `${f}:${BONES[b]}`; }
    }
    yawStep = Math.max(yawStep, Math.abs(Math.atan2(Math.sin(samples[f].yaw - samples[f - 1].yaw), Math.cos(samples[f].yaw - samples[f - 1].yaw))));
  }
  console.info(`anim ${name}: bone=${acceleration.toFixed(4)} rad/frame² (${worst}) yaw=${yawStep.toFixed(4)} rad/frame`);
  return { acceleration, yawStep };
}

beforeAll(async () => {
  const glb = readFileSync('public/assets/models/player.glb');
  const gltf = await new Promise<GLTF>((resolve, reject) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', resolve, reject));
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(gltf);
  expect(await loadCharacterAsset('/assets/models/player.glb')).toBe(true);
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => JSON.parse(readFileSync('public/assets/motions.json', 'utf8')) }));
  expect(await loadMotionLibrary('/assets/motions.json')).toBe(true);
});
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('실제 GLB 60Hz 동작 전환', () => {
  it('코드 킥 대체 동작이 실제 허벅지 뼈를 움직인다', () => {
    visualRandom.reset(4321);
    const idle = new SkinnedPlayerModel(COLORS, false);
    visualRandom.reset(4321);
    const kick = new SkinnedPlayerModel(COLORS, false);
    kick.play('kick', { side: 1 });
    for (let i = 0; i < 18; i++) { idle.update(DT); kick.update(DT); }
    const a = (idle.root.getObjectByName('DEF-thighR') as THREE.Bone).quaternion;
    const b = (kick.root.getObjectByName('DEF-thighR') as THREE.Bone).quaternion;
    expect(rotationStep(a, b).length()).toBeGreaterThan(0.2);
  });
  it('정지에서 질주', () => {
    expect(measure('idle-sprint', (m, f) => m.setLocomotion(f < 30 ? 0 : 7, true)).acceleration).toBeLessThan(0.18);
  });
  it('질주에서 정지', () => {
    expect(measure('sprint-idle', (m, f) => m.setLocomotion(f < 45 ? 7 : 0, true)).acceleration).toBeLessThan(0.16);
  });
  it('질주 중 180도 회전', () => {
    let player: Player;
    const result = measure('turn-180', (m, f) => {
      player ??= new Player(0, 'MID', 1, 'Test', { name: 'Test', short: 'Test' } as never, {} as never, () => m);
      player.vel.set(0, 0, 7);
      player.facing.set(0, 0, f < 45 ? 1 : -1);
      player.syncVisual(DT);
      return true;
    });
    expect(result.acceleration).toBeLessThan(0.17);
    expect(result.yawStep).toBeLessThanOrEqual(VISUAL.maxYawRate * DT + 1e-6);
    expect(result.yawStep).toBeGreaterThan(0.1);
  });
  it('달리며 슛한 뒤 다시 달리기', () => {
    const shot = MOTION_CATALOG.find((e) => e.id === 'grf_shoot_sprint_000') ?? MOTION_CATALOG.find((e) => e.kind === 'shot' && e.speed === 'sprint')!;
    expect(measure('run-shot-run', (m, f) => { m.setLocomotion(7, true); if (f === 40) m.playMotion(shot.id, { startAt: Math.max(0, shot.key - 0.16) }); }, 180).acceleration).toBeLessThan(0.17);
  });
  it('슬라이딩에서 일어나 달리기', () => {
    const slide = MOTION_CATALOG.find((e) => e.id === 'grf_sliding_sprint_000')!;
    expect(measure('slide-getup-run', (m, f) => {
      m.setLocomotion(f < 120 ? 0 : 7, f >= 120);
      if (f === 30) m.playMotion(slide.id, { then: { id: slide.next!, speed: 1.7 } });
    }, 210).acceleration).toBeLessThan(0.21);
  });
  it('세리머니에서 킥오프', () => {
    expect(measure('celebrate-kickoff', (m, f) => {
      m.setLocomotion(0, false);
      if (f === 20) m.playMotion('mc_celebrate_1', { loop: true });
      if (f === 100) m.stopMotion();
    }, 170).acceleration).toBeLessThan(0.05);
  });
  it('화면 yaw는 180도 방향 변경에도 프레임별 각속도가 제한된다', () => {
    const model = new SkinnedPlayerModel(COLORS, false);
    const player = new Player(0, 'MID', 1, 'Test', { name: 'Test', short: 'Test' } as never, {} as never, () => model);
    player.facing.set(0, 0, 1);
    player.syncVisual(DT);
    player.facing.set(0, 0, -1);
    let max = 0;
    for (let i = 0; i < 60; i++) {
      const prev = model.root.rotation.y;
      player.syncVisual(DT);
      max = Math.max(max, Math.abs(Math.atan2(Math.sin(model.root.rotation.y - prev), Math.cos(model.root.rotation.y - prev))));
    }
    console.info(`anim player-yaw: ${max.toFixed(4)} rad/frame`);
    expect(max).toBeLessThanOrEqual(VISUAL.maxYawRate * DT + 1e-6);
  });
});
