import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PHYSICS } from '../src/config';
import { headlessMatch, InputLog, replay, stateHash } from '../src/net/Replay';
import { command } from './helpers';
import { SimulationModel } from './helpers';

const setup = { seed: 77, options: { userTeams: [true, true] as [boolean, boolean] } };

/** 두 사람이 무작위로 조작하는 20초 입력 기록 */
function randomLog(ticks: number): InputLog {
  const log = new InputLog();
  let s = 12345;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 7) >>> 0) / 4294967296;
  let held = [0, 0];
  for (let t = 0; t < ticks; t++) {
    const cmds = [command(), command()] as const;
    for (const c of cmds) {
      if (t % 30 === 0) held = [Math.floor(rnd() * 8), Math.floor(rnd() * 4)];
      const a = held[0] / 8 * Math.PI * 2;
      c.move.set(Math.cos(a), 0, Math.sin(a));
      c.sprint = held[1] === 1;
      const press = held[1] === 2 && t % 30 < 8;
      c.pass = { held: press, pressed: press && t % 30 === 0, released: false };
    }
    log.push(cmds);
  }
  return log;
}

it('락스텝: 같은 시드 + 같은 입력 기록이면 두 경기의 상태 해시가 매 초 같다', () => {
  const log = randomLog(20 / PHYSICS.step);
  const a = headlessMatch(setup, () => new SimulationModel()), b = headlessMatch(setup, () => new SimulationModel());
  const perSecond = Math.round(1 / PHYSICS.step);
  for (let t = 0; t < log.length; t += perSecond) {
    replay(a, log, t, t + perSecond);
    replay(b, log, t, t + perSecond);
    expect(stateHash(a)).toBe(stateHash(b));
  }
});

it('재접속: 처음부터 재생한 경기는 계속 진행 중이던 경기와 같은 상태에 도착한다', () => {
  const log = randomLog(15 / PHYSICS.step);
  const live = headlessMatch(setup, () => new SimulationModel());
  replay(live, log, 0, log.length / 2);
  replay(live, log, log.length / 2, log.length);
  const late = replay(headlessMatch(setup, () => new SimulationModel()), log);
  expect(stateHash(late)).toBe(stateHash(live));
});

it('다른 입력은 해시가 달라진다 (어긋남 감지)', () => {
  const log = randomLog(3 / PHYSICS.step);
  const a = replay(headlessMatch(setup, () => new SimulationModel()), log);
  const other = new InputLog();
  for (let t = 0; t < log.length; t++) {
    const c = command();
    c.move.copy(new THREE.Vector3(0, 0, t > 200 ? 1 : 0));
    other.push([c, command()]);
  }
  const b = replay(headlessMatch(setup, () => new SimulationModel()), other);
  expect(stateHash(a)).not.toBe(stateHash(b));
});
