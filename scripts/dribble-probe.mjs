import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

// 실제 경기 시작(킥오프)부터 키보드 입력만으로 드리블하며 매 스텝 데이터를 기록한다.
const baseURL = process.env.SNAPSHOOT_URL ?? 'http://127.0.0.1:5180/';
const browser = await chromium.launch({ executablePath: await chromePath() });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(baseURL);
await page.waitForFunction(() => window.__game && document.querySelector('#overlay')?.textContent.includes('경기 시작'));
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__game.match.phase === 'playing');
await page.evaluate(() => {
  const m = window.__game.match;
  window.__log = [];
  window.__seg = 'start';
  const update = m.update.bind(m);
  m.update = (dt, cmd) => {
    update(dt, cmd);
    const p = m.controlled, b = m.ball;
    window.__log.push({
      seg: window.__seg, t: m.elapsed, phase: m.phase, input: [cmd.move.x, cmd.move.z], sprint: cmd.sprint,
      p: [p.pos.x, p.pos.z], v: [p.vel.x, p.vel.z], f: [p.facing.x, p.facing.z],
      b: [b.position.x, b.position.z], bv: [b.velocity.x, b.velocity.z],
      owner: b.owner ? `${b.owner.team}:${b.owner.profile.short}` : null, me: p.profile.short,
      touch: m.events.filter((e) => e.type === 'touch').length,
      ev: m.events.filter((e) => e.type !== 'touch' && e.type !== 'bounce').map((e) => e.type + (e.by ? ':' + e.by.profile.short : '') + (e.success !== undefined ? ':' + e.success : '')),
      near: Math.min(...m.teams[1 - p.team].map((o) => Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z))),
      lock: [p.actionLock, p.facingLock, p.stunned, m.kicking(p)],
    });
  };
});
const segs = [['right', ['ArrowRight'], 2000], ['left', ['ArrowLeft'], 2000], ['up', ['ArrowUp'], 1500], ['down', ['ArrowDown'], 1500], ['right+sprint', ['ArrowRight', 'KeyE'], 2000], ['none', [], 1000]];
for (const [name, keys, ms] of segs) {
  await page.evaluate((n) => (window.__seg = n), name);
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
}
const log = await page.evaluate(() => window.__log);
await browser.close();

const deg = (x, z) => (Math.atan2(z, x) * 180) / Math.PI;
for (const [name] of segs) {
  const s = log.filter((r) => r.seg === name);
  if (!s.length) continue;
  const a = s[0], z = s[s.length - 1];
  const moved = [z.p[0] - a.p[0], z.p[1] - a.p[1]];
  const avgV = s.reduce((acc, r) => [acc[0] + r.v[0], acc[1] + r.v[1]], [0, 0]).map((x) => x / s.length);
  const owned = s.filter((r) => r.owner && r.owner.endsWith(r.me)).length / s.length;
  console.log(`${name.padEnd(13)} input ${JSON.stringify(a.input.map((x) => +x.toFixed(2)))} moved (${moved.map((x) => x.toFixed(2)).join(', ')}) avgSpeed ${Math.hypot(...avgV).toFixed(2)} dir ${deg(...avgV).toFixed(0)}° owned ${(owned * 100).toFixed(0)}% touches ${s.reduce((n, r) => n + r.touch, 0)} me ${a.me}→${z.me} owner ${z.owner} phase ${z.phase} locks ${JSON.stringify(z.lock.map((x) => (typeof x === 'number' ? +x.toFixed(2) : x)))}`);
}
// 'right' 구간 처음 40스텝 자세히
for (const r of log.filter((r) => r.seg === (process.env.SEG ?? 'right')).slice(0, 240).filter((_, i) => i % 12 === 0)) {
  console.log('  ', r.t.toFixed(2), 'in', r.input.map((x) => x.toFixed(1)), 'v', r.v.map((x) => x.toFixed(2)), 'f', r.f.map((x) => x.toFixed(2)), 'ballRel', [r.b[0] - r.p[0], r.b[1] - r.p[1]].map((x) => x.toFixed(2)), 'T', r.touch, 'bv', r.bv.map((x) => x.toFixed(2)), r.owner, 'lock', JSON.stringify(r.lock.map((x) => (typeof x === 'number' ? +x.toFixed(2) : x))));
}
for (const r of log) if (r.ev.length) console.log('EV', r.seg, r.t.toFixed(2), r.ev.join(' '), 'nearOpp', r.near.toFixed(2));
console.log('errors', errors);
