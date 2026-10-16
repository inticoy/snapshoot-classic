// 개인기 화면 확인: 플레이그라운드에서 스크립트를 재생하며 지정 시각마다 옆에서 캡처한다.
//   SNAPSHOOT_URL=http://127.0.0.1:5191/ node scripts/skill-shots.mjs [skillId]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

const SCRIPTS = {
  drag_back: { inputs: [{ t: 0, keys: ['ArrowUp'] }, { t: 1, keys: ['KeyZ', 'ArrowDown'] }, { t: 1.25, keys: [] }], at: [1.0, 1.15, 1.3, 1.45, 1.6] },
  feint_r: { inputs: [{ t: 0, keys: ['ArrowUp'] }, { t: 1, keys: ['ArrowUp', 'ShiftLeft'] }, { t: 1.05, keys: ['ArrowRight', 'ShiftLeft'] }, { t: 1.15, keys: ['ShiftLeft'] }, { t: 1.35, keys: ['ArrowUp'] }], at: [1.2, 1.3, 1.4, 1.5, 1.6] },
  fake_shot: { inputs: [{ t: 0, keys: ['ArrowUp'] }, { t: 1, keys: ['ArrowUp', 'KeyD'] }, { t: 1.12, keys: ['ArrowUp', 'KeyD', 'KeyS'] }, { t: 1.18, keys: ['ArrowUp'] }], at: [1.15, 1.3, 1.45, 1.6, 1.75] },
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
  await page.evaluate(({ inputs }) => {
    const { game, match } = window.__game;
    const cam = game.rig.camera;
    // 옆(오른쪽)에서 조작 선수를 따라 본다
    game.rig.update = () => {
      const u = match.controlled.pos;
      cam.fov = 35; cam.updateProjectionMatrix();
      cam.position.set(u.x + 0.5, 1.6, u.z + 5);
      cam.lookAt(u.x + 0.5, 0.8, u.z);
    };
    document.querySelector('#playground').style.display = 'none';
    window.__playground.run({ scenario: 'free', seed: 5, duration: 2.5, inputs });
  }, s);
  for (const [i, t] of s.at.entries()) {
    await page.waitForFunction((t) => window.__game.match.elapsed >= t, t, { timeout: 15000 });
    await page.screenshot({ path: `${out}/${id}-${i}.png` });
  }
}
console.log(JSON.stringify({ ids, errors, out }));
await browser.close();
