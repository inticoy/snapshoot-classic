// GLB와 실제 재생기를 함께 샘플링해 접촉 키를 굽는다. 모델/클립을 바꾸면 다시 실행한다.
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SkinnedPlayerModel, loadCharacterAsset, loadMotionLibrary } from '../src/entities/SkinnedPlayerModel';
import { SKILLS } from '../src/gameplay/Skills';
import { Match } from '../src/gameplay/Match';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Random, visualRandom } from '../src/core/Random';
import { BALL } from '../src/config';

const glb = readFileSync('public/assets/models/player.glb');
const gltf = await new Promise<GLTF>((resolve, reject) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .register((parser) => { (parser as unknown as { loadTexture: () => Promise<null> }).loadTexture = async () => null; return { name: 'skip-textures' }; })
  .parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', resolve, reject));
GLTFLoader.prototype.loadAsync = async () => gltf;
await loadCharacterAsset('/assets/models/player.glb');
globalThis.fetch = (async () => ({ ok: true, json: async () => JSON.parse(readFileSync('public/assets/motions.json', 'utf8')) })) as typeof fetch;
await loadMotionLibrary('/assets/motions.json');
const result: Record<string, { t: number; x: number; z: number; y: number }[]> = {};
for (const def of SKILLS) {
  // 다리 IK 개인기는 공이 발 부위를 직접 따라가므로 굽지 않는다
  if (!def.contacts.length || def.rig) continue;
  visualRandom.reset(1234);
  const m = new Match(new PhysicsWorld(), { random: new Random(5), goalVisuals: false,
    createPlayerModel: (colors, _number, keeper) => new SkinnedPlayerModel(colors, keeper) });
  const p = m.teams[0].find((q) => q.slot.label === 'ST')!;
  p.pos.set(0, 0, 0); p.vel.set(0, 0, 0); p.facing.set(0, 0, 1); p.actionLock = 0;
  Object.defineProperty(p, 'profile', { value: { ...p.profile, skill: 5 }, configurable: true });
  p.resetAnimation(); p.syncVisual(0);
  m.ball.reset(0, 0.4); m.ball.owner = p;
  if (!m.skills.start(p, def)) throw new Error(def.id);
  const keys: typeof result[string] = [];
  let t = 0;
  for (const contact of def.contacts) {
    while (t < contact.t - 1e-9) {
      const dt = Math.min(1 / 120, contact.t - t);
      m.skills.driveBodies(dt); p.update(dt); p.syncVisual(dt); t += dt;
    }
    const toe = p.model.root.getObjectByName(`DEF-toe${contact.foot}`)!.getWorldPosition(new THREE.Vector3());
    // 공 중심은 발끝에서 반지름만큼 위에 놓아 지면을 뚫지 않게 한다.
    keys.push({ t: contact.t, x: -toe.x, z: toe.z, y: Math.max(BALL.radius, toe.y + BALL.radius) });
  }
  result[def.id] = keys.map((key) => Object.fromEntries(Object.entries(key).map(([k, v]) => [k, +v.toFixed(5)]))) as typeof keys;
}
writeFileSync('src/data/SkillContacts.ts', `// 자동 생성: pnpm exec vite-node scripts/bake-skill-contacts.ts\n// 실제 GLB 발끝 + 공 반지름. 기존 이동 키 사이에 접촉 키로 삽입한다.\nimport type { Key } from '../gameplay/Skills';\nexport const SKILL_CONTACTS: Record<string, Key[]> = ${JSON.stringify(result, null, 2)};\n`);
console.log(`접촉 키 ${Object.keys(result).length}종 생성`);
