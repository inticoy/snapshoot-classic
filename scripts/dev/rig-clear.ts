// 개인기 중 공이 몸(몸통·머리·다리)을 뚫는지: 공 중심과 뼈 선분 사이 거리 - (공 반지름 + 몸 두께)
//   pnpm exec vite-node scripts/dev/rig-clear.ts [skillId...]
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SkinnedPlayerModel, loadCharacterAsset, loadMotionLibrary } from '../../src/entities/SkinnedPlayerModel';
import { SKILLS } from '../../src/gameplay/Skills';
import { Match } from '../../src/gameplay/Match';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { Random, visualRandom } from '../../src/core/Random';
import { BALL } from '../../src/config';

const glb = readFileSync('public/assets/models/player.glb');
const gltf = await new Promise<GLTF>((resolve, reject) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  .register((parser) => { (parser as unknown as { loadTexture: () => Promise<null> }).loadTexture = async () => null; return { name: 'skip-textures' }; })
  .parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', resolve, reject));
GLTFLoader.prototype.loadAsync = async () => gltf;
await loadCharacterAsset('/assets/models/player.glb');
globalThis.fetch = (async () => ({ ok: true, json: async () => JSON.parse(readFileSync('public/assets/motions.json', 'utf8')) })) as typeof fetch;
await loadMotionLibrary('/assets/motions.json');
// [시작 뼈, 끝 뼈, 두께(m)]
const SEGS: [string, string, number][] = [
  ['DEF-spine', 'DEF-spine003', 0.13], ['DEF-spine003', 'DEF-neck', 0.12], ['DEF-neck', 'DEF-head', 0.07],
  ['DEF-thighL', 'DEF-shinL', 0.07], ['DEF-thighR', 'DEF-shinR', 0.07],
];
const seg = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
  const ab = b.clone().sub(a), u = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, u));
};
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
  let worst = Infinity, at = '';
  const rows: string[] = [];
  let i = 0;
  for (let t = dt; t < def.duration; t += dt, i++) {
    m.skills.driveBodies(dt); p.update(dt); m.skills.driveBall(dt, null); m.physics.step(dt); p.syncVisual(dt);
    const b = m.ball.position, bv = new THREE.Vector3(b.x, b.y, b.z);
    const head = p.model.root.getObjectByName('DEF-head')!.getWorldPosition(new THREE.Vector3());
    for (const [a, c, r] of SEGS) {
      const A = p.model.root.getObjectByName(a)?.getWorldPosition(new THREE.Vector3()), C = p.model.root.getObjectByName(c)?.getWorldPosition(new THREE.Vector3());
      if (!A || !C) continue;
      const gap = seg(bv, A, C) - BALL.radius - r;
      if (t > 0.3 && gap < worst) { worst = gap; at = `${a}-${c} t=${t.toFixed(3)} ball=${bv.toArray().map((v) => v.toFixed(2))}`; }
    }
    // 발목 굽힘: 정강이(무릎→발목)와 발(발목→발가락 관절) 사이 각도, 90° = 직각, 클수록 발끝을 뻗음
    const ang = (s: 'L' | 'R') => {
      const k = p.model.root.getObjectByName(`DEF-shin${s}`)!.getWorldPosition(new THREE.Vector3());
      const a = p.model.root.getObjectByName(`DEF-foot${s}`)!.getWorldPosition(new THREE.Vector3());
      const o = p.model.root.getObjectByName(`DEF-toe${s}`)!.getWorldPosition(new THREE.Vector3());
      return THREE.MathUtils.radToDeg(Math.acos(a.clone().sub(k).normalize().dot(o.sub(a).normalize()))).toFixed(0);
    };
    if (i % 6 === 0) rows.push(`  t=${t.toFixed(2)} ball y=${bv.y.toFixed(2)} z=${bv.z.toFixed(2)} | head y=${head.y.toFixed(2)} z=${head.z.toFixed(2)} | 발목 L ${ang('L')}° R ${ang('R')}° (정강이 축과 발 사이, 0=일직선)`);
  }
  console.log(`${def.id}: 최소 여유 ${(worst * 100).toFixed(1)}cm (${at})`);
  if (ids.length) console.log(rows.join('\n'));
}
