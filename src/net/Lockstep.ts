import { PHYSICS } from '../config';
import type { Match, UserCommand } from '../gameplay/Match';
import { CommandDecoder, COMMAND_BYTES, encodeCommand } from './CommandCodec';
import { stateHash } from './Replay';

/**
 * 입력 지연 락스텝 (1:1).
 *  - 내 입력은 지금 틱 + delay 틱에 적용하도록 예약해 상대에게 보낸다 (그 사이 왕복 시간을 숨긴다)
 *  - 두 팀 입력이 모두 있는 틱만 계산한다. 상대 입력이 늦으면 그 틱에서 기다린다 (화면은 멈춤)
 *  - 1초마다 상태 해시를 보내 어긋남을 찾는다
 * 전송(WebSocket 등)은 send/receive 콜백으로 바깥에서 붙인다.
 */
export const MSG = { input: 1, hash: 2 } as const;

export interface LockstepTransport {
  send(data: Uint8Array): void;
}

export class Lockstep {
  /** 다음에 계산할 틱 */
  tick = 0;
  /** 내 입력을 마지막으로 예약한 틱 */
  private scheduled: number;
  private readonly frames = new Map<number, [Uint8Array | null, Uint8Array | null]>();
  private readonly decoders = [new CommandDecoder(), new CommandDecoder()] as const;
  private readonly remoteHashes = new Map<number, number>();
  private readonly localHashes = new Map<number, number>();
  /** 어긋남이 처음 발견된 틱 (없으면 null) */
  desyncAt: number | null = null;
  /** 상대 입력을 기다리느라 멈춘 스텝 수 (진단용) */
  stalls = 0;
  readonly hashEvery = Math.round(1 / PHYSICS.step);

  /** 왕복 시간(틱)에 맞는 입력 지연: 편도 + 여유 2틱, 최소 4 (120Hz에서 33ms) */
  static delayFor(rttTicks: number): number {
    return Math.max(4, Math.ceil(rttTicks / 2) + 2);
  }

  constructor(readonly match: Match, readonly team: 0 | 1, private readonly net: LockstepTransport, readonly delay = 6) {
    // 처음 delay 틱은 양쪽 모두 입력 없음으로 시작한다
    const idle = new Uint8Array(COMMAND_BYTES);
    for (let t = 0; t < delay; t++) this.frames.set(t, [idle, idle]);
    this.scheduled = delay - 1;
  }

  /** 이번 스텝의 내 명령을 예약해 보낸다 (스텝마다 한 번) */
  pushLocal(cmd: UserCommand): void {
    const t = ++this.scheduled;
    const bytes = encodeCommand(cmd);
    this.put(t, this.team, bytes);
    const msg = new Uint8Array(1 + 4 + COMMAND_BYTES);
    msg[0] = MSG.input;
    new DataView(msg.buffer).setUint32(1, t);
    msg.set(bytes, 5);
    this.net.send(msg);
  }

  /** 상대(또는 서버)에서 온 메시지 */
  receive(data: Uint8Array, fromTeam: 0 | 1): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const t = view.getUint32(1);
    if (data[0] === MSG.input) this.put(t, fromTeam, data.slice(5, 5 + COMMAND_BYTES));
    else if (data[0] === MSG.hash) {
      this.remoteHashes.set(t, view.getUint32(5));
      this.checkHash(t);
    }
  }

  private put(t: number, team: 0 | 1, bytes: Uint8Array): void {
    const f = this.frames.get(t) ?? [null, null];
    f[team] = bytes;
    this.frames.set(t, f);
  }

  /** 이번 틱을 계산할 수 있는가 (두 팀 입력이 다 왔는가) */
  get ready(): boolean {
    const f = this.frames.get(this.tick);
    return !!f && !!f[0] && !!f[1];
  }

  /** 한 틱 진행. 입력이 아직 없으면 false (기다린다) */
  step(): boolean {
    if (!this.ready) {
      this.stalls++;
      return false;
    }
    const f = this.frames.get(this.tick)!;
    this.frames.delete(this.tick);
    this.match.update(PHYSICS.step, [this.decoders[0].decode(f[0]!), this.decoders[1].decode(f[1]!)]);
    this.tick++;
    if (this.tick % this.hashEvery === 0) {
      const h = stateHash(this.match);
      this.localHashes.set(this.tick, h);
      const msg = new Uint8Array(9);
      msg[0] = MSG.hash;
      const v = new DataView(msg.buffer);
      v.setUint32(1, this.tick);
      v.setUint32(5, h);
      this.net.send(msg);
      this.checkHash(this.tick);
    }
    return true;
  }

  private checkHash(t: number): void {
    const a = this.localHashes.get(t), b = this.remoteHashes.get(t);
    if (a === undefined || b === undefined) return;
    if (a !== b && this.desyncAt === null) this.desyncAt = t;
    this.localHashes.delete(t);
    this.remoteHashes.delete(t);
  }
}
