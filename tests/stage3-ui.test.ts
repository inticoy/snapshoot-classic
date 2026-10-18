import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { COMMAND, PHYSICS, TEAM_COLORS } from '../src/config';
import { Input } from '../src/core/Input';
import { Hud } from '../src/ui/Hud';
import { scriptCommand } from '../src/playground/Script';
import { PlaygroundScenarios } from '../src/playground/Scenarios';
import { loadCharacterAsset, SkinnedPlayerModel } from '../src/entities/SkinnedPlayerModel';
import { simulation } from './helpers';

let win: HappyWindow | undefined;
afterEach(async () => { await win?.happyDOM.abort(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('실제 F·D 입력의 준비 중 머리 위 타이밍 막대와 초록 창·성공 표시가 나오고 취소 시 숨는다', () => {
  const { match } = simulation(3, { practice: true, kickMotion: true });
  new PlaygroundScenarios(match).reset('keeper', 3);
  win = new HappyWindow();
  vi.stubGlobal('window', win); vi.stubGlobal('document', win.document);
  vi.spyOn(win.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({}, { get: () => () => {} }) as never);
  document.body.innerHTML = readFileSync('index.html', 'utf8');
  const hud = new Hud();
  const camera = new THREE.PerspectiveCamera(42, 1.5, 0.1, 200);
  camera.position.set(30, 20, 30); camera.lookAt(match.controlled.pos); camera.updateMatrixWorld();
  const input = new Input({ addEventListener() {} } as unknown as Window);
  const step = () => { match.update(PHYSICS.step, scriptCommand(input)); input.endFrame(); hud.update(PHYSICS.step, match, camera); };
  input.setVirtualKeys(['KeyF', 'KeyD']); step();
  input.setVirtualKeys([]); step();
  const power = document.getElementById('power')!;
  expect(power.classList.contains('timing')).toBe(true);
  expect(power.classList.contains('show')).toBe(true);
  expect(parseFloat(power.style.getPropertyValue('--timing-start'))).toBeCloseTo(62.5);
  expect(parseFloat(power.style.getPropertyValue('--timing-end'))).toBeCloseTo(87.5);
  for (let i = 0; i < 35; i++) step();
  input.setVirtualKeys(['KeyD']); step();
  expect(match.powerTiming?.elapsed).toBeCloseTo(COMMAND.powerCenter);
  expect(document.getElementById('power-label')!.textContent).toBe('PERFECT');
  expect(parseFloat(document.getElementById('power-fill')!.style.marginLeft)).toBeCloseTo(75, 8);
  const head = new THREE.Vector3(match.controlled.pos.x, 2.7, match.controlled.pos.z).project(camera);
  expect(parseFloat(power.style.top)).toBeCloseTo((1 - head.y) / 2 * window.innerHeight + 14);
  match.cancelUserCharge(); input.setVirtualKeys([]); step();
  expect(power.classList.contains('timing')).toBe(false);
  expect(power.classList.contains('show')).toBe(false);
});

it('실제 GLB의 플레어 오버레이는 일반 킥과 다른 발목·허벅지·상체 회전을 재생한다', async () => {
  const data = readFileSync('public/assets/models/player.glb');
  const parsed = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .register((parser) => { (parser as unknown as { loadTexture: () => Promise<null> }).loadTexture = async () => null; return { name: 'skip-textures' }; }).parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '', resolve, reject);
  });
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(parsed);
  expect(await loadCharacterAsset('/test-player.glb')).toBe(true);
  const normal = new SkinnedPlayerModel({ ...TEAM_COLORS[0], keeper: false }, false), flair = new SkinnedPlayerModel({ ...TEAM_COLORS[0], keeper: false }, false);
  normal.play('kick', { side: 1 }); flair.play('kick', { side: 1, flair: true });
  for (let i = 0; i < 16; i++) { normal.update(1 / 60); flair.update(1 / 60); }
  for (const name of ['DEF-footR', 'DEF-thighR', 'DEF-spine001']) {
    const a = normal.root.getObjectByName(name)!, b = flair.root.getObjectByName(name)!;
    expect(a, name).toBeDefined(); expect(b, name).toBeDefined();
    expect(a.quaternion.angleTo(b.quaternion), name).toBeGreaterThan(0.1);
    expect(b.quaternion.toArray().every(Number.isFinite), name).toBe(true);
  }
});
