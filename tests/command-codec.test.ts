import * as THREE from 'three';
import { expect, it } from 'vitest';
import { CommandDecoder, COMMAND_BYTES, encodeCommand } from '../src/net/CommandCodec';
import { command } from './helpers';

it('명령은 6바이트로 오가고, 눌림·뗌 순간은 직전 틱과 비교해 복원된다', () => {
  const dec = new CommandDecoder();
  const a = command();
  a.move.set(0.6, 0, -0.8); a.sprint = true; a.shoot = { held: true, pressed: true, released: false };
  const buf = encodeCommand(a);
  expect(buf.length).toBe(COMMAND_BYTES);
  const r1 = dec.decode(buf);
  expect(r1.shoot).toEqual({ held: true, pressed: true, released: false });
  expect(r1.sprint).toBe(true);
  expect(r1.move.distanceTo(new THREE.Vector3(0.6, 0, -0.8))).toBeLessThan(0.03);
  const r2 = dec.decode(encodeCommand(a));
  expect(r2.shoot).toEqual({ held: true, pressed: false, released: false });
  a.shoot = { held: false, pressed: false, released: true };
  expect(dec.decode(encodeCommand(a)).shoot).toEqual({ held: false, pressed: false, released: true });
  const zero = dec.decode(encodeCommand(command()));
  expect(zero.move.length()).toBe(0);
});

it('파워슛(F)·키보드 킥 표시도 보내고, 한 스텝 안의 짧은 탭도 잃지 않는다', () => {
  const dec = new CommandDecoder();
  const a = command();
  a.power = { held: true, pressed: true, released: false };
  a.keyboardKick = true;
  a.pass = { held: false, pressed: true, released: true };
  const r = dec.decode(encodeCommand(a));
  expect(r.power?.held).toBe(true);
  expect(r.keyboardKick).toBe(true);
  expect(r.pass.pressed).toBe(true);
  expect(dec.decode(encodeCommand(command())).pass.released).toBe(true);
});
