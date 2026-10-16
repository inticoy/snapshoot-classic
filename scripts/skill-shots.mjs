// 개인기 화면 확인: 플레이그라운드에서 스크립트를 재생하며 지정 시각마다 옆에서 캡처한다.
//   SNAPSHOOT_URL=http://127.0.0.1:5191/ node scripts/skill-shots.mjs [skillId]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

const keys = { F: ['ArrowUp'], FR: ['ArrowUp', 'ArrowRight'], R: ['ArrowRight'], BR: ['ArrowDown', 'ArrowRight'], B: ['ArrowDown'], BL: ['ArrowDown', 'ArrowLeft'], L: ['ArrowLeft'], FL: ['ArrowUp', 'ArrowLeft'] };
function sequence(dirs, hold = false, modifier = 'ShiftLeft') {
  const inputs = [{ t: 0, keys: [] }, { t: 0.5, keys: [modifier] }];
  let t = 0.55;
  for (const [i, dir] of dirs.entries()) {
    if (i && dirs[i - 1] === dir) { inputs.push({ t, keys: [modifier] }); t += 0.05; }
    inputs.push({ t, keys: [modifier, ...keys[dir]] }); t += hold ? 1.8 : 0.06;
  }
  inputs.push({ t, keys: [] });
  const start = hold ? 0.85 : modifier === 'KeyZ' ? 0.67 : t;
  return { inputs, at: [start + 0.05, start + 0.2, start + 0.35, start + 0.5, start + 0.65] };
}
const SCRIPTS = {
  fake_shot: { inputs: [{ t: 0, keys: [] }, { t: 0.55, keys: ['KeyD'] }, { t: 0.65, keys: ['KeyD', 'KeyS'] }, { t: 0.7, keys: [] }], at: [0.7, 0.85, 1, 1.15, 1.3] },
  fake_shot_run: { inputs: [{ t: 0, keys: ['ArrowUp'] }, { t: 1, keys: ['ArrowUp', 'KeyA'] }, { t: 1.1, keys: ['ArrowUp', 'KeyA', 'KeyS'] }, { t: 1.15, keys: ['ArrowUp'] }], at: [1.12, 1.2, 1.28, 1.36, 1.5] },
  fake_pass: { inputs: [{ t: 0, keys: [] }, { t: 0.55, keys: ['KeyA'] }, { t: 0.65, keys: ['KeyA', 'KeyS'] }, { t: 0.7, keys: [] }], at: [0.7, 0.85, 1, 1.15, 1.3] },
  drag_back: sequence(['B'], false, 'KeyZ'),
  feint_r: sequence(['R']), feint_l: sequence(['L']),
  step_over_r: sequence(['F', 'FR', 'R']), step_over_l: sequence(['F', 'FL', 'L']),
  reverse_step_over_r: sequence(['R', 'FR', 'F']), reverse_step_over_l: sequence(['L', 'FL', 'F']),
  side_step_r: sequence(['R'], true), side_step_l: sequence(['L'], true),
  heel_flick: sequence(['F', 'B']), ball_lift: sequence(['F', 'F', 'F']),
  roulette_r: sequence(['B', 'BL', 'L', 'FL', 'F', 'FR', 'R']), roulette_l: sequence(['B', 'BR', 'R', 'FR', 'F', 'FL', 'L']),
  feint_exit_r: sequence(['L', 'BL', 'B', 'BR', 'R']), feint_exit_l: sequence(['R', 'BR', 'B', 'BL', 'L']),
  stop_turn_r: { inputs: [{ t: 0, keys: ['ArrowUp'] }, { t: 1, keys: ['ShiftLeft'] }, { t: 1.03, keys: ['ShiftLeft', 'ArrowUp'] }, { t: 1.09, keys: ['ShiftLeft'] }, { t: 1.12, keys: ['ShiftLeft', 'ArrowRight'] }, { t: 1.18, keys: [] }], at: [1.35, 1.45, 1.55, 1.65, 1.8] },
  elastico: { inputs: [{ t: 0, keys: ['ArrowUp'] }, { t: 1, keys: ['ShiftLeft'] }, ...[['ArrowRight'], ['ArrowDown', 'ArrowRight'], ['ArrowDown'], ['ArrowDown', 'ArrowLeft'], ['ArrowLeft']].map((k, i) => ({ t: 1.03 + i * 0.06, keys: ['ShiftLeft', ...k] })), { t: 1.33, keys: [] }], at: [1.5, 1.6, 1.7, 1.8, 1.95] },
  rainbow: { inputs: [{ t: 0, keys: ['ArrowUp'] }, { t: 1, keys: ['ShiftLeft'] }, { t: 1.03, keys: ['ShiftLeft', 'ArrowDown'] }, { t: 1.09, keys: ['ShiftLeft'] }, { t: 1.12, keys: ['ShiftLeft', 'ArrowUp'] }, { t: 1.18, keys: ['ShiftLeft'] }, { t: 1.21, keys: ['ShiftLeft', 'ArrowUp'] }, { t: 1.27, keys: [] }], at: [1.55, 1.7, 1.85, 2.0, 2.15] },
  idle: { inputs: [{ t: 0, keys: [] }], at: [0.8] },
  face: { face: true, inputs: [{ t: 0, keys: [] }], at: [0.8] },
  run: { inputs: [{ t: 0, keys: ['ArrowUp'] }], at: [1.2, 1.35] },
  sprint: { inputs: [{ t: 0, keys: ['ArrowUp', 'KeyE'] }], at: [1.6, 1.75] },
};
const base = new URL(process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/');
const url = new URL('index.html?playground', base);
const out = '.artifacts/skills';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: await chromePath() });
const page = await browser.newPage({ viewport: { width: 480, height: 420 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url.href);
await page.waitForFunction(() => window.__playground && window.__game?.match);
const ids = process.argv[2] ? [process.argv[2]] : Object.keys(SCRIPTS);
for (const id of ids) {
  const s = SCRIPTS[id];
  await page.evaluate(({ inputs, face }) => {
    window.__face = !!face;
    const { game, match } = window.__game;
    const cam = game.rig.camera;
    // 옆(오른쪽)에서 조작 선수를 따라 본다
    game.rig.update = () => {
      const u = match.controlled.pos;
      cam.fov = 35; cam.updateProjectionMatrix();
      if (window.__face) {
        // 얼굴 확대: 플레이그라운드 전진(+X) 쪽 앞에서
        cam.position.set(u.x + 1.1, 1.75, u.z + 0.25);
        cam.lookAt(u.x, 1.68, u.z);
        return;
      }
      cam.position.set(u.x + 0.5, 1.6, u.z + 5);
      cam.lookAt(u.x + 0.5, 0.8, u.z);
    };
    document.querySelector('#playground').style.display = 'none';
    window.__playground.run({ scenario: 'free', seed: 5, duration: 3.3, inputs });
  }, s);
  for (const [i, t] of s.at.entries()) {
    await page.waitForFunction((t) => window.__game.match.elapsed >= t, t, { timeout: 15000 });
    await page.screenshot({ path: `${out}/${id}-${i}.png` });
  }
}
console.log(JSON.stringify({ ids, errors, out }));
if (errors.length) process.exitCode = 1;
await browser.close();
