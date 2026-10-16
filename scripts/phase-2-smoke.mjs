import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

const baseURL = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const output = '.artifacts/phase-2';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: await chromePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (r) => { if (r.url().startsWith(baseURL) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__game && document.querySelector('#overlay')?.textContent.includes('경기 시작'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.game.state === 'playing' && window.__game.match.phase === 'playing');
  const setup = await page.evaluate(() => {
    const { game, match } = window.__game;
    match.options.userControl = false;
    let skinnedPlayers = 0;
    for (const p of match.players) {
      let skinned = false;
      p.model.root.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
      if (skinned) skinnedPlayers++;
    }
    return { teams: match.teams.map((t) => t.length), skinnedPlayers, dpr: game.renderer.getPixelRatio(), shadowSize: game.sun.shadow.mapSize.x };
  });
  assert.deepEqual(setup.teams, [11, 11]);
  assert.equal(setup.skinnedPlayers, 22, '절차적 대체 모델이 아닌 스킨드 캐릭터 22명이 필요하다');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${output}/broadcast.png` });
  const frames = await page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    let start, previous;
    function sample(now) {
      start ??= now;
      if (previous !== undefined) samples.push(now - previous);
      previous = now;
      if (now - start < 10000) requestAnimationFrame(sample);
      else {
        const sorted = [...samples].sort((a, b) => a - b);
        resolve({ seconds: (now - start) / 1000, frames: samples.length, fps: samples.length * 1000 / (now - start), p95ms: sorted[Math.floor(sorted.length * 0.95)], maxMs: sorted.at(-1) });
      }
    }
    requestAnimationFrame(sample);
  }));
  // 실시간 루프를 멈춘 뒤 같은 장면을 고정 카메라로 확대한다. 메뉴는 열지 않는다.
  await page.evaluate(async () => {
    const { PITCH } = await import('/src/config.ts');
    const game = window.__game.game;
    game.state = 'paused';
    game.rig.camera.position.set(0, 125, 0);
    game.rig.camera.lookAt(0, 0, 0);
    window.__phase2Pitch = { halfL: PITCH.halfL, halfW: PITCH.halfW };
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${output}/pitch.png` });
  for (const end of [-1, 1]) {
    for (const side of [-1, 1]) {
      await page.evaluate(({ end, side }) => {
        const { halfL, halfW } = window.__phase2Pitch;
        const camera = window.__game.game.rig.camera;
        camera.position.set(end * (halfL - 2), 9, side * (halfW + 5));
        camera.lookAt(end * (halfL - 1.5), 0, side * (halfW - 1.5));
      }, { end, side });
      await page.waitForTimeout(100);
      await page.screenshot({ path: `${output}/corner-${end}-${side}.png` });
    }
  }
  const report = { ...setup, ...frames, pageErrors: errors, screenshots: output };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.deepEqual(errors, []);
  // 60Hz 화면의 타이머 오차를 허용한다. 하드웨어/브라우저/전원 모드와 함께 결과를 검토한다.
  assert.ok(frames.fps >= 55, `60fps 목표 미달: ${frames.fps.toFixed(1)}fps`);
  assert.ok(frames.p95ms <= 25, `프레임 지연: p95 ${frames.p95ms.toFixed(1)}ms`);
} finally {
  await browser.close();
}
