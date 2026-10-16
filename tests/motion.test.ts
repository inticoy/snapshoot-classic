import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { MOTION_CATALOG } from '../src/data/MotionCatalog';
import { MOTION_SELECT, selectMotion } from '../src/anim/MotionLibrary';
import { command, parkPlayers, simulation } from './helpers';

const deg = (d: number) => (d * Math.PI) / 180;

describe('동작 라이브러리', () => {
  it('킥 종류마다 왼발·오른발 동작이 모두 있다 (좌우 반전 포함)', () => {
    for (const kind of ['pass', 'lob', 'shot'] as const) {
      const sides = new Set(MOTION_CATALOG.filter((e) => e.kind === kind).map((e) => e.side));
      expect(sides.has('L') && sides.has('R'), kind).toBe(true);
    }
    expect(MOTION_CATALOG.some((e) => e.kind === 'dive' && e.side === 'L')).toBe(true);
    expect(MOTION_CATALOG.some((e) => e.kind === 'dive' && e.side === 'R')).toBe(true);
    for (const e of MOTION_CATALOG) {
      expect(e.key, e.id).toBeGreaterThanOrEqual(0);
      expect(e.key, e.id).toBeLessThanOrEqual(e.duration + 1e-6);
    }
  });

  it('정면 근처 정지 패스는 모션캡처, 질주 중 옆 패스는 GRF를 고른다', () => {
    const front = selectMotion(MOTION_CATALOG, { kind: 'pass', speed: 'idle', angle: deg(10), foot: 'R' })!;
    expect(front.entry.source).toBe('mocap');
    const side = selectMotion(MOTION_CATALOG, { kind: 'pass', speed: 'sprint', angle: deg(90), foot: 'R' })!;
    expect(side.entry.source).toBe('grf');
    expect(side.entry.speed).toBe('sprint');
    // 고른 동작의 공 방향이 원하는 방향과 가깝다
    expect(Math.abs(side.entry.ballAngle - deg(90))).toBeLessThan(deg(35));
  });

  it('좌우 대칭인 상황에서는 서로 좌우 반전된 동작을 고른다', () => {
    for (const kind of ['pass', 'lob', 'shot'] as const) {
      const l = selectMotion(MOTION_CATALOG, { kind, speed: 'walk', angle: deg(30), foot: 'L' })!;
      const r = selectMotion(MOTION_CATALOG, { kind, speed: 'walk', angle: deg(-30), foot: 'R' })!;
      expect(r.entry.id.replace('~m', ''), kind).toBe(l.entry.id.replace('~m', ''));
      expect(r.entry.side).not.toBe(l.entry.side);
    }
  });
});

describe('킥 동작 타이밍', () => {
  it('패스는 동작 시작 뒤 터치 순간에 나가고, 그 사이 공은 발 앞에 있다', () => {
    const { match } = simulation(3, { kickMotion: true, userControl: false });
    parkPlayers(match);
    const p = match.teams[0].find((q) => q.slot.label === 'CM')!;
    const mate = match.forward(0);
    p.actionLock = mate.actionLock = 0;
    p.pos.set(-10, 0, 0);
    mate.pos.set(2, 0, 0);
    p.facing.set(1, 0, 0);
    match.ball.reset(-9.65, 0);
    match.ball.owner = match.ball.lastTouch = p;
    match.pass(p, new THREE.Vector3(1, 0, 0), 'short', 0.5);
    expect(match.kicking(p)).toBe(true);
    expect(match.stats.passes[0]).toBe(0);
    const cmd = command();
    let t = 0;
    while (match.kicking(p) && t < 1) {
      match.update(PHYSICS.step, cmd);
      t += PHYSICS.step;
      if (match.kicking(p)) {
        expect(match.ball.owner).toBe(p);
        expect(Math.hypot(match.ball.position.x - p.pos.x, match.ball.position.z - p.pos.z)).toBeLessThan(0.8);
        expect(match.events.some((e) => e.type === 'touch')).toBe(false);
      }
    }
    expect(t).toBeGreaterThan(0.05);
    expect(t).toBeLessThanOrEqual(MOTION_SELECT.windup + PHYSICS.step * 2);
    expect(match.stats.passes[0]).toBe(1);
    expect(match.ball.owner).toBeNull();
    expect(match.ball.velocity.x).toBeGreaterThan(3);
  });

  it('킥 동작을 켠 AI 대 AI 4분 × 2경기: 멈춤 없이 끝나고 패스·슛이 이어진다', () => {
    let shots = 0;
    for (const seed of [7, 42]) {
      const { match } = simulation(seed, { kickMotion: true, userControl: false });
      const cmd = command();
      let heavyTouches = 0;
      for (let i = 0; i < 330 / PHYSICS.step && match.phase !== 'fulltime'; i++) {
        match.update(PHYSICS.step, cmd);
        heavyTouches += match.events.filter((e) => e.type === 'heavyTouch').length;
        match.events.length = 0;
      }
      console.info(`킥 동작 AI 4분 seed=${seed}: 패스 ${match.stats.passes.join('/')}, 슛 ${match.stats.shots.join('/')}, 헤비 터치 ${heavyTouches}회`);
      expect(match.phase).toBe('fulltime');
      expect(match.stats.passes[0] + match.stats.passes[1]).toBeGreaterThan(80);
      expect(match.stats.shots[0] + match.stats.shots[1]).toBeGreaterThan(0);
      expect(heavyTouches).toBeLessThanOrEqual(40);
      shots += match.stats.shots[0] + match.stats.shots[1];
    }
    expect(shots).toBeGreaterThan(0);
  });
});

