import './installMath';
import { PHYSICS } from '../config';
import { command } from './testCommand';
import { HeadlessModel } from './HeadlessModel';
import { headlessMatch, InputLog, replay, stateHash } from './Replay';

/**
 * 브라우저 엔진별 결정성 검사: 고정된 의사 난수 입력으로 두 사람 경기를 seconds초 돌리고 매 초 해시를 낸다.
 * 같은 결과가 나와야 서로 다른 브라우저끼리 락스텝으로 붙을 수 있다.
 */
export function determinismHashes(seconds = 60, seed = 77): number[] {
  const log = new InputLog();
  let s = 12345;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 7) >>> 0) / 4294967296;
  const ticks = Math.round(seconds / PHYSICS.step);
  let dir = 0, mode = 0;
  for (let t = 0; t < ticks; t++) {
    const cmds = [command(), command()] as const;
    if (t % 30 === 0) { dir = Math.floor(rnd() * 8); mode = Math.floor(rnd() * 5); }
    cmds.forEach((c, team) => {
      const a = ((dir + team * 3) % 8) / 8 * Math.PI * 2;
      c.move.set(Math.cos(a), 0, Math.sin(a));
      c.sprint = mode === 1;
      const on = t % 30 < 10;
      if (mode === 2) c.pass = { held: on, pressed: t % 30 === 0, released: t % 30 === 10 };
      if (mode === 3) c.shoot = { held: on, pressed: t % 30 === 0, released: t % 30 === 10 };
      if (mode === 4) c.tackle = { held: on, pressed: t % 30 === 0, released: false };
    });
    log.push(cmds);
  }
  const m = headlessMatch({ seed, options: { userTeams: [true, true] } }, () => new HeadlessModel());
  const per = Math.round(1 / PHYSICS.step), out: number[] = [];
  for (let t = 0; t < ticks; t += per) {
    replay(m, log, t, Math.min(ticks, t + per));
    out.push(stateHash(m));
  }
  return out;
}
