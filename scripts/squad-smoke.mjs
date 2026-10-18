import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

const browser = await chromium.launch({ executablePath: await chromePath() });
const url = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
try {
  for (const [width, height, mobile] of [[1280, 720, false], [844, 390, true], [390, 844, true], [320, 568, true]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.locator('.menu-left').waitFor();
    assert.equal(await page.getByRole('button', { name: '선수 능력치', exact: true }).count(), 0);
    // hover로 메뉴가 다시 그려지는 기존 동작과 무관하게 스쿼드 화면에 진입한다.
    await page.getByRole('button', { name: '스쿼드', exact: true }).evaluate((el) => el.click());
    const geometry = await page.evaluate(() => {
      const pitch = document.querySelector('.squad-pitch').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.squad-pitch .squad-player')].map((el) => el.getBoundingClientRect());
      const outside = cards.some((r) => r.left < pitch.left || r.right > pitch.right || r.top < pitch.top || r.bottom > pitch.bottom);
      const overlap = cards.some((a, i) => cards.slice(i + 1).some((b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)));
      return { count: cards.length, outside, overlap, overflow: document.documentElement.scrollWidth > innerWidth, rotate: getComputedStyle(document.querySelector('#rotate-guide')).display };
    });
    assert.deepEqual(geometry, { count: 11, outside: false, overlap: false, overflow: false, rotate: 'none' }, `${width}×${height}`);
    const starter = page.locator('[data-player="9"][data-bench="false"]');
    const bench = page.locator('[data-player="4"][data-bench="true"]');
    const incoming = await bench.locator('.squad-name').textContent();
    if (mobile) await starter.tap();
    else { await starter.focus(); await page.keyboard.press('Enter'); }
    await page.locator('.squad-player[aria-expanded="true"]').waitFor();
    assert.ok((await page.locator('#squad-detail').textContent()).includes('골 결정력'));
    if (mobile) await bench.tap();
    else { await bench.focus(); await page.keyboard.press('Space'); }
    await page.waitForFunction((name) => document.querySelector('[data-player="9"][data-bench="false"] .squad-name')?.textContent === name, incoming);
    assert.equal(await starter.locator('.squad-name').textContent(), incoming);
    await page.locator('[data-team="1"]').click();
    assert.equal(await page.locator('.squad-bench .squad-player').count(), 5);
    await page.locator('[data-team="0"]').click();
    assert.equal(await starter.locator('.squad-name').textContent(), incoming);
    await page.getByRole('button', { name: '돌아가기', exact: true }).click();
    await page.getByRole('button', { name: '경기 시작', exact: true }).evaluate((el) => el.click());
    await page.locator('#overlay.hidden').waitFor({ state: 'attached' });
    assert.equal(await page.evaluate(() => window.__game.match.teams[0][9].profile.name), incoming);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '계속하기', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '스쿼드', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`${width}×${height}: 포메이션·상세·교체·경기 적용 통과`);
    await context.close();
  }
} finally { await browser.close(); }
