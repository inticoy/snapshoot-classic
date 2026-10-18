/**
 * SnapShoot Classic 중계 서버 (Cloudflare Workers + Durable Objects)
 *
 *  POST /rooms            → { code }        방 만들기 (6자리 코드)
 *  GET  /rooms/:code/ws   → WebSocket       방 입장 (먼저 들어온 쪽이 팀 0)
 *  GET  /match/ws         → WebSocket       빠른 매칭 대기열 (둘이 모이면 같은 방 코드를 보낸다)
 *
 * 방(MatchRoom, 경기마다 Durable Object 하나):
 *  - 두 사람이 모이면 각자 잰 왕복 시간으로 입력 지연을 정하고 같은 시드로 시작 신호를 보낸다
 *  - 틱별 입력(바이너리)을 상대에게 바로 전달하고 기록한다 (재접속 시 처음부터 다시 보낸다)
 *  - 상태 해시를 비교해 어긋나면 양쪽에 알린다
 * 서버는 경기를 계산하지 않는다 — 계산은 두 클라이언트가 같은 입력으로 똑같이 한다.
 */
export interface Env {
  ROOMS: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
}

const MSG_INPUT = 1, MSG_HASH = 2;
/** 입력 메시지 = 종류 1 + 틱 4 + 명령 6, 해시 = 종류 1 + 틱 4 + 해시 4 */
const INPUT_BYTES = 11, HASH_BYTES = 9;
/** 일시정지: 한 사람당 횟수와 한 번에 멈출 수 있는 시간 */
const PAUSES_PER_TEAM = 3, PAUSE_MS = 60_000;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method === 'POST' && url.pathname === '/rooms') {
      return Response.json({ code: roomCode() }, { headers: CORS });
    }
    if (url.pathname === '/match/ws' && req.headers.get('Upgrade') === 'websocket') {
      return env.LOBBY.get(env.LOBBY.idFromName('global')).fetch(req);
    }
    const m = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})\/ws$/);
    if (m && req.headers.get('Upgrade') === 'websocket') {
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    }
    return new Response('not found', { status: 404, headers: CORS });
  },
};

/** 각 사람의 설정 (보정 수준·경기 시간 등). 경기 규칙은 방장(팀 0) 것을 양쪽에 쓴다 */
type Prefs = Record<string, unknown>;
function roomCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
}

/**
 * 빠른 매칭 대기열 (전역 Durable Object 하나). 먼저 온 사람을 기다리게 두었다가 다음 사람이 오면
 * 새 방 코드를 둘에게 보낸다. 기다리던 사람이 나가면(취소) 대기열에서 빠진다.
 */
export class Lobby {
  private waiting: WebSocket | null = null;

  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const other = this.waiting;
    if (other && other.readyState === WebSocket.READY_STATE_OPEN) {
      this.waiting = null;
      const code = roomCode();
      for (const ws of [other, server]) {
        ws.send(JSON.stringify({ type: 'matched', code }));
        ws.close(1000, 'matched');
      }
    } else {
      this.waiting = server;
      server.send(JSON.stringify({ type: 'searching' }));
      server.addEventListener('close', () => { if (this.waiting === server) this.waiting = null; });
    }
    return new Response(null, { status: 101, webSocket: client });
  }
}

