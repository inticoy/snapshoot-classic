// 온라인 흐름 확인 (배포된 중계 서버):
//  1) 두 사람의 보정 설정이 달라도 같은 경기  2) 한쪽이 일시정지해도 경기가 멈추지 않음
//  3) 한쪽이 나갔다가 같은 링크로 돌아오면 따라잡아 이어서, 어긋남 없음
//   SNAPSHOOT_URL=http://127.0.0.1:5191/ node scripts/online-flow-smoke.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';
const base = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const relay = process.env.RELAY ?? 'https://snapshoot-relay.woojoo.workers.dev';
// 빠른 매칭으로 시작: 두 사람이 ?quick 화면에서 같은 방으로 들어간다
let code = '';
const url = new URL(`?quick&relay=${encodeURIComponent(relay)}`, base).href;
const browser = await chromium.launch({ executablePath: await chromePath() });
async function open(assist, at = url, reuse = null) {
  const ctx = reuse ?? await browser.newContext({ viewport: { width: 640, height: 360 } });
  // 설정이 다른 두 사람: 한쪽은 수동 보정·이동 보조 없음
  if (!reuse) await ctx.addInitScript((a) => localStorage.setItem('snapshoot-classic:settings', JSON.stringify(a)), assist);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(at);
  return { ctx, page, errors };
}
const ready = (p) => p.page.waitForFunction(() => window.__game?.game?.lockstep && window.__game.match.phase !== 'kickoff', null, { timeout: 30000 });
const state = (p) => p.page.evaluate(() => { const ls = window.__game.game.lockstep; return { team: ls.team, tick: ls.tick, desync: ls.desyncAt }; });
const a = await open({ passAssist: 'manual', shotAssist: 'semi', moveAssist: 'none' });
assert.match(await a.page.locator('.ol-status').textContent(), /찾는 중/);
let b = await open({ passAssist: 'assisted', shotAssist: 'assisted', moveAssist: 'high' });
await Promise.all([ready(a), ready(b)]);
code = new URL(a.page.url()).searchParams.get('room');
assert.equal(new URL(b.page.url()).searchParams.get('room'), code, '같은 방으로 매칭');
const roomUrl = a.page.url();
const hold = async (p, keys, ms) => { for (const k of keys) await p.page.keyboard.down(k); await p.page.waitForTimeout(ms); for (const k of keys) await p.page.keyboard.up(k); };

// 1) 서로 다른 설정으로 조작
await Promise.all([hold(a, ['ArrowRight', 'KeyS'], 4000), hold(b, ['ArrowLeft', 'KeyE'], 4000)]);
// 2) a가 일시정지 → 둘 다 멈추고, 핑과 남은 시간이 보인다. 재개하면 둘 다 다시 진행
await a.page.keyboard.press('Escape');
await b.page.waitForFunction(() => /상대 일시정지/.test(document.querySelector('.net-status')?.textContent ?? ''), null, { timeout: 5000 });
const before = (await state(b)).tick;
await hold(b, ['ArrowUp'], 2000);
const afterPause = (await state(b)).tick;
assert.ok(afterPause - before < 30, `일시정지 중에는 둘 다 멈춰야 함 (${before}→${afterPause})`);
assert.match(await a.page.locator('.net-status').textContent(), /\d+ms/, '핑 표시');
assert.equal(await a.page.evaluate(() => window.__game.game.state), 'paused');
await a.page.keyboard.press('Escape');
await b.page.waitForTimeout(1500);
assert.ok((await state(b)).tick - afterPause > 120, '재개 뒤 다시 진행');
assert.equal(await a.page.evaluate(() => window.__game.game.pausesLeft), 2, '일시정지 횟수 차감');
// 3) b가 나갔다가 같은 링크로 다시 들어온다
const bTeam = (await state(b)).team;
await b.page.close();
await a.page.waitForTimeout(2500);
// 방 코드만 아는 다른 사람은 빈자리를 차지하지 못한다
const intruder = await open({ passAssist: 'assisted', shotAssist: 'assisted', moveAssist: 'high' }, roomUrl);
await intruder.page.waitForTimeout(5000);
assert.equal(await intruder.page.evaluate(() => !!window.__game?.game?.lockstep), false, '토큰 없는 사람은 못 들어옴');
await intruder.ctx.close();
// 같은 브라우저(토큰 보관)로는 다시 들어온다
b = await open({ passAssist: 'assisted', shotAssist: 'assisted', moveAssist: 'high' }, roomUrl, b.ctx);
await b.page.waitForFunction(() => window.__game?.game?.lockstep?.tick > 300, null, { timeout: 30000 });
await Promise.all([hold(a, ['ArrowDown', 'KeyD'], 3000), hold(b, ['ArrowRight'], 3000)]);
await a.page.waitForTimeout(2000);
const [sa, sb] = await Promise.all([state(a), state(b)]);
assert.equal(sb.team, bTeam, '다시 들어와도 같은 팀');
// 4) 강제로 한쪽 상태를 틀어 동기화 어긋남을 만들면 둘 다 다시 들어와 같은 경기로 복구된다
const tickBefore = sa.tick;
await a.page.evaluate(() => { window.__game.match.ball.body.position.x += 3; });
await a.page.waitForFunction(() => window.__game?.game?.lockstep && window.__game.game.lockstep.tick > 120 && window.__game.match.phase !== 'kickoff', null, { timeout: 60000 }).catch(() => {});
await a.page.waitForTimeout(6000);
await Promise.all([hold(a, ['ArrowUp'], 2000), hold(b, ['ArrowDown'], 2000)]);
await a.page.waitForTimeout(1500);
const [ra, rb] = await Promise.all([state(a), state(b)]);
console.log(JSON.stringify({ code, before, afterPause, a: sa, b: sb, recovered: [ra, rb], tickBefore, errors: [a.errors, b.errors] }));
assert.equal(ra.desync, null, '복구 뒤 어긋남 없음');
assert.equal(rb.desync, null);
assert.ok(ra.tick > tickBefore && Math.abs(ra.tick - rb.tick) < 240, '복구 뒤 이어서 진행');
assert.equal(sa.desync, null);
assert.equal(sb.desync, null);
assert.ok(Math.abs(sa.tick - sb.tick) < 240, '재접속 뒤 두 화면 틱 차이가 큼');
assert.equal(a.errors.length + b.errors.length, 0);
await browser.close();
