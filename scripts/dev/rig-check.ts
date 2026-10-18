// 다리 IK 개인기 점검: 실제 GLB 발목이 rig 목표를 얼마나 따라가는지, 접촉 순간 공과 발의 거리
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SkinnedPlayerModel, loadCharacterAsset, loadMotionLibrary } from '../../src/entities/SkinnedPlayerModel';
import { SKILLS } from '../../src/gameplay/Skills';
import { Match } from '../../src/gameplay/Match';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { Random, visualRandom } from '../../src/core/Random';

const glb = readFileSync('public/assets/models/player.glb');
const gltf = await new Promise<GLTF>((resolve, reject) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  .parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', resolve, reject));
GLTFLoader.prototype.loadAsync = async () => gltf;
await loadCharacterAsset('/assets/models/player.glb');
globalThis.fetch = (async () => ({ ok: true, json: async () => JSON.parse(readFileSync('public/assets/motions.json', 'utf8')) })) as typeof fetch;
await loadMotionLibrary('/assets/motions.json');
const ids = process.argv.slice(2);
for (const def of SKILLS.filter((d) => d.rig && (!ids.length || ids.includes(d.id)))) {
  visualRandom.reset(1234);
  const m = new Match(new PhysicsWorld(), { random: new Random(5), goalVisuals: false,
    createPlayerModel: (colors, _n, keeper) => new SkinnedPlayerModel(colors, keeper) });
  const p = m.teams[0].find((q) => q.slot.label === 'ST')!;
  p.pos.set(0, 0, 0); p.vel.set(0, 0, 0); p.facing.set(0, 0, 1); p.actionLock = 0;
  Object.defineProperty(p, 'profile', { value: { ...p.profile, skill: 5 }, configurable: true });
  p.resetAnimation(); p.syncVisual(0);
  m.ball.reset(0, 0.4); m.ball.owner = p;
  if (!m.skills.start(p, def)) throw new Error(def.id);
  const dt = 1 / 120;
  let maxErr = 0, worst = '';
  const lines: string[] = [];
  for (let t = dt; t < def.duration; t += dt) {
    m.skills.driveBodies(dt); p.update(dt); m.skills.driveBall(dt, null); m.physics.step(dt); p.syncVisual(dt);
    const legs = p.legPose;
    if (!legs) continue;
    for (const s of ['L', 'R'] as const) {
      const a = p.model.root.getObjectByName(`DEF-foot${s}`)!.getWorldPosition(new THREE.Vector3());
      const e = a.distanceTo(legs[s].pos);
      if (t > 0.12 && e > maxErr) { maxErr = e; worst = `${s} t=${t.toFixed(3)} target=${legs[s].pos.toArray().map((v) => v.toFixed(2))} got=${a.toArray().map((v) => v.toFixed(2))}`; }
    }
    for (const c of def.contacts) if (Math.abs(t - c.t) < dt / 2) {
      const a = p.model.root.getObjectByName(`DEF-foot${c.foot}`)!.getWorldPosition(new THREE.Vector3());
      const toe = p.model.root.getObjectByName(`DEF-toe${c.foot}`)!.getWorldPosition(new THREE.Vector3());
      const b = m.ball.position;
      lines.push(`  contact ${c.foot}@${c.t}: ankle→ball ${a.distanceTo(new THREE.Vector3(b.x, b.y, b.z)).toFixed(3)} toe→ball ${toe.distanceTo(new THREE.Vector3(b.x, b.y, b.z)).toFixed(3)}`);
    }
  }
  console.log(`${def.id}: IK max ankle error ${maxErr.toFixed(3)}m (${worst})`);
  console.log(lines.join('\n'));
}
