// 온라인 흐름 확인 (배포된 중계 서버):
//  1) 두 사람의 보정 설정이 달라도 같은 경기  2) 한쪽이 일시정지해도 경기가 멈추지 않음
//  3) 한쪽이 나갔다가 같은 링크로 돌아오면 따라잡아 이어서, 어긋남 없음
//   SNAPSHOOT_URL=http://127.0.0.1:5191/ node scripts/online-flow-smoke.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';
const base = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const relay = process.env.RELAY ?? 'https://snapshoot-relay.woojoo.workers.dev';
const { code } = await (await fetch(new URL('/rooms', relay), { method: 'POST' })).json();
const url = new URL(`?room=${code}&relay=${encodeURIComponent(relay)}`, base).href;
const browser = await chromium.launch({ executablePath: await chromePath() });
async function open(assist) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  // 설정이 다른 두 사람: 한쪽은 수동 보정·이동 보조 없음
  await ctx.addInitScript((a) => localStorage.setItem('snapshoot-classic:settings', JSON.stringify(a)), assist);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  return { ctx, page, errors };
}
const ready = (p) => p.page.waitForFunction(() => window.__game?.game?.lockstep && window.__game.match.phase !== 'kickoff', null, { timeout: 30000 });
const state = (p) => p.page.evaluate(() => { const ls = window.__game.game.lockstep; return { team: ls.team, tick: ls.tick, desync: ls.desyncAt }; });
const a = await open({ passAssist: 'manual', shotAssist: 'semi', moveAssist: 'none' });
let b = await open({ passAssist: 'assisted', shotAssist: 'assisted', moveAssist: 'high' });
await Promise.all([ready(a), ready(b)]);
const hold = async (p, keys, ms) => { for (const k of keys) await p.page.keyboard.down(k); await p.page.waitForTimeout(ms); for (const k of keys) await p.page.keyboard.up(k); };

// 1) 서로 다른 설정으로 조작
await Promise.all([hold(a, ['ArrowRight', 'KeyS'], 4000), hold(b, ['ArrowLeft', 'KeyE'], 4000)]);
// 2) a가 일시정지 → 경기는 계속 (b의 틱이 늘어난다)
await a.page.keyboard.press('Escape');
const before = (await state(b)).tick;
await hold(b, ['ArrowUp'], 3000);
const afterPause = (await state(b)).tick;
assert.ok(afterPause - before > 240, `일시정지 중에도 진행해야 함 (${before}→${afterPause})`);
assert.equal(await a.page.evaluate(() => window.__game.game.state), 'paused');
await a.page.keyboard.press('Escape');
// 3) b가 나갔다가 같은 링크로 다시 들어온다
await b.ctx.close();
await a.page.waitForTimeout(2500);
b = await open({ passAssist: 'assisted', shotAssist: 'assisted', moveAssist: 'high' });
await b.page.waitForFunction(() => window.__game?.game?.lockstep?.tick > 300, null, { timeout: 30000 });
await Promise.all([hold(a, ['ArrowDown', 'KeyD'], 3000), hold(b, ['ArrowRight'], 3000)]);
await a.page.waitForTimeout(2000);
const [sa, sb] = await Promise.all([state(a), state(b)]);
console.log(JSON.stringify({ code, before, afterPause, a: sa, b: sb, errors: [a.errors, b.errors] }));
assert.equal(sa.desync, null);
assert.equal(sb.desync, null);
assert.ok(Math.abs(sa.tick - sb.tick) < 240, '재접속 뒤 두 화면 틱 차이가 큼');
assert.equal(a.errors.length + b.errors.length, 0);
await browser.close();