// GLB 부모의 로컬 +Z가 월드 위다. 저장 데이터뿐 아니라 재생 트랙까지 검사해 축 누락 재발을 막는다.
describe('구운 엉덩이 위치', () => {
  it('슬라이딩 핵심 순간·무릎 세리머니·다이빙에서 엉덩이가 내려간다', async () => {
    const { readFileSync } = await import('node:fs');
    const { MotionClips } = await import('../src/anim/MotionLibrary');
    const { vi } = await import('vitest');
    const data = JSON.parse(readFileSync('public/assets/motions.json', 'utf8')) as {
      fps: number; clips: Record<string, { hips: number[] }>;
    };
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => data }));
    try {
      const library = (await MotionClips.load('/assets/motions.json'))!;
      for (const [id, ceiling] of [
        ['grf_sliding_sprint_000', 0.45], ['mc_celebrate_1', 0.6], ['mc_dive_1', 0.6],
        ['grf_sliding_sprint_000~m', 0.45], ['mc_dive_1~m', 0.6],
      ] as const) {
        const hips = data.clips[id].hips;
        const heights = hips.filter((_, i) => i % 3 === 2);
        expect(Math.min(...heights), id).toBeLessThan(ceiling);
        expect(heights[0] - Math.min(...heights), id).toBeGreaterThan(0.15);
        if (id.startsWith('grf_sliding')) {
          const key = MOTION_CATALOG.find((e) => e.id === id)!.key;
          const frame = Math.min(heights.length - 1, Math.round(key * data.fps));
          // 30fps 양자화 오차를 포함한 핵심 순간 전후 한 프레임을 검사한다.
          expect(Math.min(...heights.slice(Math.max(0, frame - 1), frame + 2)), `${id} key=${key}`).toBeLessThan(0.45);
        }
        const track = library.clip(id)!.tracks.find((t) => t.name === 'DEF-hips.position')!;
        expect(Array.from(track.values)).toEqual(hips.map(Math.fround));
        expect(track.times.length).toBe(hips.length / 3);
      }
      for (const [id, c] of Object.entries(data.clips)) {
        expect(c.hips.length % 3, id).toBe(0);
        expect(c.hips.every(Number.isFinite), id).toBe(true);
        expect(library.clip(id)!.duration, id).toBeCloseTo((c.hips.length / 3 - 1) / data.fps, 5);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it('실제 GLB 부모 변환으로도 낮아지고 월드 수평 이동은 제자리에 남는다', async () => {
  const { readFileSync } = await import('node:fs');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
  const { MotionClips } = await import('../src/anim/MotionLibrary');
  const { vi } = await import('vitest');
  const glb = readFileSync('public/assets/models/player.glb');
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', resolve as never, reject);
  });
  const data = JSON.parse(readFileSync('public/assets/motions.json', 'utf8'));
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => data }));
  try {
    const library = (await MotionClips.load('/assets/motions.json'))!;
    for (const [id, ceiling] of [['grf_sliding_sprint_000', 0.45], ['mc_celebrate_1', 0.6], ['mc_dive_1', 0.6]] as const) {
      const model = clone(gltf.scene);
      const hips = model.getObjectByName('DEF-hips')!;
      const mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(library.clip(id)!);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      const positions: THREE.Vector3[] = [];
      for (let f = 0; f < data.clips[id].hips.length / 3; f++) {
        mixer.setTime(f / data.fps);
        positions.push(hips.getWorldPosition(new THREE.Vector3()));
      }
      const min = Math.min(...positions.map((p) => p.y));
      console.info(`${id}: 실제 GLB 엉덩이 최저 ${min.toFixed(3)}m`);
      expect(min, id).toBeLessThan(ceiling);
      expect(Math.max(...positions.map((p) => p.x)) - Math.min(...positions.map((p) => p.x)), id).toBeLessThan(0.003);
      expect(Math.max(...positions.map((p) => p.z)) - Math.min(...positions.map((p) => p.z)), id).toBeLessThan(0.003);
      expect(model.getObjectByName('DEF-toeL')).toBeDefined();
      mixer.stopAllAction();
    }
  } finally { vi.unstubAllGlobals(); }
});
