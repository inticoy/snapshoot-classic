import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

const url = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const browser = await chromium.launch({ executablePath: await chromePath() });
const results = [];
try {
  for (const [width, height, mobile] of [[1280, 720, false], [844, 390, true], [390, 844, true]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator('.menu-left').waitFor();
    let checked = 0;
    let maxDrift = 0;
    let maxOverflow = 0;
    let scrollablePanels = 0;
    const baseline = await page.locator('.menu-left').boundingBox();
    const check = async () => {
      const geometry = await page.evaluate(() => {
        const box = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        };
        const right = document.querySelector('.menu-right');
        return { left: box('.menu-left'), menu: box('.menu'), right: box('.menu-right'), scrollable: right.scrollHeight > right.clientHeight + 1 };
      });
      maxDrift = Math.max(maxDrift, Math.abs(geometry.left.x - baseline.x), Math.abs(geometry.left.y - baseline.y));
      for (const r of [geometry.left, geometry.menu, geometry.right]) {
        maxOverflow = Math.max(maxOverflow, Math.max(0, -r.x, -r.y, r.right - width, r.bottom - height));
      }
      if (geometry.scrollable) scrollablePanels++;
      checked++;
    };
    for (const item of await page.locator('.menu-item').all()) {
      await item.hover();
      await check();
    }
    await page.getByRole('button', { name: '설정', exact: true }).click();
    for (const item of await page.locator('.menu-item').all()) {
      await item.hover();
      await check();
    }
    assert.equal(maxDrift, 0, `${width}×${height}: 왼쪽 메뉴 위치 변화`);
    assert.equal(maxOverflow, 0, `${width}×${height}: 메뉴 뷰포트 넘침`);
    assert.ok(scrollablePanels > 0, `${width}×${height}: 긴 패널 자체 스크롤 없음`);
    assert.deepEqual(errors, []);
    results.push({ viewport: `${width}x${height}`, tabs: checked, leftDriftPx: maxDrift, overflowPx: maxOverflow, scrollablePanels, pageErrors: errors.length });
    await context.close();
  }
  console.table(results);
} finally {
  await browser.close();
}
