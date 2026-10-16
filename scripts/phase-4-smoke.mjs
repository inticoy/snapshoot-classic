import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromePath } from './chrome-path.mjs';
import { chromium } from 'playwright';

// 4단계 규칙 화면: 프리킥 벽·카드·PK·하프타임·승부차기를 실제 브라우저 루프로 확인하고 스크린샷을 남긴다.
const baseURL = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const output = '.artifacts/phase-4';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: await chromePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__game && document.querySelector('#overlay')?.textContent.includes('경기 시작'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.game.state === 'playing' && window.__game.match.phase === 'playing');

  // 1) 박스 근처 직접 프리킥 (사용자 팀) → 벽
  await page.evaluate(async () => {
    const { PITCH } = await import('/src/config.ts');
    const m = window.__game.match;
    m.setPieces.award('freekick', 0, m.players[0].pos.clone().set(PITCH.halfL - 23, 0, -6));
  });
  await page.waitForFunction(() => window.__game.match.phase === 'setpiece');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/freekick.png` });
  assert.equal(await page.evaluate(() => window.__game.match.setPieces.current.shooting), true);
  // 감아차기로 직접 슛
  await page.keyboard.down('KeyZ');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(450);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyZ');
  await page.waitForFunction(() => window.__game.match.phase === 'playing');
  // 킥 동작: 발이 공에 닿는 순간(약 0.16초 뒤) 슛이 기록된다
  await page.waitForFunction(() => window.__game.match.stats.shots[0] >= 1, null, { timeout: 3000 }).catch(() => {});
  const shots = await page.evaluate(() => window.__game.match.stats.shots[0]);
  assert.ok(shots >= 1, '프리킥 슛이 기록되지 않음');

  // 2) 카드
  await page.evaluate(() => {
    const m = window.__game.match;
    m.rules.book(m.teams[1][5], 'yellow');
    m.rules.book(m.teams[1][5], 'yellow');
  });
  await page.waitForTimeout(300);
  const debug = await page.evaluate(() => [window.__game.game.state, window.__game.match.phase, window.__game.match.rules.reds.join(), document.querySelector('#reds-a').outerHTML]);
  assert.equal(await page.locator("#reds-a i").count(), 1, JSON.stringify([debug, errors]));
  await page.screenshot({ path: `${output}/card.png` });

  // 3) 사용자 PK
  await page.evaluate(async () => {
    const m = window.__game.match;
    m.setPieces.award("penalty", 0, m.players[0].pos.clone());
  });
  await page.waitForFunction(() => window.__game.match.phase === 'setpiece');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/penalty.png` });
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('ArrowUp');
  await page.waitForFunction(() => window.__game.match.phase !== 'setpiece');

  // 4) 하프타임 → 후반
  await page.evaluate(() => {
    const m = window.__game.match;
    m.phase = 'playing';
    m.ball.shot = null;
    m.halfClock = m.halfLength * (1 + 3 / 45) + 0.05;
  });
  await page.waitForFunction(() => document.querySelector('#overlay')?.textContent.includes('후반 시작'), null, { timeout: 8000 });
  await page.screenshot({ path: `${output}/halftime.png` });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.match.half === 2 && window.__game.match.phase === 'playing', null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => window.__game.match.teams[0][0].attackDir), -1);
  await page.screenshot({ path: `${output}/second-half.png` });

  // 5) 승부차기
  await page.evaluate(() => {
    const m = window.__game.match;
    window.__game.settings.shootout = true;
    m.score[0] = m.score[1] = 0;
    m.stoppage = 1;
    m.ball.shot = null;
    m.halfClock = m.halfLength * (1 + 1 / 45) + 0.05;
  });
  await page.waitForFunction(() => window.__game.match.phase === 'shootout', null, { timeout: 8000 });
  await page.waitForTimeout(600);
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('ArrowDown');
  await page.waitForFunction(() => window.__game.match.shootout.results[0].length === 1, null, { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/shootout.png` });
  // 남은 사용자 차례마다 번갈아 구석을 노려 찬다
  for (let i = 0; i < 20; i++) {
    const state = await page.evaluate(() => {
      const m = window.__game.match;
      return m.phase !== 'shootout' ? 'done' : m.shootout.userKicking && m.shootout.stage === 'ready' ? 'kick' : 'wait';
    });
    if (state === 'done') break;
    if (state === 'kick') {
      const key = i % 2 ? 'ArrowUp' : 'ArrowDown';
      await page.keyboard.down(key);
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(300);
      await page.keyboard.up('KeyD');
      await page.keyboard.up(key);
    }
    await page.waitForTimeout(1500);
  }
  await page.waitForFunction(() => window.__game.match.phase === 'fulltime', null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#overlay')?.textContent.includes('승부차기'), null, { timeout: 8000 }).catch(async (e) => {
    console.log(await page.evaluate(() => [window.__game.game.state, window.__game.match.phase, document.querySelector('#overlay')?.className, document.querySelector('#overlay')?.textContent.slice(0, 200)]));
    throw e;
  });
  await page.screenshot({ path: `${output}/result.png` });
  const so = await page.evaluate(() => window.__game.match.shootout.score);
  assert.notEqual(so[0], so[1]);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ shootout: so, pageErrors: errors.length, screenshots: output }));
} finally {
  await browser.close();
}
