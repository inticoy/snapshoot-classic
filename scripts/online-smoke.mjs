// 온라인 1:1 확인: 로컬 중계 서버(wrangler dev :8787)에 브라우저 두 개를 붙여 각자 조작하고 어긋남이 없는지
//   SNAPSHOOT_URL=http://127.0.0.1:5191/ RELAY=http://127.0.0.1:8787 node scripts/online-smoke.mjs
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { chromePath } from './chrome-path.mjs';
const base = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const relay = process.env.RELAY ?? 'http://127.0.0.1:8787';
const { code } = await (await fetch(new URL('/rooms', relay), { method: 'POST' })).json();
// SECOND=webkit 이면 두 번째 사람은 Safari 엔진 (엔진이 달라도 같은 경기여야 한다)
const browser = await chromium.launch({ executablePath: await chromePath() });
const second = process.env.SECOND === 'webkit' ? await webkit.launch() : browser;
const pages = [];
for (let i = 0; i < 2; i++) {
  const page = await (i === 0 ? browser : second).newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(new URL(`?room=${code}&relay=${encodeURIComponent(relay)}`, base).href);
  pages.push({ page, errors });
}
for (const { page } of pages) await page.waitForFunction(() => window.__game?.game?.lockstep && window.__game.match.phase !== 'kickoff', null, { timeout: 30000 });
const state = (p) => p.evaluate(() => { const g = window.__game.game, ls = g.lockstep; return { team: ls.team, tick: ls.tick, desync: ls.desyncAt, stalls: ls.stalls, delay: ls.delay, score: [...window.__game.match.score] }; });
// 각자 다른 키로 6초 조작 (팀 0: → 질주·S, 팀 1: ← ↑·D)
const play = async ({ page }, keys) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(3000); for (const k of keys) await page.keyboard.up(k); };
await Promise.all([play(pages[0], ['ArrowRight', 'KeyE']), play(pages[1], ['ArrowLeft', 'ArrowUp'])]);
await Promise.all([play(pages[0], ['ArrowUp', 'KeyS']), play(pages[1], ['ArrowDown', 'Space'])]);
await pages[0].page.waitForTimeout(2500);
const [a, b] = await Promise.all(pages.map((p) => state(p.page)));
// 같은 틱에서의 상태를 비교: 둘 다 해시 교환으로 이미 검사됐다 (desync=null)
console.log(JSON.stringify({ code, a, b, errors: pages.map((p) => p.errors) }));
assert.deepEqual([a.team, b.team].sort(), [0, 1]);
assert.ok(a.tick > 1000 && b.tick > 1000, '경기가 진행되지 않음');
assert.equal(a.desync, null);
assert.equal(b.desync, null);
assert.ok(Math.abs(a.tick - b.tick) < 240, '두 화면 틱 차이가 큼');
assert.equal(pages.flatMap((p) => p.errors).length, 0);
await browser.close();
if (second !== browser) await second.close();
