import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// 브라우저용 tsc에 Workers 전역 타입이 섞이지 않도록 서버 모듈은 실행 시 불러온다
const serverModule = '../server/src/index';
const { Lobby, MatchRoom } = await import(serverModule);
type MatchRoom = { fetch(req: Request): Promise<Response>; alarm(): Promise<void> };

class Socket {
  static READY_STATE_OPEN = 1;
  readyState = 1;
  sent: (string | Uint8Array)[] = [];
  listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  accept() {}
  send(data: string | Uint8Array) { this.sent.push(data); }
  close() { this.readyState = 3; this.emit('close'); }
  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }
  emit(type: string, data?: unknown) { for (const listener of this.listeners.get(type) ?? []) listener({ data }); }
  messages() { return this.sent.filter((s): s is string => typeof s === 'string').map((s) => JSON.parse(s)); }
}

class Storage {
  values = new Map<string, unknown>();
  alarm: number | null = null;
  puts = 0;
  async get<T>(key: string): Promise<T | undefined> { return structuredClone(this.values.get(key)) as T; }
  async put(key: string, value: unknown) { this.puts++; this.values.set(key, structuredClone(value)); }
  async setAlarm(time: number) { this.alarm = time; }
  async deleteAlarm() { this.alarm = null; }
  async deleteAll() { this.values.clear(); }
  async transaction<T>(callback: (storage: Storage) => Promise<T>) { return callback(this); }
}

class State {
  pending: Promise<unknown>[] = [];
  private gate = Promise.resolve<unknown>(undefined);
  constructor(readonly storage = new Storage()) {}
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const result = this.gate.then(callback);
    this.gate = result;
    this.pending.push(result);
    return result;
  }
  waitUntil(promise: Promise<unknown>) { this.pending.push(promise); }
  async drain() {
    while (this.pending.length) await Promise.all(this.pending.splice(0));
  }
}

