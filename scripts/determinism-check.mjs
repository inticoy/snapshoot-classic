// 브라우저 엔진별 결정성: 같은 입력 기록의 매 초 상태 해시가 Chromium·Firefox·WebKit에서 같은지
//   SNAPSHOOT_URL=http://127.0.0.1:5191/ node scripts/determinism-check.mjs [seconds]
import { chromium, firefox, webkit } from 'playwright';
import { chromePath } from './chrome-path.mjs';
const base = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const seconds = Number(process.argv[2] ?? 60);
const results = {};
for (const [name, type, opts] of [['chromium', chromium, { executablePath: await chromePath() }], ['firefox', firefox, {}], ['webkit', webkit, {}]]) {
  let browser;
  try { browser = await type.launch(opts); } catch (e) { results[name] = null; console.warn(`${name}: 실행 불가 (${String(e.message).split('\n')[0]})`); continue; }
  const page = await browser.newPage();
  await page.goto(new URL(`determinism.html?s=${seconds}`, base).href);
  await page.waitForFunction(() => window.__hashes, null, { timeout: 300000 });
  results[name] = await page.evaluate(() => window.__hashes);
  await browser.close();
}
const names = Object.keys(results).filter((n) => results[n]);
const firstDiff = (a, b) => a.findIndex((h, i) => h !== b[i]);
const report = Object.fromEntries(Object.keys(results).map((n) => [n, results[n] ? { last: results[n].at(-1), firstDiffVsChromium: firstDiff(results.chromium, results[n]) } : 'unavailable']));
console.log(JSON.stringify(report));
process.exit(names.every((n) => firstDiff(results.chromium, results[n]) === -1) ? 0 : 1);
