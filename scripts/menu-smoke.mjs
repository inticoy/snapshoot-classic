import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

const url = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const browser = await chromium.launch({ executablePath: await chromePath() });
const results = [];
try {
  // 세로 화면은 회전 안내가 덮으므로(게임은 가로 전용) 데스크톱·모바일 가로만
  for (const [width, height, mobile] of [[1280, 720, false], [844, 390, true], [740, 360, true]]) {
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
    // 마우스를 올리면 메뉴가 다시 그려지므로 매번 번호로 다시 찾는다
    for (let i = 0, n = await page.locator('.menu-item').count(); i < n; i++) {
      // 실제 포인터 이동은 다시 그려지는 순간과 겹쳐 실패하므로 메뉴가 듣는 pointerenter를 직접 보낸다
      const ok = await page.evaluate((i) => {
        const el = document.querySelectorAll('.menu-item')[i];
        if (!el) return false;
        el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
        return true;
      }, i);
      if (!ok) continue;
      await page.waitForTimeout(30);
      await check();
    }
    // 포인터를 옮기면 지나가는 항목에 hover가 걸려 메뉴가 다시 그려지고 스크롤이 맨 위로 간다 → 요소를 직접 누른다
    await page.getByRole('button', { name: '설정', exact: true }).evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
    // 마우스를 올리면 메뉴가 다시 그려지므로 매번 번호로 다시 찾는다
    for (let i = 0, n = await page.locator('.menu-item').count(); i < n; i++) {
      // 실제 포인터 이동은 다시 그려지는 순간과 겹쳐 실패하므로 메뉴가 듣는 pointerenter를 직접 보낸다
      const ok = await page.evaluate((i) => {
        const el = document.querySelectorAll('.menu-item')[i];
        if (!el) return false;
        el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
        return true;
      }, i);
      if (!ok) continue;
      await page.waitForTimeout(30);
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
