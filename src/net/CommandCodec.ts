import * as THREE from 'three';
import type { ButtonState } from '../core/Input';
import type { UserCommand } from '../gameplay/Match';

/**
 * 멀티플레이 입력 전송: UserCommand ↔ 6바이트.
 *  [0..1] 버튼 '누르고 있음' 비트 (눌림·뗌 순간은 받는 쪽이 직전 틱과 비교해 복원)
 *  [2] 이동 방향(0..255 = 0..2π), [3] 이동 크기(0..255)
 *  [4] 개인기 방향, [5] 개인기 크기
 * 방향은 이미 카메라와 무관한 월드 좌표다(Game.buildCommand에서 변환).
 */
export const BUTTONS = ['shoot', 'pass', 'through', 'lob', 'modifier', 'finesse', 'contain', 'tackle', 'skill'] as const;
type ButtonKey = (typeof BUTTONS)[number];
const SPRINT_BIT = 1 << 15;
export const COMMAND_BYTES = 6;

function packVec(v: THREE.Vector3 | undefined, out: Uint8Array, at: number): void {
  const m = v ? Math.min(1, Math.hypot(v.x, v.z)) : 0;
  const a = m > 0.004 ? Math.atan2(v!.z, v!.x) : 0;
  out[at] = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 256) & 255;
  out[at + 1] = Math.round(m * 255);
}

function unpackVec(buf: Uint8Array, at: number, out: THREE.Vector3): THREE.Vector3 {
  const m = buf[at + 1] / 255, a = buf[at] / 256 * Math.PI * 2;
  return out.set(Math.cos(a) * m, 0, Math.sin(a) * m);
}

export function encodeCommand(cmd: UserCommand, out = new Uint8Array(COMMAND_BYTES)): Uint8Array {
  let bits = cmd.sprint ? SPRINT_BIT : 0;
  BUTTONS.forEach((k, i) => { if ((cmd[k as keyof UserCommand] as ButtonState | undefined)?.held) bits |= 1 << i; });
  out[0] = bits & 255;
  out[1] = bits >> 8;
  packVec(cmd.move, out, 2);
  packVec(cmd.skillMove, out, 4);
  return out;
}

/** 받는 쪽: 직전 틱 비트를 기억해 눌림·뗌 순간을 만든다 */
export class CommandDecoder {
  private last = 0;

  decode(buf: Uint8Array): UserCommand {
    const bits = buf[0] | (buf[1] << 8);
    const button = (i: number): ButtonState => {
      const now = !!(bits & (1 << i)), before = !!(this.last & (1 << i));
      return { held: now, pressed: now && !before, released: !now && before };
    };
    const cmd = { move: unpackVec(buf, 2, new THREE.Vector3()), sprint: !!(bits & SPRINT_BIT), skillMove: unpackVec(buf, 4, new THREE.Vector3()) } as UserCommand;
    BUTTONS.forEach((k: ButtonKey, i) => { (cmd as unknown as Record<string, ButtonState>)[k] = button(i); });
    this.last = bits;
    return cmd;
  }
}
