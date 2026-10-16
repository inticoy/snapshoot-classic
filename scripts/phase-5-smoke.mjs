import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromePath } from './chrome-path.mjs';
import { chromium } from 'playwright';

// 5단계: 등번호·이름·얼굴 근접 스크린샷을 docs/screenshots/에 남긴다.
const baseURL = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const output = 'docs/screenshots';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: await chromePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__game && document.querySelector('#overlay')?.textContent.includes('경기 시작'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.game.state === 'playing');
  await page.evaluate(() => document.fonts.ready);

  /** 경기를 멈추고 카메라를 선수 주변에 고정한다 */
  const shoot = async (file, setup) => {
    await page.evaluate(setup);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${output}/${file}` });
  };
  await page.evaluate(() => {
    const { game, match } = window.__game;
    game.rig.update = () => {};
    game.hud.show(false);
    match.phase = 'kickoff';
    match.phaseTimer = 1e9;
    // 홈 공격수 3명·원정 2명·키퍼를 한 줄로 세운다
    const pick = [match.teams[0][9], match.teams[0][8], match.teams[0][1], match.teams[1][9], match.teams[1][5], match.teams[0][0], match.teams[1][0]];
    pick.forEach((p, i) => { p.pos.set(-6 + i * 2, 0, 0); p.vel.set(0, 0, 0); p.facing.set(0, 0, -1); p.basePose = null; });
    match.ball.reset(20, 20);
    window.__line = pick.map((p) => p.profile.short);
  });
  await shoot('back-numbers.png', () => {
    const cam = window.__game.game.rig.camera;
    cam.fov = 30; cam.updateProjectionMatrix();
    cam.position.set(0, 2.2, 9);
    cam.lookAt(0, 1.2, 0);
  });
  await shoot('faces.png', () => {
    const { game, match } = window.__game;
    for (const p of match.players) p.facing.set(0, 0, 1);
    const cam = game.rig.camera;
    cam.fov = 26; cam.updateProjectionMatrix();
    cam.position.set(-3, 1.7, 5.5);
    cam.lookAt(-3, 1.45, 0);
  });
  await shoot('back-closeup.png', () => {
    const { game, match } = window.__game;
    for (const p of match.players) p.facing.set(0, 0, -1);
    const cam = game.rig.camera;
    cam.fov = 22; cam.updateProjectionMatrix();
    cam.position.set(-5, 1.6, 4);
    cam.lookAt(-5, 1.25, 0);
  });
  const line = await page.evaluate(() => window.__line);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ line, pageErrors: errors.length, screenshots: output }));
} finally {
  await browser.close();
}