interface Seat { ws: WebSocket; rtt: number | null; prefs: Prefs | null }
function secret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class MatchRoom {
  private readonly seats: (Seat | null)[] = [null, null];
  private started: { seed: number; delay: number; prefs: [Prefs, Prefs] } | null = null;
  /** 팀별 입력 메시지 기록 (재접속 때 다시 보낸다) */
  private readonly log: [Uint8Array[], Uint8Array[]] = [[], []];
  private readonly hashes = new Map<number, [number | null, number | null]>();
  /** 자리 주인 확인용 비밀값 (재접속 때 같은 사람인지 본다) */
  private readonly tokens: [string | null, string | null] = [null, null];
  /** 팀별 마지막으로 받은 입력 틱 (중복·되감기 입력은 버린다) */
  private readonly lastInput = [-1, -1];
  /** 이 틱까지는 해시 비교가 끝났다 (재접속 쪽이 다시 보내는 옛 해시는 무시) */
  private hashedUpTo = -1;
  private readonly pausesLeft = [PAUSES_PER_TEAM, PAUSES_PER_TEAM];
  private pause: { team: 0 | 1; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private readonly state: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    // 다시 들어오는 사람은 원래 자리(팀)로. 비밀값이 맞으면 아직 안 닫힌 옛 연결도 밀어낸다
    const params = new URL(req.url).searchParams;
    const want = Number(params.get('team')), token = params.get('token');
    const owner = (want === 0 || want === 1) && token !== null && this.tokens[want] === token;
    // 시작한 경기의 빈자리는 비밀값을 가진 원래 주인만 들어올 수 있다 (방 코드만으로 자리를 빼앗지 못하게)
    const free = (t: 0 | 1) => this.seats[t] === null && (!this.started || this.tokens[t] === null);
    const pick = owner ? want : (want === 0 || want === 1) && free(want) ? want : free(0) ? 0 : free(1) ? 1 : -1;
    if (pick < 0) return new Response('room full', { status: 409 });
    const team = pick as 0 | 1;
    const old = this.seats[team];
    if (old) { this.seats[team] = null; try { old.ws.close(4000, 'replaced'); } catch { /* 이미 닫힘 */ } }
    if (!owner) this.tokens[team] = secret();
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    // 바이너리는 ArrayBuffer로 받는다 (기본 Blob이면 읽기 전에 비동기 변환이 필요하다)
    (server as unknown as { binaryType: string }).binaryType = 'arraybuffer';
    const seat: Seat = { ws: server, rtt: null, prefs: null };
    this.seats[team] = seat;
    server.send(JSON.stringify({ type: 'joined', team, token: this.tokens[team], waiting: this.seats[1 - team] === null }));
    // 재접속: 이미 시작한 경기면 시작 정보와 지금까지의 입력을 다시 보낸다
    if (this.started) {
      this.other(team as 0 | 1)?.ws.send(JSON.stringify({ type: 'opponentBack' }));
      server.send(JSON.stringify({ type: 'start', team, ...this.started, resume: true }));
      for (const t of [0, 1] as const) for (const msg of this.log[t]) server.send(this.tagged(t, msg));
      // 기록을 다 보냈다는 표시: 이 전에는 새 입력을 예약하지 않는다
      server.send(JSON.stringify({ type: 'resumeEnd' }));
      if (this.pause) server.send(JSON.stringify({ type: 'paused', team: this.pause.team, left: this.pausesLeft }));
    }
    // Blob으로 오는 런타임도 있어 순서를 지키며 변환한다
    let chain = Promise.resolve();
    server.addEventListener('message', (ev) => {
      const data = ev.data as unknown;
      if (typeof data === 'string' || data instanceof ArrayBuffer) this.onMessage(team as 0 | 1, data);
      else chain = chain.then(async () => this.onMessage(team as 0 | 1, await (data as Blob).arrayBuffer()));
    });
    server.addEventListener('close', () => {
      // 새 연결로 바뀐 옛 소켓이 닫힌 거면 상대에게 알리지 않는다
      if (this.seats[team] !== seat) return;
      this.seats[team] = null;
      this.other(team as 0 | 1)?.ws.send(JSON.stringify({ type: 'opponentLeft' }));
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  private other(team: 0 | 1): Seat | null {
    return this.seats[1 - team];
  }

  /** 받는 쪽이 누구 입력인지 알도록 앞에 팀 바이트를 붙인다 */
  private tagged(team: 0 | 1, msg: Uint8Array): Uint8Array {
    const out = new Uint8Array(msg.length + 1);
    out[0] = team;
    out.set(msg, 1);
    return out;
  }

  private onMessage(team: 0 | 1, data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      let msg: { type: string; t?: number; rtt?: number; prefs?: Prefs; away?: boolean };
      try { msg = JSON.parse(data); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'pause') this.startPause(team);
      if (msg.type === 'resume' && this.pause?.team === team) this.endPause();
      // 탭을 벗어남/돌아옴 같은 상태는 상대에게 그대로 알린다
      if (msg.type === 'away') this.other(team)?.ws.send(JSON.stringify({ type: 'opponentAway', away: !!msg.away }));
      if (msg.type === 'ping') this.seats[team]?.ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
      if (msg.type === 'ready' && typeof msg.rtt === 'number' && isFinite(msg.rtt)) {
        // 터무니없는 왕복 시간으로 입력 지연을 키워 경기를 멈추지 못하게
        msg.rtt = Math.min(400, Math.max(0, msg.rtt));
        this.seats[team]!.rtt = msg.rtt;
        this.seats[team]!.prefs = msg.prefs ?? {};
        this.maybeStart();
      }
      return;
    }
    const bytes = new Uint8Array(data);
    if (bytes.length < 5) return;
    const tick = new DataView(bytes.buffer, bytes.byteOffset).getUint32(1);
    if (bytes[0] === MSG_INPUT) {
      // 틱은 1씩 늘어야 한다 (재접속 직후 겹친 입력·조작된 틱은 버린다)
      if (bytes.length !== INPUT_BYTES || !this.started || tick <= this.lastInput[team] || tick > this.lastInput[team] + 1200) return;
      this.lastInput[team] = tick;
      this.log[team].push(bytes);
      this.other(team)?.ws.send(this.tagged(team, bytes));
    } else if (bytes[0] === MSG_HASH) {
      if (bytes.length !== HASH_BYTES || tick <= this.hashedUpTo) return;
      const h = new DataView(bytes.buffer, bytes.byteOffset).getUint32(5);
      const pair = this.hashes.get(tick) ?? [null, null];
      pair[team] = h;
      if (pair[0] !== null && pair[1] !== null) {
        this.hashes.delete(tick);
        this.hashedUpTo = Math.max(this.hashedUpTo, tick);
        if (pair[0] !== pair[1]) for (const s of this.seats) s?.ws.send(JSON.stringify({ type: 'desync', tick }));
      } else this.hashes.set(tick, pair);
      this.other(team)?.ws.send(this.tagged(team, bytes));
    }
  }

  /** 한 사람이 멈추면 둘 다 멈춘다. 횟수·시간 제한이 있고, 시간이 지나면 저절로 재개 */
  private startPause(team: 0 | 1): void {
    if (!this.started || this.pause || this.pausesLeft[team] <= 0) return;
    this.pausesLeft[team]--;
    this.pause = { team, timer: setTimeout(() => this.endPause(), PAUSE_MS) };
    this.broadcast({ type: 'paused', team, left: this.pausesLeft, ms: PAUSE_MS });
  }

  private endPause(): void {
    if (!this.pause) return;
    clearTimeout(this.pause.timer);
    this.pause = null;
    this.broadcast({ type: 'resumed' });
  }

  private broadcast(msg: object): void {
    for (const s of this.seats) s?.ws.send(JSON.stringify(msg));
  }

  private maybeStart(): void {
    const [a, b] = this.seats;
    if (this.started || !a || !b || a.rtt === null || b.rtt === null) return;
    // 입력 지연: 두 사람의 서버 왕복을 더한 것이 상대 입력이 도착하는 시간 (120Hz 틱)
    const rttTicks = Math.ceil(((a.rtt + b.rtt) / 1000) * 120);
    const delay = Math.max(4, Math.ceil(rttTicks / 2) + 2);
    this.started = { seed: (Math.random() * 2 ** 31) | 0, delay, prefs: [a.prefs ?? {}, b.prefs ?? {}] };
    for (const t of [0, 1] as const) this.seats[t]!.ws.send(JSON.stringify({ type: 'start', team: t, ...this.started }));
  }
}
