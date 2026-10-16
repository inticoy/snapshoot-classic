import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

// pnpm dev 실행 뒤 node scripts/dribble-smoke.mjs: 실제 키 입력과 경기 루프를 함께 검증한다.
const baseURL = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
let browser;
try {
  browser = await chromium.launch({ executablePath: await chromePath() });
} catch (error) {
  // 샌드박스에서 실행이 막히면 재시도 없이 미실행 사유를 남긴다.
  console.error(`드리블 브라우저 확인 미실행: Chrome 실행 실패\n${error.message}`);
  process.exitCode = 1;
}

if (browser) {
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseURL);
    await page.waitForFunction(() => window.__game && document.querySelector('#overlay')?.textContent.includes('경기 시작'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__game.game.state === 'playing' && window.__game.match.phase === 'playing');
    await page.evaluate(() => {
      const { match: m, game } = window.__game;
      game.rig.mode = 'tele';
      m.players.forEach((p, i) => {
        p.pos.set(-50 + i * 2, 0, 32);
        p.vel.set(0, 0, 0);
        p.actionLock = 60;
      });
      const p = m.forward(0);
      p.actionLock = 0;
      p.pos.set(-20, 0, 0);
      p.facing.set(0, 0, -1);
      m.controlled = p;
      m.ball.reset(-20, -0.4);
      m.ball.owner = m.ball.lastTouch = p;
      const samples = window.__dribbleSmoke = [];
      const update = m.update.bind(m);
      m.update = (dt, cmd) => {
        update(dt, cmd);
        samples.push({
          dt, time: m.elapsed, input: [cmd.move.x, cmd.move.z],
          velocity: [m.ball.velocity.x, m.ball.velocity.z], owned: m.ball.owner === p,
        });
      };
    });
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1000);
    await page.keyboard.up('ArrowUp');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(1500);
    // 손을 뗀 프레임의 멈춤 터치가 측정에 섞이지 않게 먼저 결과를 읽는다.
    const result = await page.evaluate(() => {
      const samples = window.__dribbleSmoke;
      const up = samples.filter((s) => s.input[1] < -0.9);
      const right = samples.filter((s) => s.input[0] > 0.9);
      const angle = (s, x, z) => Math.acos(Math.max(-1, Math.min(1,
        (s.velocity[0] * x + s.velocity[1] * z) / Math.hypot(...s.velocity)))) * 180 / Math.PI;
      const firstRight = right.find((s) => Math.hypot(...s.velocity) > 1 && angle(s, 1, 0) <= 30);
      return {
        upSeconds: up.reduce((t, s) => t + s.dt, 0),
        rightSeconds: right.reduce((t, s) => t + s.dt, 0),
        upVelocity: up.at(-1)?.velocity,
        rightVelocity: right.at(-1)?.velocity,
        upErrorDegrees: up.length ? angle(up.at(-1), 0, -1) : null,
        rightErrorDegrees: right.length ? angle(right.at(-1), 1, 0) : null,
        turnSeconds: firstRight ? firstRight.time - right[0].time + firstRight.dt : null,
        possessionKept: [...up, ...right].every((s) => s.owned),
        samples: samples.length,
      };
    });
    await page.keyboard.up('ArrowRight');
    console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
    assert.ok(result.upSeconds >= 0.8 && result.rightSeconds >= 1.2, '키 입력 중 시뮬레이션 시간 부족');
    assert.ok(result.upErrorDegrees !== null && result.upErrorDegrees <= 30, '↑ 입력으로 전진하지 않음');
    assert.ok(result.turnSeconds !== null && result.turnSeconds <= 1, '→ 입력 1초 안에 ±30°로 전환하지 않음');
    assert.ok(result.rightErrorDegrees !== null && result.rightErrorDegrees <= 30, '→ 진행 방향을 유지하지 않음');
    assert.equal(result.possessionKept, true, '전환 중 소유 상실');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
