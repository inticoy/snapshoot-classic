/**
 * SnapShoot Classic 중계 서버 (Cloudflare Workers + Durable Objects)
 *
 *  POST /rooms            → { code }        방 만들기 (6자리 코드)
 *  GET  /rooms/:code/ws   → WebSocket       방 입장 (먼저 들어온 쪽이 팀 0)
 *
 * 방(MatchRoom, 경기마다 Durable Object 하나):
 *  - 두 사람이 모이면 각자 잰 왕복 시간으로 입력 지연을 정하고 같은 시드로 시작 신호를 보낸다
 *  - 틱별 입력(바이너리)을 상대에게 바로 전달하고 기록한다 (재접속 시 처음부터 다시 보낸다)
 *  - 상태 해시를 비교해 어긋나면 양쪽에 알린다
 * 서버는 경기를 계산하지 않는다 — 계산은 두 클라이언트가 같은 입력으로 똑같이 한다.
 */
export interface Env {
  ROOMS: DurableObjectNamespace;
}

const MSG_INPUT = 1, MSG_HASH = 2;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method === 'POST' && url.pathname === '/rooms') {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
      return Response.json({ code }, { headers: CORS });
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
interface Seat { ws: WebSocket; rtt: number | null; prefs: Prefs | null }

export class MatchRoom {
  private readonly seats: (Seat | null)[] = [null, null];
  private started: { seed: number; delay: number; prefs: [Prefs, Prefs] } | null = null;
  /** 팀별 입력 메시지 기록 (재접속 때 다시 보낸다) */
  private readonly log: [Uint8Array[], Uint8Array[]] = [[], []];
  private readonly hashes = new Map<number, [number | null, number | null]>();

  constructor(private readonly state: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    const team = this.seats[0] === null ? 0 : this.seats[1] === null ? 1 : -1;
    if (team < 0) return new Response('room full', { status: 409 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    // 바이너리는 ArrayBuffer로 받는다 (기본 Blob이면 읽기 전에 비동기 변환이 필요하다)
    (server as unknown as { binaryType: string }).binaryType = 'arraybuffer';
    const seat: Seat = { ws: server, rtt: null, prefs: null };
    this.seats[team] = seat;
    server.send(JSON.stringify({ type: 'joined', team, waiting: this.seats[1 - team] === null }));
    // 재접속: 이미 시작한 경기면 시작 정보와 지금까지의 입력을 다시 보낸다
    if (this.started) {
      this.other(team as 0 | 1)?.ws.send(JSON.stringify({ type: 'opponentBack' }));
      server.send(JSON.stringify({ type: 'start', team, ...this.started, resume: true }));
      for (const t of [0, 1] as const) for (const msg of this.log[t]) server.send(this.tagged(t, msg));
    }
    // Blob으로 오는 런타임도 있어 순서를 지키며 변환한다
    let chain = Promise.resolve();
    server.addEventListener('message', (ev) => {
      const data = ev.data as unknown;
      if (typeof data === 'string' || data instanceof ArrayBuffer) this.onMessage(team as 0 | 1, data);
      else chain = chain.then(async () => this.onMessage(team as 0 | 1, await (data as Blob).arrayBuffer()));
    });
    server.addEventListener('close', () => {
      if (this.seats[team] === seat) this.seats[team] = null;
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
      const msg = JSON.parse(data) as { type: string; t?: number; rtt?: number; prefs?: Prefs; away?: boolean };
      // 탭을 벗어남/돌아옴 같은 상태는 상대에게 그대로 알린다
      if (msg.type === 'away') this.other(team)?.ws.send(JSON.stringify({ type: 'opponentAway', away: !!msg.away }));
      if (msg.type === 'ping') this.seats[team]?.ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
      if (msg.type === 'ready' && typeof msg.rtt === 'number') {
        this.seats[team]!.rtt = msg.rtt;
        this.seats[team]!.prefs = msg.prefs ?? {};
        this.maybeStart();
      }
      return;
    }
    const bytes = new Uint8Array(data);
    if (bytes[0] === MSG_INPUT) {
      this.log[team].push(bytes);
      this.other(team)?.ws.send(this.tagged(team, bytes));
    } else if (bytes[0] === MSG_HASH) {
      const v = new DataView(bytes.buffer, bytes.byteOffset);
      const tick = v.getUint32(1), h = v.getUint32(5);
      const pair = this.hashes.get(tick) ?? [null, null];
      pair[team] = h;
      if (pair[0] !== null && pair[1] !== null) {
        this.hashes.delete(tick);
        if (pair[0] !== pair[1]) for (const s of this.seats) s?.ws.send(JSON.stringify({ type: 'desync', tick }));
      } else this.hashes.set(tick, pair);
      this.other(team)?.ws.send(this.tagged(team, bytes));
    }
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
