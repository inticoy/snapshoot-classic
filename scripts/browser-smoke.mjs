import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromePath } from './chrome-path.mjs';
import { chromium } from 'playwright';


const baseURL = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const output = '.artifacts/browser-smoke';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: await chromePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith(baseURL) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__game && document.querySelector('#overlay')?.textContent.includes('경기 시작'));
  assert.equal(await page.title(), 'SnapShoot Classic');
  await page.screenshot({ path: `${output}/menu.png` });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.game.state === 'playing' && window.__game.match.phase === 'playing');
  assert.equal(await page.locator('#hud').evaluate((el) => el.classList.contains('hidden')), false);
  await page.screenshot({ path: `${output}/play.png` });
  if (process.argv.includes('--update-og')) await page.screenshot({ path: 'public/og-image.png' });

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.game.state === 'paused');
  const clock = await page.evaluate(() => window.__game.match.clock);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__game.match.clock), clock);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.game.state === 'playing');

  // 슛이 빗나가는 우연을 제거하고, 골 판정은 실제 입력·경기 루프·물리로 검증한다.
  await page.evaluate(async () => {
    const { Random } = await import('/src/core/Random.ts');
    const m = window.__game.match;
    const random = new Random(42);
    m.random.next = () => random.next();
    for (const [i, player] of m.players.entries()) {
      player.pos.set(-23 + i * 2, 0, 16);
      player.vel.set(0, 0, 0);
      player.actionLock = 60;
    }
    const shooter = m.forward(0);
    shooter.pos.set(23, 0, 0);
    shooter.facing.set(1, 0, 0);
    shooter.actionLock = shooter.kickCooldown = 0;
    m.ball.reset(23.35, 0);
    m.ball.owner = m.ball.lastTouch = shooter;
    m.controlled = shooter;
    m.phase = 'playing';
    m.charge = null;
    m.passTarget = null;
    window.__game.settings.shotAssist = 'assisted';
  });
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__game.match.charge?.value >= 0.35);
  await page.keyboard.up('KeyD');
  await page.waitForFunction(() => window.__game.match.score[0] === 1);
  await page.screenshot({ path: `${output}/goal.png` });
  const result = await page.evaluate(() => ({
    score: [...window.__game.match.score], shots: [...window.__game.match.stats.shots],
    phase: window.__game.match.phase, goal: document.querySelector('#goal-word').textContent,
  }));
  assert.equal(result.goal, 'GOAL');
  assert.equal(result.phase, 'goal');
  assert.equal(result.shots[0], 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...result, pageErrors: errors.length, screenshots: output }));
} finally {
  await browser.close();
}
