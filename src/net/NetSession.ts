/**
 * 중계 서버 접속 (WebSocket). 방에 들어가 왕복 시간을 재고, 시작 신호(시드·팀·입력 지연)를 기다린다.
 * 시작 뒤에는 Lockstep이 이 세션으로 입력·해시를 주고받는다.
 */
/** 각 사람이 보내는 설정. 보정은 자기 팀에만, 나머지(경기 시간·승부차기·물리)는 방장(팀 0) 것을 양쪽에 쓴다 */
export interface OnlinePrefs { pass: string; shot: string; move: string; duration: number; shootout: boolean; physics: string }
export interface StartInfo { team: 0 | 1; seed: number; delay: number; prefs: [OnlinePrefs, OnlinePrefs]; resume?: boolean }

export class NetSession {
  private ws!: WebSocket;
  /** 상대 입력·해시 (첫 바이트 = 보낸 팀) */
  /** null이면 처리기가 붙을 때까지 모아 둔다 (시작 신호와 Lockstep 생성 사이에 온 입력을 잃지 않게) */
  onData: ((team: 0 | 1, data: Uint8Array) => void) | null = null;
  onDesync: (tick: number) => void = () => {};
  onOpponentLeft: () => void = () => {};
  onOpponentBack: () => void = () => {};
  onOpponentAway: (away: boolean) => void = () => {};
  private early: Uint8Array[] = [];

  constructor(readonly relay: string, readonly code: string) {}

  /** 방 만들기 → 코드 */
  static async createRoom(relay: string): Promise<string> {
    const res = await fetch(new URL('/rooms', relay), { method: 'POST' });
    return ((await res.json()) as { code: string }).code;
  }

  /** 접속 → 왕복 시간 측정 → 시작 정보 */
  connect(prefs: OnlinePrefs, onStatus: (text: string) => void = () => {}): Promise<StartInfo> {
    const url = new URL(`/rooms/${this.code}/ws`, this.relay);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    return new Promise((resolve, reject) => {
      const rtts: number[] = [];
      const ping = () => this.ws.send(JSON.stringify({ type: 'ping', t: performance.now() }));
      this.ws.onopen = () => ping();
      this.ws.onerror = () => reject(new Error('relay connection failed'));
      this.ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') {
          const bytes = new Uint8Array(ev.data as ArrayBuffer);
          // 처리기(Lockstep)가 붙기 전에 온 입력·재접속 기록은 모아 두었다가 넘긴다
          if (!this.onData) this.early.push(bytes);
          else this.onData(bytes[0] as 0 | 1, bytes.subarray(1));
          return;
        }
        const msg = JSON.parse(ev.data) as { type: string; t?: number; waiting?: boolean; tick?: number; away?: boolean } & Partial<StartInfo>;
        if (msg.type === 'joined') onStatus(msg.waiting ? `상대를 기다리는 중 · 방 코드 ${this.code}` : '상대 접속 · 연결 확인 중');
        if (msg.type === 'pong') {
          rtts.push(performance.now() - msg.t!);
          if (rtts.length < 5) ping();
          else this.ws.send(JSON.stringify({ type: 'ready', rtt: rtts.sort((a, b) => a - b)[2], prefs }));
        }
        if (msg.type === 'start') {
          resolve({ team: msg.team!, seed: msg.seed!, delay: msg.delay!, prefs: msg.prefs!, resume: msg.resume });
        }
        if (msg.type === 'desync') this.onDesync(msg.tick!);
        if (msg.type === 'opponentLeft') this.onOpponentLeft();
        if (msg.type === 'opponentBack') this.onOpponentBack();
        if (msg.type === 'opponentAway') this.onOpponentAway(!!msg.away);
      };
    });
  }

  /** Lockstep이 붙은 뒤: 시작 전에 받아 둔 메시지를 넘긴다 */
  flushEarly(): void {
    for (const b of this.early) this.onData?.(b[0] as 0 | 1, b.subarray(1));
    this.early = [];
  }

  /** 탭을 벗어남/돌아옴 (상대 화면에 알림) */
  setAway(away: boolean): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'away', away }));
  }

  send(data: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }
}
