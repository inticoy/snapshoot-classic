import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { TEAM_COLORS } from '../config';
import { appearance } from '../data/Appearance';
import { SkinnedPlayerModel, createCharacterMesh, loadCharacterAsset } from '../entities/SkinnedPlayerModel';
import type { AnimState } from '../entities/PlayerModel';
import { bakeClip, type Joint, type PoseSource } from '../anim/Retarget';
import { fbxSource, grfSource, parseGrf } from '../anim/Sources';

/**
 * 모션 랩: 외부 동작(Rohr 모션캡처, Google Research Football)을 우리 선수에게 입혀 보는 개발용 페이지.
 * 원본은 mocap-local/ (git 제외). `node scripts/mocap-index.mjs`로 목록을 만든 뒤 dev 서버에서 연다.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const status = $('status');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2a1c);
scene.fog = new THREE.Fog(0x1a2a1c, 12, 30);
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
camera.position.set(3.2, 1.8, 4.2);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0.6, 0.95, 0);
controls.update();
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a3b22, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x2f7a32, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(20, 20, 0xffffff, 0xffffff);
(grid.material as THREE.Material).opacity = 0.12;
(grid.material as THREE.Material).transparent = true;
scene.add(grid);

function resize(): void {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- 캐릭터

await loadCharacterAsset('assets/models/player.glb');
const c = TEAM_COLORS[0];
const look = appearance('Son Jae-min');
const colors = {
  shirt: c.shirt, shorts: c.shorts, socks: c.socks, skin: look.skin, hair: look.hair, hairStyle: look.hairStyle,
  style: c.style, trim: c.trim, decal: { number: 7, name: 'SON', ink: c.ink, inkEdge: c.inkEdge, look },
};
const character = createCharacterMesh(colors);
scene.add(character.root);
const mixer = new THREE.AnimationMixer(character.root);
// 게임 안의 기존 동작(코드 오버레이) 확인용
const gameModel = new SkinnedPlayerModel(colors, false);
gameModel.root.visible = false;
scene.add(gameModel.root);

// 원본 관절 선 (오른쪽에 나란히)
const BONES: [Joint, Joint][] = [
  ['hips', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['head', 'headTop'],
  ['chest', 'lShoulder'], ['lShoulder', 'lArm'], ['lArm', 'lElbow'], ['lElbow', 'lHand'], ['lHand', 'lHandTip'],
  ['chest', 'rShoulder'], ['rShoulder', 'rArm'], ['rArm', 'rElbow'], ['rElbow', 'rHand'], ['rHand', 'rHandTip'],
  ['hips', 'lHip'], ['lHip', 'lKnee'], ['lKnee', 'lAnkle'], ['lAnkle', 'lToe'],
  ['hips', 'rHip'], ['rHip', 'rKnee'], ['rKnee', 'rAnkle'], ['rAnkle', 'rToe'],
];
const skelGeo = new THREE.BufferGeometry();
skelGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BONES.length * 6), 3));
const skeleton = new THREE.LineSegments(skelGeo, new THREE.LineBasicMaterial({ color: 0xffd400 }));
skeleton.position.x = 1.3;
scene.add(skeleton);

// ---------------------------------------------------------------- 목록

interface Entry { id: string; label: string; source: 'rohr' | 'grf' | 'game'; group: string; load: () => Promise<PoseSource | null>; game?: () => void }

const ROHR_GROUP: [RegExp, string][] = [
  [/Dribble/, '드리블'], [/Juggling/, '저글링'], [/Throw_In/, '스로인'], [/Penalty/, '페널티킥'], [/Kick/, '킥'],
  [/Celebration/, '세리머니'], [/Goalkeeper/, '키퍼 선방'], [/Defending/, '수비'], [/Card/, '카드 (심판)'],
];
const GRF_GROUP: Record<string, string> = {
  ballcontrol: '볼 컨트롤 · 방향 전환', trap: '트래핑', pass: '패스', highpass: '높은 패스', shot: '슛',
  movement: '이동', movement_special: '공 지키기 · 일어나기', sliding: '슬라이딩 태클', trip: '넘어짐',
  deflect: '공 막기', interfere: '가로채기', celebration: '세리머니', special: '카드 (심판)', templates: '기본 자세',
};
const STANCE: Record<string, string> = { idle: '정지', walk: '걷기', sprint: '질주', dribble: '드리블' };

const fbx = new FBXLoader();
const index = (await (await fetch('/mocap-local/index.json')).json()) as { rohr: string[]; grf: string[] };
const entries: Entry[] = [];
for (const file of index.rohr) {
  const base = file.split('/').pop()!.replace('.fbx', '');
  entries.push({
    id: `rohr:${file}`, source: 'rohr', label: base.replace(/^\d+_/, '').replace(/_/g, ' '),
    group: ROHR_GROUP.find(([re]) => re.test(base))?.[1] ?? '기타',
    load: async () => {
      const obj = await fbx.loadAsync(`/mocap-local/${file}`);
      return fbxSource(base, obj, obj.animations[0]);
    },
  });
}
for (const file of index.grf) {
  const parts = file.split('/').slice(1);
  const name = parts.pop()!.replace('.anim', '');
  const stance = parts[1] ? `${STANCE[parts[1]] ?? parts[1]} · ` : '';
  entries.push({
    id: `grf:${file}`, source: 'grf', label: `${stance}${parts.slice(2).join('/')}${parts.length > 2 ? '/' : ''}${name}`,
    group: GRF_GROUP[parts[0]] ?? parts[0],
    load: async () => grfSource(name, parseGrf(await (await fetch(`/mocap-local/${file}`)).text())),
  });
}
for (const clip of character.clips) {
  entries.push({ id: `game:clip:${clip.name}`, source: 'game', label: clip.name.replace('_Loop', ''), group: '기본 클립 (Quaternius)', load: async () => null });
}
const OVERLAYS: [AnimState, string][] = [
  ['kick', '킥'], ['tackle', '슬라이딩'], ['dive', '다이빙'], ['smother', '발밑 다이빙'], ['header', '헤더'], ['hold', '공 잡기'], ['advance', '키퍼 전진'], ['celebrate', '세리머니'],
];
for (const [state, label] of OVERLAYS) {
  entries.push({ id: `game:overlay:${state}`, source: 'game', label, group: '게임 코드 동작 (지금 쓰는 것)', load: async () => null, game: () => gameModel.play(state, { side: 1 }) });
}

const SOURCE_TITLE = { rohr: 'ROHR 모션캡처 · 실제 사람', grf: 'GOOGLE RESEARCH FOOTBALL · 퍼블릭 도메인', game: '현재 게임' };
function renderMenu(filter = ''): void {
  const menu = $('menu');
  menu.innerHTML = '';
  const f = filter.trim().toLowerCase();
  for (const src of ['rohr', 'grf', 'game'] as const) {
    const list = entries.filter((e) => e.source === src && (!f || `${e.group} ${e.label}`.toLowerCase().includes(f)));
    if (!list.length) continue;
    const h = document.createElement('div');
    h.className = 'src';
    h.textContent = SOURCE_TITLE[src];
    menu.append(h);
    const groups = [...new Set(list.map((e) => e.group))];
    for (const g of groups) {
      const items = list.filter((e) => e.group === g);
      const d = document.createElement('details');
      d.open = src !== 'grf' || !!f;
      d.innerHTML = `<summary>${g}<small>${items.length}</small></summary>`;
      const box = document.createElement('div');
      box.className = 'list';
      for (const e of items) {
        const b = document.createElement('button');
        b.textContent = e.label;
        b.dataset.id = e.id;
        b.onclick = () => void play(e);
        box.append(b);
      }
      d.append(box);
      menu.append(d);
    }
  }
}
$<HTMLInputElement>('filter').oninput = (e) => renderMenu((e.target as HTMLInputElement).value);

// ---------------------------------------------------------------- 재생

let current: { entry: Entry; source: PoseSource | null; action: THREE.AnimationAction | null } | null = null;
const cache = new Map<string, { source: PoseSource; clips: Map<boolean, THREE.AnimationClip> }>();

async function play(entry: Entry): Promise<void> {
  document.querySelectorAll('.list button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.id === entry.id));
  $('clip-name').textContent = entry.label;
  mixer.stopAllAction();
  const inPlace = $<HTMLInputElement>('inplace').checked;
  if (entry.game) {
    character.root.visible = false;
    gameModel.root.visible = true;
    entry.game();
    current = { entry, source: null, action: null };
    status.textContent = '게임 코드 오버레이 (뼈 회전으로 흉내 낸 동작)';
    return;
  }
  character.root.visible = true;
  gameModel.root.visible = false;
  if (entry.id.startsWith('game:clip:')) {
    const clip = character.clips.find((c) => `game:clip:${c.name}` === entry.id)!;
    const action = mixer.clipAction(clip).play();
    current = { entry, source: null, action };
    status.textContent = `${clip.duration.toFixed(2)}s · 캐릭터 원래 클립`;
    return;
  }
  status.textContent = '변환 중…';
  let cached = cache.get(entry.id);
  if (!cached) {
    const source = await entry.load();
    if (!source) return;
    cached = { source, clips: new Map() };
    cache.set(entry.id, cached);
  }
  let clip = cached.clips.get(inPlace);
  if (!clip) {
    const t0 = performance.now();
    clip = bakeClip(cached.source, character.root, { inPlace });
    cached.clips.set(inPlace, clip);
    console.info(`[motion] ${entry.label} 변환 ${(performance.now() - t0).toFixed(0)}ms`);
  }
  const action = mixer.clipAction(clip);
  action.reset().play();
  current = { entry, source: cached.source, action };
  status.textContent = `${clip.duration.toFixed(2)}s · ${entry.source === 'rohr' ? '모션캡처' : 'GRF 키프레임'}`;
}
$<HTMLInputElement>('inplace').onchange = () => current && void play(current.entry);

const scrub = $<HTMLInputElement>('scrub');
let scrubbing = false;
scrub.oninput = () => {
  scrubbing = true;
  if (current?.action) current.action.time = Number(scrub.value) * current.action.getClip().duration;
};
scrub.onchange = () => (scrubbing = false);

const clock = new THREE.Clock();
function frame(): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const speed = Number($<HTMLSelectElement>('speed').value);
  const paused = $<HTMLInputElement>('pause').checked || scrubbing;
  mixer.update(paused ? 0 : dt * speed);
  if (gameModel.root.visible) gameModel.update(paused ? 0 : dt * speed);
  const action = current?.action;
  if (action) {
    const d = action.getClip().duration;
    const t = action.time % d;
    if (!scrubbing) scrub.value = String(t / d);
    $('time').textContent = `${t.toFixed(2)}s / ${d.toFixed(2)}s`;
    // 원본 관절: 같은 시각, 다리 길이를 우리 선수에 맞춘 크기로
    const src = current!.source;
    skeleton.visible = !!src && $<HTMLInputElement>('skeleton').checked;
    if (src && skeleton.visible) {
      const pose = src.sample(t);
      const first = src.sample(0);
      const leg = first.get('lHip')!.distanceTo(first.get('lKnee')!) + first.get('lKnee')!.distanceTo(first.get('lAnkle')!);
      const k = 0.86 / leg;
      const o = first.get('hips')!;
      const arr = skelGeo.getAttribute('position') as THREE.BufferAttribute;
      const inPlace = $<HTMLInputElement>('inplace').checked;
      const hp = pose.get('hips')!;
      BONES.forEach(([a, b], i) => {
        for (const [j, joint] of [[0, a], [1, b]] as const) {
          const p = pose.get(joint)!;
          arr.setXYZ(i * 2 + j, (p.x - (inPlace ? hp.x : o.x)) * k, (p.y - o.y) * k + 0.95, (p.z - (inPlace ? hp.z : o.z)) * k);
        }
      });
      arr.needsUpdate = true;
      skelGeo.computeBoundingSphere();
    }
  } else skeleton.visible = false;
  controls.update();
  renderer.render(scene, camera);
}

resize();
renderMenu();
status.textContent = `동작 ${entries.length}개 · 왼쪽에서 고르세요`;
frame();
(window as unknown as { __lab: unknown }).__lab = { play: (id: string) => play(entries.find((e) => e.id === id)!), entries, character };
