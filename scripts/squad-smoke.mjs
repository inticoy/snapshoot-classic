import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

const browser = await chromium.launch({ executablePath: await chromePath() });
const url = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
try {
  for (const [width, height, mobile] of [[1920, 1080, false], [1280, 720, false], [844, 390, true], [390, 844, true], [320, 568, true]]) {
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
      const bench = [...document.querySelectorAll('.squad-bench .squad-player')].map((el) => el.getBoundingClientRect());
      const panels = [...document.querySelectorAll('.menu-right, .squad-view')];
      const clipped = [...cards, ...bench].some((r) => r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth);
      const scroll = panels.some((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
      return { count: cards.length, outside, overlap, clipped, scroll, overflow: document.documentElement.scrollWidth > innerWidth, rotate: getComputedStyle(document.querySelector('#rotate-guide')).display };
    });
    assert.deepEqual(geometry, { count: 11, outside: false, overlap: false, clipped: false, scroll: false, overflow: false, rotate: 'none' }, `${width}×${height}`);
    const starter = page.locator('[data-player="9"][data-bench="false"]');
    const bench = page.locator('[data-player="4"][data-bench="true"]');
    const incoming = await bench.locator('.squad-name').textContent();
    if (mobile) await starter.tap();
    else { await starter.focus(); await page.keyboard.press('Enter'); }
    await page.locator('.squad-player[aria-expanded="true"]').waitFor();
    assert.ok((await page.locator('#squad-detail').textContent()).includes('골 결정력'));
    const detail = await page.locator('#squad-detail').boundingBox();
    assert.ok(detail && detail.x >= 0 && detail.y >= 0 && detail.x + detail.width <= width && detail.y + detail.height <= height);
    if (mobile) await bench.tap();
    else { await bench.focus(); await page.keyboard.press('Space'); }
    await page.waitForFunction((name) => document.querySelector('[data-player="9"][data-bench="false"] .squad-name')?.textContent === name, incoming);
    assert.equal(await starter.locator('.squad-name').textContent(), incoming);
    // HTML5 drag 이벤트 대신 실제 마우스/터치 입력으로 포인터 캡처까지 확인한다.
    const cdp = mobile ? await context.newCDPSession(page) : null;
    const drag = async (source, target) => {
      const a = await source.boundingBox(), b = await target.boundingBox();
      assert.ok(a && b);
      const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
      const end = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      if (cdp) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
      } else {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 8 });
      }
      assert.equal(await page.locator('.squad-drag-ghost').count(), 1);
      assert.equal(await page.locator('.is-drop-target').count(), 1);
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await page.mouse.up();
      assert.equal(await page.locator('.squad-drag-ghost, .is-drop-target').count(), 0);
    };
    const outgoing = await bench.locator('.squad-name').textContent();
    await drag(bench, starter);
    assert.equal(await starter.locator('.squad-name').textContent(), outgoing);
    await drag(starter, bench);
    assert.equal(await starter.locator('.squad-name').textContent(), incoming);
    const winger = page.locator('[data-player="10"][data-bench="false"]');
    const wingerName = await winger.locator('.squad-name').textContent();
    await drag(starter, winger);
    assert.equal(await starter.locator('.squad-name').textContent(), wingerName);
    await drag(winger, starter);
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