let pairs: Socket[][];
beforeEach(() => {
  vi.useFakeTimers();
  pairs = [];
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('WebSocketPair', class {
    0 = new Socket();
    1 = new Socket();
    constructor() { pairs.push([this[0], this[1]]); }
  });
  vi.stubGlobal('Response', class {
    status: number;
    constructor(_body: unknown, init: { status: number }) { this.status = init.status; }
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function create(storage = new Storage()) {
  const state = new State(storage);
  const room = new MatchRoom(state);
  await state.drain();
  return { room, state, storage };
}
async function join(room: MatchRoom, query = '') {
  const response = await room.fetch(new Request(`https://relay/rooms/ABCDEF/ws${query}`));
  expect(response.status).toBe(101);
  return pairs.at(-1)![1];
}
function packet(tick: number, kind = 1, hash = 0): ArrayBuffer {
  const bytes = new Uint8Array(kind === 1 ? 11 : 9);
  bytes[0] = kind;
  const view = new DataView(bytes.buffer);
  view.setUint32(1, tick);
  if (kind === 2) view.setUint32(5, hash);
  return bytes.buffer;
}
async function start() {
  const context = await create();
  const a = await join(context.room), b = await join(context.room);
  a.emit('message', JSON.stringify({ type: 'ready', rtt: 20, prefs: { duration: 5 } }));
  b.emit('message', JSON.stringify({ type: 'ready', rtt: 30, prefs: { assistance: 1 } }));
  await context.state.drain();
  return { ...context, a, b };
}

describe('MatchRoom durable state', () => {
  it('restores seat ownership and ready settings before the match starts', async () => {
    const { room, state, storage } = await create();
    const a = await join(room);
    const token = a.messages()[0].token;
    a.emit('message', JSON.stringify({ type: 'ready', rtt: 20, prefs: { duration: 5 } }));
    await state.drain();
    const restored = await create(storage);
    // 시작 전 빈자리는 누구나 들어올 수 있으므로, 원래 주인이 먼저 돌아오면 자리·설정을 그대로 잇는다
    await join(restored.room, `?team=0&token=${token}`);
    const b = await join(restored.room);
    expect(b.messages()[0].team).toBe(1);
    b.emit('message', JSON.stringify({ type: 'ready', rtt: 30 }));
    await restored.state.drain();
    expect(b.messages().find((m) => m.type === 'start').prefs[0]).toEqual({ duration: 5 });
  });

  it('batches input writes, restores chunked catch-up and rejects duplicate ticks', async () => {
    const { room, state, storage, a, b } = await start();
    const token = a.messages()[0].token;
    const originalStart = a.messages().find((m) => m.type === 'start');
    const writes = storage.puts;
    for (let tick = 0; tick < 600; tick++) a.emit('message', packet(tick));
    b.emit('message', packet(0));
    await state.drain();
    expect(storage.puts).toBe(writes);
    await vi.advanceTimersByTimeAsync(1000);
    await room.alarm();
    expect([...storage.values.keys()].filter((key) => key.startsWith('log:'))).toHaveLength(4);
    const restored = await create(storage);
    expect((await restored.room.fetch(new Request('https://relay/rooms/ABCDEF/ws'))).status).toBe(409);
    const rejoined = await join(restored.room, `?team=0&token=${token}`);
    expect(rejoined.messages().find((m) => m.type === 'start')).toMatchObject({ ...originalStart, resume: true });
    const replay = rejoined.sent.filter((m) => m instanceof Uint8Array);
    expect(replay).toHaveLength(601);
    expect(replay[0]).toEqual(new Uint8Array([0, ...new Uint8Array(packet(0))]));
    expect(replay[600][0]).toBe(1);
    expect(rejoined.messages().at(-1).type).toBe('resumeEnd');
    rejoined.emit('message', packet(599));
    rejoined.emit('message', packet(600));
    await restored.state.drain();
    await restored.room.alarm();
    const again = await create(storage);
    const replayed = await join(again.room, `?team=0&token=${token}`);
    expect(replayed.sent.filter((m) => m instanceof Uint8Array)).toHaveLength(602);
  });

  it('flushes pending input on disconnect and ignores messages from replaced sockets', async () => {
    const { room, state, storage, a, b } = await start();
    a.emit('message', packet(0));
    await state.drain();
    const replacement = await join(room, `?team=0&token=${a.messages()[0].token}`);
    a.emit('message', packet(1));
    replacement.emit('message', packet(1));
    await state.drain();
    b.close();
    await state.drain();
    const restored = await create(storage);
    const rejoined = await join(restored.room, `?team=0&token=${a.messages()[0].token}`);
    expect(rejoined.sent.filter((m) => m instanceof Uint8Array)).toHaveLength(2);
  });

  it('restores pending hash comparisons and the comparison watermark', async () => {
    const { room, state, storage, a, b } = await start();
    a.emit('message', packet(10, 2, 100));
    a.emit('message', packet(20, 2, 200));
    b.emit('message', packet(10, 2, 100));
    await state.drain();
    await room.alarm();
    const restored = await create(storage);
    const rejoined = await join(restored.room, `?team=1&token=${b.messages()[0].token}`);
    rejoined.emit('message', packet(10, 2, 999));
    rejoined.emit('message', packet(20, 2, 999));
    await restored.state.drain();
    expect(rejoined.messages().filter((m) => m.type === 'desync')).toEqual([{ type: 'desync', tick: 20 }]);
  });

  it('keeps pause counts and the original pause deadline across restart', async () => {
    const { state, storage, a } = await start();
    a.emit('message', JSON.stringify({ type: 'pause' }));
    await state.drain();
    const deadline = storage.alarm;
    await vi.advanceTimersByTimeAsync(20_000);
    const restored = await create(storage);
    const rejoined = await join(restored.room, `?team=0&token=${a.messages()[0].token}`);
    expect(rejoined.messages().at(-1)).toMatchObject({ type: 'paused', team: 0, left: [2, 3] });
    expect(storage.alarm).toBe(deadline);
    await vi.advanceTimersByTimeAsync(40_000);
    await restored.room.alarm();
    expect(rejoined.messages().at(-1).type).toBe('resumed');
    rejoined.emit('message', JSON.stringify({ type: 'pause' }));
    await restored.state.drain();
    expect(rejoined.messages().at(-1).left).toEqual([1, 3]);
  });

  it('expires an already elapsed pause when restoring', async () => {
    const { state, storage, a } = await start();
    a.emit('message', JSON.stringify({ type: 'pause' }));
    await state.drain();
    await vi.advanceTimersByTimeAsync(61_000);
    const restored = await create(storage);
    const rejoined = await join(restored.room, `?team=0&token=${a.messages()[0].token}`);
    expect(rejoined.messages().some((m) => m.type === 'paused')).toBe(false);
    expect(storage.values.get('room')).toMatchObject({ pause: null, pausesLeft: [2, 3] });
  });

  it('deletes storage after an empty room idles and can reuse the room', async () => {
    const { room, state, storage, a, b } = await start();
    a.close(); b.close();
    await state.drain();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await room.alarm();
    await state.drain();
    expect(storage.values.size).toBe(0);
    expect(storage.alarm).toBeNull();
    expect((await join(room)).messages()[0].team).toBe(0);
  });

  it('discards expired storage even when the idle alarm did not run before restart', async () => {
    const { storage } = await start();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const restored = await create(storage);
    expect(storage.values.size).toBe(0);
    expect((await join(restored.room)).messages()[0].team).toBe(0);
  });
});

describe('Lobby quick match', () => {
  it('drops a closed waiter even without a close event', async () => {
    const lobby = new Lobby();
    await lobby.fetch(new Request('https://relay/match/ws'));
    const dead = pairs.at(-1)![1];
    dead.readyState = 3;
    await lobby.fetch(new Request('https://relay/match/ws'));
    const live = pairs.at(-1)![1];
    expect(live.messages()).toEqual([{ type: 'searching' }]);
    await lobby.fetch(new Request('https://relay/match/ws'));
    expect(live.messages().at(-1).type).toBe('matched');
    expect(dead.messages()).toEqual([{ type: 'searching' }]);
  });

  it.each(['close', 'error'])('removes the waiter on %s without clearing a later waiter', async (event) => {
    const lobby = new Lobby();
    await lobby.fetch(new Request('https://relay/match/ws'));
    const old = pairs.at(-1)![1];
    old.emit(event);
    await lobby.fetch(new Request('https://relay/match/ws'));
    const live = pairs.at(-1)![1];
    old.emit(event);
    await lobby.fetch(new Request('https://relay/match/ws'));
    expect(live.messages().at(-1).type).toBe('matched');
  });
});
