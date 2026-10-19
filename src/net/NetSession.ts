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
  /** 내 연결이 끊김 (경기 시작 뒤) */
  onClosed: () => void = () => {};
  /** 일시정지: 멈춘 팀, 팀별 남은 횟수, 제한 시간(ms). null이면 재개 */
  onPause: (pause: { team: 0 | 1; left: number[]; ms: number } | null) => void = () => {};
  /** 재접속: 서버가 지난 입력 기록을 다 보낼 때까지 true (그 전에는 새 입력을 예약하지 않는다) */
  resuming = false;
  /** 최근 왕복 시간(ms), 경기 중에도 주기적으로 잰다 */
  rtt: number | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private early: Uint8Array[] = [];

  constructor(readonly relay: string, readonly code: string) {}

  /** 빠른 매칭: 대기열에 들어가 상대가 생기면 방 코드를 받는다 (창을 닫거나 취소하면 대기열에서 빠진다) */
  static quickMatch(relay: string): Promise<string> {
    const url = new URL('/match/ws', relay);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      ws.onerror = () => reject(new Error('matchmaking failed'));
      // 서버가 매칭 없이 닫으면 무한 대기하지 않고 실패로 (매칭됐으면 이미 resolve라 무시된다)
      ws.onclose = () => reject(new Error('matchmaking closed'));
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as { type: string; code?: string };
        if (msg.type === 'matched') resolve(msg.code!);
      };
    });
  }

  /** 방 만들기 → 코드 */
  static async createRoom(relay: string): Promise<string> {
    const res = await fetch(new URL('/rooms', relay), { method: 'POST' });
    return ((await res.json()) as { code: string }).code;
  }

  /** 접속 → 왕복 시간 측정 → 시작 정보 */
  connect(prefs: OnlinePrefs, onStatus: (text: string) => void = () => {}): Promise<StartInfo> {
    const url = new URL(`/rooms/${this.code}/ws`, this.relay);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    // 같은 방에 다시 들어오면 원래 팀 자리로 (새로고침·재접속·동기화 복구)
    // 자리·비밀값은 탭마다 따로 (같은 브라우저의 다른 탭이 남의 자리를 이어받아 서로 밀어내지 않게). 새로고침해도 남는다
    const seat = (() => { try { return sessionStorage.getItem(`snapshoot-room:${this.code}`); } catch { return null; } })();
    if (seat === '0' || seat === '1') url.searchParams.set('team', seat);
    const token = (() => { try { return sessionStorage.getItem(`snapshoot-token:${this.code}`); } catch { return null; } })();
    if (token) url.searchParams.set('token', token);
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    return new Promise((resolve, reject) => {
      const rtts: number[] = [];
      const ping = () => this.ws.send(JSON.stringify({ type: 'ping', t: performance.now() }));
      this.ws.onopen = () => ping();
      let started = false;
      this.ws.onerror = () => reject(new Error('relay connection failed'));
      this.ws.onclose = () => {
        if (this.pinger) clearInterval(this.pinger);
        if (started) this.onClosed();
        else reject(new Error('relay connection closed'));
      };
      this.ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') {
          const bytes = new Uint8Array(ev.data as ArrayBuffer);
          // 처리기(Lockstep)가 붙기 전에 온 입력·재접속 기록은 모아 두었다가 넘긴다
          if (!this.onData) this.early.push(bytes);
          else this.onData(bytes[0] as 0 | 1, bytes.subarray(1));
          return;
        }
        let msg: { type: string; t?: number; waiting?: boolean; tick?: number; away?: boolean; token?: string; left?: number[]; ms?: number } & Partial<StartInfo>;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'joined' && msg.token) {
          try { sessionStorage.setItem(`snapshoot-token:${this.code}`, msg.token); } catch { /* 저장 못 해도 진행 */ }
        }
        if (msg.type === 'joined') onStatus(msg.waiting ? `상대를 기다리는 중 · 방 코드 ${this.code}` : '상대 접속 · 연결 확인 중');
        if (msg.type === 'pong') {
          this.rtt = performance.now() - msg.t!;
          if (started) return;
          rtts.push(this.rtt);
          if (rtts.length < 5) ping();
          else this.ws.send(JSON.stringify({ type: 'ready', rtt: rtts.sort((a, b) => a - b)[2], prefs }));
        }
        if (msg.type === 'start') {
          try { sessionStorage.setItem(`snapshoot-room:${this.code}`, String(msg.team)); } catch { /* 저장 못 해도 진행 */ }
          started = true;
          this.resuming = !!msg.resume;
          // 경기 중 핑 표시용: 2초마다 왕복 시간을 다시 잰다
          this.pinger = setInterval(() => { if (this.ws.readyState === WebSocket.OPEN) ping(); }, 2000);
          resolve({ team: msg.team!, seed: msg.seed!, delay: msg.delay!, prefs: msg.prefs!, resume: msg.resume });
        }
        if (msg.type === 'resumeEnd') this.resuming = false;
        if (msg.type === 'paused') this.onPause({ team: msg.team!, left: msg.left ?? [], ms: msg.ms ?? 0 });
        if (msg.type === 'resumed') this.onPause(null);
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

  /** 일시정지 요청 / 내가 건 일시정지 풀기 (서버가 횟수·시간을 판단해 둘 다에게 알린다) */
  requestPause(on: boolean): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: on ? 'pause' : 'resume' }));
  }

  close(): void {
    if (this.pinger) clearInterval(this.pinger);
    this.onClosed = () => {};
    this.ws?.close();
  }

  send(data: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }
}
