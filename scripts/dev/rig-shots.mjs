// 다리 IK 개인기 연속 컷: 연습장 ▶ 시범을 가까운 카메라·느린 화면으로 찍어 한 장에 모은다
//   node scripts/dev/rig-shots.mjs [view=side|front|diag|back] [skillId...]
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { chromePath } from '../chrome-path.mjs';
const [view = 'side', ...ids] = process.argv.slice(2);
const skills = ids.length ? ids : ['step_over_r', 'heel_flick', 'roulette_r', 'rainbow'];
const browser = await chromium.launch({ executablePath: await chromePath() });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(new URL('index.html?playground', process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5191/').href);
await page.waitForFunction(() => window.__skillDemo && window.__game?.match);
await page.evaluate(() => { document.querySelector('#playground').open = false; });
await page.locator(`[data-view="${view}"]`).evaluate((b) => b.click());
await page.locator('[data-speed="0.25"]').evaluate((b) => b.click());
mkdirSync('.artifacts/rig', { recursive: true });
for (const id of skills) {
  await page.evaluate((id) => window.__skillDemo(id), id);
  const dur = await page.evaluate((id) => window.__game.match.skills.current(window.__game.match.controlled)?.duration ?? 0, id);
  const shots = [];
  const t0 = await page.evaluate(() => window.__game.match.elapsed);
  for (let k = 0; k < 8; k++) {
    const target = t0 + (dur * k) / 7;
    await page.waitForFunction((t) => window.__game.match.elapsed >= t, target, { timeout: 20000 });
    shots.push((await page.screenshot({ clip: { x: 200, y: 60, width: 500, height: 520 } })).toString('base64'));
  }
  const sheet = await browser.newPage({ viewport: { width: 2000, height: 1040 } });
  await sheet.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(4,500px);background:#000">${shots.map((s, i) => `<div style="position:relative"><img src="data:image/png;base64,${s}"><span style="position:absolute;left:6px;top:4px;color:#ff0;font:16px sans-serif">${id} ${(dur * i / 7).toFixed(2)}s</span></div>`).join('')}</body>`);
  await sheet.screenshot({ path: `.artifacts/rig/${id}-${view}.png` });
  await sheet.close();
}
await browser.close();
