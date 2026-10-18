import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

// pnpm dev 실행 뒤 node scripts/playground-smoke.mjs. Chrome 실행은 한 번만 시도한다.
const baseURL = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const url = new URL(baseURL);
url.searchParams.set('playground', '');
let browser;
try {
  browser = await chromium.launch({ executablePath: await chromePath() });
} catch (error) {
  console.error(`플레이그라운드 브라우저 확인 미실행: Chrome 실행 실패 (재시도 없음)\n${error.message}`);
  process.exitCode = 1;
}

if (browser) {
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 }, acceptDownloads: true });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url.href);
    await page.waitForFunction(() => window.__game?.game.playground?.records.length > 10);
    const counts = {};
    for (const [scenario, count] of Object.entries({ free: 1, duel: 2, pressure: 4, receive: 2, slide: 2, keeper: 2 })) {
      await page.locator('[data-tab="drills"]').click();
      await page.locator(`[data-scenario="${scenario}"]`).click();
      await page.waitForFunction((id) => window.__game.game.playground.scenarios.current === id && window.__game.game.playground.records.length > 5, scenario);
      counts[scenario] = await page.evaluate(() => window.__game.match.players.length);
      assert.equal(counts[scenario], count);
    }
    await page.locator('[data-tab="drills"]').click();
    await page.locator('[data-scenario="free"]').click();
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => window.__game.game.playground.records.some((r) => r.telemetry.playerSpeed > 3));
    await page.keyboard.up('ArrowUp');
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(() => window.__game.game.playground.latest.lastTurnSeconds !== null);
    await page.keyboard.up('ArrowRight');
    const turn = await page.evaluate(() => window.__game.game.playground.latest.lastTurnSeconds);
    assert.ok(turn <= 1, `90° 전환 ${turn}s`);
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => window.__game.match.elapsed < 0.3);
    // 슬라이더가 덮여 있는 details만 펼친다.
    await page.locator('[data-tab="dev"]').click();
    await page.locator('#playground details > summary', { hasText: '파라미터' }).click();
    const slider = page.locator('[data-param="leadWalk"]');
    await slider.evaluate((input) => { input.value = '0.6'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('#playground details > summary', { hasText: '파라미터' }).click();
    await page.waitForFunction(() => window.__game.game.playground.records.at(-1)?.parameters.DRIBBLE.leadWalk === 0.6);
    // JSON 스크립트 재생: 화면에서 돌린 결과도 헤드리스와 같은 형식이어야 한다
    const scripted = await page.evaluate(() => window.__playground.run({ scenario: 'duel', seed: 3, duration: 3, inputs: [{ t: 0, keys: ['ArrowRight'] }] }).summary);
    assert.ok(Number.isFinite(scripted.touches) && scripted.firstWithin2m !== null, JSON.stringify(scripted));
    const exported = {};
    for (const format of ['json', 'csv']) {
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator(`#pg-${format}`).click()]);
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8');
      assert.ok(text.includes('input') && text.includes('ballVelocity') && text.includes('parameters'));
      if (format === 'json') assert.ok(JSON.parse(text).records.length > 0);
      exported[format] = Buffer.byteLength(text);
    }
    await page.locator('[data-tab="drills"]').click();
    await page.locator('[data-scenario="slide"]').click();
    await page.keyboard.press('KeyA');
    await page.waitForFunction(() => window.__game.game.playground.records.some((r) => r.telemetry.motionId?.includes('sliding')));
    await page.waitForFunction(() => window.__game.game.playground.records.some((r) => r.telemetry.hipsHeight !== null && r.telemetry.hipsHeight < 0.45));
    const slide = await page.evaluate(() => {
      const rows = window.__game.game.playground.records.filter((r) => r.telemetry.motionId?.includes('sliding'));
      return { motion: rows[0].telemetry.motionId, minHips: Math.min(...rows.map((r) => r.telemetry.hipsHeight)) };
    });
    const mobile = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    const touchPage = await mobile.newPage();
    touchPage.on('pageerror', (error) => errors.push(error.message));
    await touchPage.goto(url.href);
    await touchPage.waitForFunction(() => window.__game?.game.playground?.records.length > 10);
    await touchPage.locator('#playground > summary').tap();
    const pad = touchPage.locator('.touch-move');
    assert.equal(await pad.isVisible(), true);
    // 실제 TouchControls의 포인터 경로를 따라 두 손 입력을 함께 보낸다.
    const touchResult = await touchPage.evaluate(async () => {
      const pad = document.querySelector('.touch-move');
      const button = document.querySelector('[data-touch="sprint"]');
      const pointer = (el, type, id, x, y) => el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerType: 'touch', pointerId: id, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
      }));
      // 합성 포인터에는 네이티브 캡처가 없으므로 이 검사에서만 캡처 함수를 대체한다.
      pad.setPointerCapture = button.setPointerCapture = () => {};
      const r = pad.getBoundingClientRect(), b = button.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      pointer(pad, 'pointerdown', 41, x, y);
      pointer(pad, 'pointermove', 41, x + 65, y);
      pointer(button, 'pointerdown', 42, b.x + 10, b.y + 10);
      await new Promise((resolve) => setTimeout(resolve, 700));
      const rows = window.__game.game.playground.records;
      const result = { moved: rows.some((r) => r.telemetry.playerSpeed > 1), sprint: rows.some((r) => r.input.sprint), steps: rows.length };
      pointer(pad, 'pointerup', 41, x + 65, y);
      pointer(button, 'pointerup', 42, b.x + 10, b.y + 10);
      return result;
    });
    assert.equal(touchResult.moved, true);
    assert.equal(touchResult.sprint, true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ scenarios: counts, turnSeconds: turn, slide, exportBytes: exported, mobile: touchResult, pageErrors: errors }, null, 2));
    await mobile.close();
  } finally {
    await browser.close();
  }
}
