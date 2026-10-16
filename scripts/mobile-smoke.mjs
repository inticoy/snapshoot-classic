import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

// pnpm dev 실행 후 pnpm test:mobile. 실행이 차단되면 재시도하지 않고 기록한다.
const baseURL = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const output = '.artifacts/mobile-smoke';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: await chromePath() });
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const errors = [];
  const kicks = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith(baseURL) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('console', (message) => { if (message.text().startsWith('[event] kick')) kicks.push(message.text()); });
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__game && document.documentElement.classList.contains('touch-device'));
  const previous = page.getByRole('button', { name: '경기 시간 이전 값', exact: true });
  const next = page.getByRole('button', { name: '경기 시간 다음 값', exact: true });
  for (const button of [previous, next]) {
    const box = await button.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
  }
  await previous.tap();
  assert.match(await page.locator('.menu-item').filter({ has: page.getByRole('button', { name: '경기 시간', exact: true }) }).innerText(), /2분/);
  await next.tap();
  await page.screenshot({ path: `${output}/menu.png` });
  await page.getByRole('button', { name: '경기 시작', exact: true }).tap();
  await page.waitForFunction(() => window.__game.game.state === 'playing' && window.__game.match.phase === 'playing');
  await page.locator('#touch-controls').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#hints').isVisible(), false);
  const graphics = await page.evaluate(() => {
    const game = window.__game.game;
    return { dpr: game.renderer.getPixelRatio(), shadowSize: game.sun.shadow.mapSize.x, crowd: game.stadium.crowd.count, fullCrowd: game.stadium.crowdBase.length };
  });
  assert.equal(graphics.dpr, 1.25);
  assert.equal(graphics.shadowSize, 1024);
  assert.equal(graphics.crowd, Math.floor(graphics.fullCrowd * 0.25));

  // 이동/슛은 실제 포인터 → Input → 경기 루프를 통과한다. AI의 우연한 탈취만 막는다.
  const start = await page.evaluate(async () => {
    const m = window.__game.match;
    const { PITCH } = await import('/src/config.ts');
    for (const [i, player] of m.players.entries()) {
      player.pos.set(-PITCH.halfL + 2 + i * 2, 0, PITCH.halfW - 2);
      player.vel.set(0, 0, 0);
      player.actionLock = 60;
    }
    const player = m.forward(0);
    player.pos.set(15, 0, 0);
    player.facing.set(1, 0, 0);
    player.actionLock = player.kickCooldown = 0;
    m.ball.reset(15.35, 0);
    m.ball.owner = m.ball.lastTouch = player;
    m.controlled = player;
    m.phase = 'playing';
    m.cancelUserCharge();
    m.passTarget = null;
    return { x: player.pos.x, z: player.pos.z, shots: m.stats.shots[0] };
  });
  await page.waitForFunction(() => document.querySelector('#touch-controls').dataset.mode === 'attack');
  const cdp = await page.context().newCDPSession(page);
  const fingers = new Map();
  const send = async (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers.values()] });
  fingers.set(1, { id: 1, x: 120, y: 235 });
  await send('touchStart');
  fingers.set(1, { id: 1, x: 172, y: 235 });
  await send('touchMove');
  const shotBox = await page.locator('[data-touch="shoot"]').boundingBox();
  const shot = { id: 2, x: shotBox.x + shotBox.width / 2, y: shotBox.y + shotBox.height / 2 };
  fingers.set(2, shot);
  await send('touchStart');
  await page.waitForFunction(() => window.__game.match.charge?.value >= 0.35);
  const moved = await page.evaluate(({ x, z }) => Math.hypot(window.__game.match.controlled.pos.x - x, window.__game.match.controlled.pos.z - z), start);
  assert.ok(moved > 0.2, `선수 이동 ${moved}m`);
  assert.equal(await page.evaluate(() => window.__game.game.input.isDown('shoot')), true);
  const beforeKicks = kicks.length;
  fingers.delete(2);
  await send('touchEnd');
  await page.waitForFunction((shots) => window.__game.match.stats.shots[0] === shots + 1, start.shots);
  assert.ok(kicks.length > beforeKicks, '슛 kick 이벤트');
  assert.ok(await page.evaluate(() => window.__game.game.input.moveAxis().x > 0.9));
  fingers.clear();
  await send('touchEnd');
  assert.deepEqual(await page.evaluate(() => window.__game.game.input.moveAxis()), { x: 0, y: 0 });
  await page.screenshot({ path: `${output}/play.png` });

  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const hud of ['#radar', '#nb-left', '#nb-right']) {
    const box = await page.locator(hud).boundingBox();
    for (const button of await page.locator('.touch-button:visible').all()) assert.equal(overlap(box, await button.boundingBox()), false, `${hud}와 버튼 겹침`);
  }
  await page.locator('[data-touch="pause"]').tap();
  await page.waitForFunction(() => window.__game.game.state === 'paused');
  const clock = await page.evaluate(() => window.__game.match.clock);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__game.match.clock), clock);
  await page.getByRole('button', { name: '뒤로', exact: true }).tap();
  await page.waitForFunction(() => window.__game.game.state === 'playing');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#rotate-guide').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.__game.game.state === 'paused');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('#rotate-guide').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '계속하기', exact: true }).tap();
  await page.waitForFunction(() => window.__game.game.state === 'playing');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ viewport: '844x390', hasTouch: true, movedMetres: Number(moved.toFixed(3)), userShots: 1, kickEvents: kicks.length - beforeKicks, ...graphics, pageErrors: errors.length, screenshots: output }));
} finally {
  await browser.close();
}
