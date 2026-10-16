import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SkinnedPlayerModel, loadCharacterAsset, loadMotionLibrary } from '../src/entities/SkinnedPlayerModel';
import { MOTION_CATALOG } from '../src/data/MotionCatalog';
import { SKILLS } from '../src/gameplay/Skills';
import { visualRandom } from '../src/core/Random';
import { simulation } from './helpers';

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

describe('전체 개인기 실제 GLB 발끝·물리 공 접촉', () => {
  it.each(SKILLS)('$id: 정지·이동·질주, 60/120Hz 모두 0.25m 이내', (def) => {
    expect(def.motion && MOTION_CATALOG.some((e) => e.id === def.motion!.id), def.id).toBe(true);
    let max = 0;
    for (const [speed, hz, yaw, seed] of [[0, 120, 0, 1234], [3, 120, Math.PI / 2, 7], [7, 60, -0.7, 42], [0, 60, 0, 99]]) {
      visualRandom.reset(seed);
      const { match, physics } = simulation(5, { createPlayerModel: (colors, _number, keeper) => new SkinnedPlayerModel(colors, keeper) });
      const p = match.teams[0].find((q) => q.slot.label === 'ST')!;
      p.pos.set(0, 0, 0); p.facing.set(Math.sin(yaw), 0, Math.cos(yaw));
      p.vel.copy(p.facing).multiplyScalar(speed); p.actionLock = 0;
      Object.defineProperty(p, 'profile', { value: { ...p.profile, skill: 5 }, configurable: true });
      p.resetAnimation(); p.syncVisual(0);
      if (speed > 0) for (let frame = 0; frame < 45; frame++) p.syncVisual(1 / hz);
      match.ball.reset(p.facing.x * 0.4, p.facing.z * 0.4); match.ball.owner = p;
      expect(match.skills.start(p, def)).toBe(true);
      if (def.sustained) match.skills.hold(p, true, new THREE.Vector3(-p.facing.z, 0, p.facing.x).multiplyScalar(def.id.endsWith('_l') ? -1 : 1));
      const dt = 1 / hz;
      let contactIndex = 0;
      // hold는 두 번째·세 번째 반복의 접촉도 검사한다.
      const duration = def.sustained ? def.duration * 3 : def.duration;
      let checked = 0;
      for (let t = dt; t < duration - 1e-6; t += dt) {
        match.skills.driveBodies(dt); p.update(dt); match.skills.driveBall(dt, null); physics.step(dt); p.syncVisual(dt);
        const contact = def.contacts[contactIndex % def.contacts.length];
        const cycle = Math.floor(contactIndex / def.contacts.length);
        if (contact && t + 1e-6 >= cycle * def.duration + contact.t) {
          const toe = p.model.root.getObjectByName(`DEF-toe${contact.foot}`)!.getWorldPosition(new THREE.Vector3());
          const bp = match.ball.position;
          const error = toe.distanceTo(new THREE.Vector3(bp.x, bp.y, bp.z));
          max = Math.max(max, error);
          expect(error, `${def.id}: v=${speed}, ${hz}Hz t=${t.toFixed(4)}`).toBeLessThanOrEqual(0.25);
          contactIndex++; checked++;
        }
      }
      expect(checked).toBe(def.contacts.length * (def.sustained ? 3 : 1));
      expect(match.ball.owner).toBe(p);
    }
    console.info(`skill-contact ${def.id}: max=${max.toFixed(4)}m duration=${def.duration}s clip=${def.motion?.id ?? 'trajectory'}`);
  });
});
