import * as THREE from 'three';
import { GRAPHICS, PHYSICS, PITCH } from '../config';
import { Input } from './Input';
import { TouchControls } from '../ui/TouchControls';
import type { TouchMode } from './TouchInput';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Stadium } from '../environment/Stadium';
import { SKILLS } from '../gameplay/Skills';
import { Lockstep } from '../net/Lockstep';
import type { NetSession, StartInfo } from '../net/NetSession';
import { IDLE_COMMAND, Match, type TeamAssist, type UserCommand } from '../gameplay/Match';
import { CAMERA_LABEL, CameraRig } from '../camera/CameraRig';
import { Hud } from '../ui/Hud';
import { Menu, assistPanel, controlsPanel, matchupPanel, playerDetailPanel, squadPanel, statsPanel, type MenuScreen } from '../ui/Menu';
import { ASSIST_LABEL, MOVE_ASSIST_LABEL, GRAPHICS_LABEL, cycleAssist, cycleMoveAssist, cycleGraphics, graphicsQuality, settings, togglePhysicsPreset, toggleShootout } from './Settings';
import { PRESET_LABEL, activePhysics, setActivePhysics } from '../physics/presets';
import { Sound } from '../audio/Sound';
import { categoryVolume, decideTouchSound } from '../audio/Mix';
import { TEAMS } from '../data/Teams';
import { RESTART_LABEL } from '../gameplay/SetPieces';
import { Random, visualRandom } from './Random';
import type { Playground } from '../playground/Playground';

type AppState = 'menu' | 'playing' | 'paused' | 'result';

const DURATIONS = [120, 240, 360, 480];
const MENU_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace'];

const handL = new THREE.Vector3(), handR = new THREE.Vector3();

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly input = new Input();
  private readonly physics = new PhysicsWorld();
  private readonly stadium: Stadium;
  private readonly match: Match;
  private readonly rig: CameraRig;
  private readonly hud = new Hud();
  private readonly menu = new Menu();
  private readonly sound = new Sound();
  private readonly lastTouchSound = new WeakMap<object, number>();
  private readonly marker: THREE.Group;
  private readonly touch: TouchControls;
  private readonly playground: Playground | null;
  private readonly sun = new THREE.DirectionalLight(0xfff3e0, 2.2);

  private state: AppState = 'menu';
  private accumulator = 0;
  private last = performance.now();
  private durationIndex = 1;
  private playerIndex = 9;
  private readonly cmd: UserCommand = {
    move: new THREE.Vector3(),
    sprint: false,
    shoot: { held: false, pressed: false, released: false },
    pass: { held: false, pressed: false, released: false },
    through: { held: false, pressed: false, released: false },
    lob: { held: false, pressed: false, released: false },
    modifier: { held: false, pressed: false, released: false },
    tackle: { held: false, pressed: false, released: false },
    finesse: { held: false, pressed: false, released: false },
    contain: { held: false, pressed: false, released: false },
  };

  /** 온라인 1:1 (중계 서버 락스텝) */
  private lockstep: Lockstep | null = null;
  private online: { session: NetSession; start: StartInfo } | null = null;

  constructor(canvas: HTMLCanvasElement, options: { playground?: typeof Playground; online?: { session: NetSession; start: StartInfo } } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, GRAPHICS.high.pixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.setupSky();
    this.setupLights();

    this.stadium = new Stadium(this.physics);
    this.scene.add(this.stadium.group);

    const online = options.online;
    this.online = online ?? null;
    // 온라인: 물리 프리셋도 방장(팀 0) 것을 양쪽에 (공 궤적이 달라지면 경기가 갈라진다)
    if (online) setActivePhysics(online.start.prefs[0].physics === 'real' ? 'real' : 'arcade');
    this.match = new Match(this.physics, online
      ? {
        random: new Random(online.start.seed), userTeams: [true, true], localTeam: online.start.team,
        // 보정은 각자 자기 팀에, 승부차기는 방장(팀 0) 설정을 양쪽에
        assists: online.start.prefs.map((p) => ({ pass: p.pass, shot: p.shot, move: p.move })) as [TeamAssist, TeamAssist],
        shootout: online.start.prefs[0].shootout,
      }
      : { practice: !!options.playground });
    if (online) {
      this.lockstep = new Lockstep(this.match, online.start.team, online.session, online.start.delay);
      online.session.onData = (team, data) => this.lockstep!.receive(data, team);
      online.session.onDesync = (tick) => this.hud.tick(`동기화 어긋남 (틱 ${tick})`, 4);
      online.session.onOpponentLeft = () => this.hud.tick('상대 연결이 끊겼어요 · 같은 링크로 다시 들어오면 이어서 해요', 6);
      online.session.onOpponentBack = () => this.hud.tick('상대가 돌아왔어요', 2.5);
      online.session.onOpponentAway = (away) => this.hud.tick(away ? '상대가 화면을 벗어났어요 · 돌아올 때까지 멈춰요' : '상대가 돌아왔어요', away ? 6 : 2);
      document.addEventListener('visibilitychange', () => online.session.setAway(document.hidden));
      online.session.flushEarly();
    }
    for (const g of this.match.goals) this.scene.add(g.group);
    for (const p of this.match.players) this.scene.add(p.model.root);
    for (const o of this.match.officials.all) this.scene.add(o.model.root, o.item);
    this.scene.add(this.match.ball.object, this.match.ball.shadow);
    void this.match.ball.load('assets/ball/basic.glb');

    // 개발 중 콘솔에서 상태를 들여다보기 위한 훅
    if (import.meta.env.DEV) (window as unknown as { __game: unknown }).__game = { match: this.match, game: this, settings };

    this.marker = this.createMarker();
    this.scene.add(this.marker);

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // 모바일 회전 직후에는 innerWidth/innerHeight가 늦게 바뀌므로 회전·뷰포트 변화 뒤에 다시 맞춘다
    const later = () => [60, 250, 600].forEach((ms) => setTimeout(() => this.resize(), ms));
    window.addEventListener('orientationchange', later);
    window.visualViewport?.addEventListener('resize', later);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && this.state === 'playing') this.hud.tick(this.toggleSound() ? '사운드 끔' : '사운드 켬');
    });

    this.touch = new TouchControls(this.input, () => this.cancelCharge(), () => this.applyGraphics(true), () => {
      if (this.state === 'playing') this.openPauseMenu();
    });
    this.applyGraphics(this.touch.detected);
    this.openMainMenu();
    this.playground = options.playground ? new options.playground(this.match, () => {
      this.menu.close();
      this.state = 'playing';
      this.accumulator = 0;
      this.cancelCharge();
      this.input.clearVirtual();
      this.input.endFrame();
      this.touch.reset();
    }) : null;
  }

  run(): void {
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- 메뉴

  private settingsItems(): MenuScreen['items'] {
    const players = ([0, 1] as const).flatMap((t) => TEAMS[t].players.map((_, i) => [t, i] as [0 | 1, number]));
    const cur = () => players[this.playerIndex];
    const step = (d: number) => (this.playerIndex = (this.playerIndex + d + players.length) % players.length);
    return [
      {
        id: 'passAssist',
        label: '패스 보조',
        value: () => ASSIST_LABEL[settings.passAssist],
        onLeft: () => cycleAssist('passAssist', -1),
        onRight: () => cycleAssist('passAssist', 1),
        panel: () => assistPanel('pass'),
      },
      {
        id: 'shotAssist',
        label: '슛 보조',
        value: () => ASSIST_LABEL[settings.shotAssist],
        onLeft: () => cycleAssist('shotAssist', -1),
        onRight: () => cycleAssist('shotAssist', 1),
        panel: () => assistPanel('shot'),
      },
      {
        id: 'physics',
        label: '물리',
        value: () => PRESET_LABEL[settings.physicsPreset],
        onLeft: () => this.togglePhysics(),
        onRight: () => this.togglePhysics(),
        panel: () => `<div class="card"><h3>물리</h3><p><b>실제</b> · 실측값 그대로. 공기 저항이 속도에 따라 급변하는 구간(drag crisis), 잔디 구름 저항 약 0.9 m/s², 반발 계수 0.62 (FIFA 잔디 시험 기준 범위).<br/><br/><b>아케이드</b> · 실제 값 위에 게임용 보정: 땅볼이 더 빨리 서고(놓친 공을 쫓아갈 수 있게), 커브가 조금 더 크고, 공기 저항을 평평하게 해서 로빙 거리를 예측하기 쉽게.<br/><br/>패스·슛 세기 보정은 아케이드 기준으로 맞춰져 있어서, 실제로 바꾸면 느린 로빙이나 칩슛이 조금 짧게 떨어질 수 있어요. 값은 <code>src/physics/presets.ts</code>에서 관리합니다.</p></div>`,
      },
      {
        id: 'moveAssist',
        label: '자동 전환 이동 보조',
        value: () => MOVE_ASSIST_LABEL[settings.moveAssist],
        onLeft: () => cycleMoveAssist(-1),
        onRight: () => cycleMoveAssist(1),
        panel: () => `<div class="card"><h3>자동 전환 이동 보조</h3><p>패스로 받는 선수가 바뀐 직후, 얼마 동안 AI가 받으러 가는 움직임을 유지할지 정합니다 (FC의 같은 이름 설정).<br/><br/><b>높음</b> · 0.55초 · <b>낮음</b> · 0.25초 · <b>없음</b> · 바로 내 입력<br/><br/>어떤 설정이든 방향키가 공 쪽을 향하면 공을 가로챌 지점으로 가서 그 앞에서 멈추므로 공을 지나치지 않고, 입력 없이 두면 자동으로 받으러 갑니다. 받는 순간 누르고 있던 방향으로 첫 터치를 합니다.</p></div>`,
      },
      {
        id: 'shootout',
        label: '무승부 시 승부차기',
        value: () => (settings.shootout ? '켜기' : '끄기'),
        onLeft: () => toggleShootout(),
        onRight: () => toggleShootout(),
        onSelect: () => toggleShootout(),
        panel: () => `<div class="card"><h3>승부차기</h3><p>후반 추가 시간까지 비기면 승부차기로 승자를 가립니다. 5번씩 차고, 같으면 한 번씩 더 차는 서든 데스.<br/><br/><b>찰 때</b> · 방향키 ↑↓로 구석을 고르고 D를 꾹 눌렀다 떼기<br/><b>막을 때</b> · 상대가 차는 순간 누르고 있는 ↑↓ 쪽으로 키퍼가 몸을 던집니다. 아무것도 안 누르면 가운데에서 버팁니다.</p></div>`,
      },
      {
        id: 'player',
        label: '선수 능력치',
        value: () => TEAMS[cur()[0]].players[cur()[1]].short,
        onLeft: () => step(-1),
        onRight: () => step(1),
        panel: () => playerDetailPanel(...cur()),
      },
      { id: 'squad', label: '스쿼드', panel: squadPanel, onSelect: () => {} },
      {
        id: 'camera',
        label: '카메라',
        value: () => CAMERA_LABEL[this.rig.mode],
        onLeft: () => this.rig.toggle(),
        onRight: () => this.rig.toggle(),
        panel: () => `<div class="card"><h3>카메라</h3><p><b>TV 중계</b>는 FIFA 기본 카메라처럼 관중석 높은 곳에서 망원으로 당겨 찍어 선수가 크게 보이고, <b>넓은 중계</b>는 가까이서 넓게, <b>선수 뒤</b>는 공격 방향을 정면으로 봅니다. 경기 중 <kbd>V</kbd> 로도 바꿀 수 있어요.</p></div>`,
      },
      {
        id: 'sound',
        label: '사운드',
        value: () => (this.sound.muted ? '끔' : '켬'),
        onLeft: () => this.toggleSound(),
        onRight: () => this.toggleSound(),
        panel: () => `<div class="card"><h3>사운드</h3><p>효과음과 관중 소리를 켜거나 끕니다. 경기 중 <kbd>M</kbd> 키로도 바꿀 수 있어요.</p></div>`,
      },
      {
        id: 'graphics',
        label: '그래픽 품질',
        value: () => GRAPHICS_LABEL[settings.graphicsQuality],
        onLeft: () => { cycleGraphics(-1); this.applyGraphics(this.touch.detected); },
        onRight: () => { cycleGraphics(1); this.applyGraphics(this.touch.detected); },
        panel: () => `<div class="card"><h3>그래픽 품질</h3><p>자동은 터치 기기 또는 CPU 4코어 이하에서 낮음으로 동작합니다. 낮음은 픽셀 비율 최대 1.75, 그림자 1024, 관중 25%로 줄입니다. 높음은 픽셀 비율 최대 2, 그림자 2048, 전체 관중을 표시합니다.</p></div>`,
      },
      { id: 'controls', label: '조작법', panel: controlsPanel, onSelect: () => {} },
    ];
  }

  /** 설정 하위 화면 (FC 온라인처럼 메인 목록을 짧게 유지) */
  private openSettings(back: () => void): void {
    const items = this.settingsItems().filter((i) => !['player', 'squad', 'controls'].includes(i.id));
    this.menu.open({
      eyebrow: '게임 설정',
      title: '설정',
      panel: () => this.settingsSummary(),
      onBack: back,
      items: [...items, { id: 'back', label: '돌아가기', onSelect: back }],
    });
  }

  private settingsSummary(): string {
    const rows = this.settingsItems()
      .filter((i) => i.value)
      .map((i) => `<li><span>${i.label}</span><b>${i.value!()}</b></li>`)
      .join('');
    return `<div class="card"><h3>현재 설정</h3><ul class="setting-list">${rows}</ul></div>`;
  }

  /** 메인·일시정지 공통: 설정 / 선수 정보 / 조작법 */
  private linkItems(back: () => void, withSquad: boolean): MenuScreen['items'] {
    const pick = (id: string) => this.settingsItems().find((i) => i.id === id)!;
    return [
      { id: 'settings', label: '설정', panel: () => this.settingsSummary(), onSelect: () => this.openSettings(back) },
      ...(withSquad ? [pick('player'), pick('squad')] : []),
      pick('controls'),
    ];
  }

  private openMainMenu(): void {
    this.state = 'menu';
    this.hud.show(false);
    const lengthLabel = () => `${DURATIONS[this.durationIndex] / 60}분`;
    this.menu.open({
      eyebrow: '11 vs 11 · 친선 경기',
      title: '킥오프',
      panel: () => matchupPanel(null, [`경기 시간 ${lengthLabel()}`, '중계 · 11대11 · 4-3-3', TEAMS[0].name + ' 홈']),
      items: [
        { id: 'start', label: '경기 시작', onSelect: () => void this.startMatch() },
        { id: 'online-create', label: '온라인 대전 · 방 만들기', onSelect: () => { location.search = '?online'; } },
        {
          id: 'online-join',
          label: '온라인 대전 · 코드로 입장',
          onSelect: () => {
            const code = window.prompt('방 코드 6자리')?.trim().toUpperCase();
            if (code && /^[A-Z0-9]{6}$/.test(code)) location.search = `?room=${code}`;
          },
        },
        {
          id: 'length',
          label: '경기 시간',
          value: lengthLabel,
          onLeft: () => (this.durationIndex = (this.durationIndex + DURATIONS.length - 1) % DURATIONS.length),
          onRight: () => (this.durationIndex = (this.durationIndex + 1) % DURATIONS.length),
        },
        ...this.linkItems(() => this.openMainMenu(), true),
        {
          id: 'snapshoot',
          label: 'SnapShoot 승부차기 ↗',
          onSelect: () => window.open('https://inticoy.github.io/snapshoot', '_blank', 'noopener'),
          panel: () => `<div class="card"><h3>SnapShoot</h3><p>스와이프 한 번으로 차는 승부차기 게임. 같은 SnapShoot 시리즈예요. 나중에 이 게임의 승부차기 모드로 합쳐질 예정입니다.</p></div>`,
        },
      ],
    });
  }

  private openPauseMenu(): void {
    this.state = 'paused';
    this.cancelCharge();
    this.input.clearVirtual();
    const [h, a] = this.match.score;
    this.menu.open({
      eyebrow: `경기 중 · ${this.clockText()}`,
      title: '일시정지',
      panel: () => statsPanel(this.match.stats, [h, a], `경기 진행 ${this.clockText()}`),
      onBack: () => this.resume(),
      items: this.lockstep ? [
        { id: 'resume', label: '계속하기 (온라인 경기는 멈추지 않아요)', onSelect: () => this.resume() },
        { id: 'quit', label: '경기 나가기', onSelect: () => this.leaveOnline() },
      ] : [
        { id: 'resume', label: '계속하기', onSelect: () => this.resume() },
        { id: 'restart', label: '다시 시작', onSelect: () => void this.startMatch() },
        ...this.linkItems(() => this.openPauseMenu(), false),
        { id: 'quit', label: '메인 메뉴', onSelect: () => this.openMainMenu() },
      ],
    });
  }

  private openResult(): void {
    this.state = 'result';
    this.hud.show(false);
    const [h, a] = this.match.score;
    const so = this.match.shootout;
    const [ph, pa] = so.active ? so.score : [h, a];
    const verdict = ph > pa ? '승리' : ph < pa ? '패배' : '무승부';
    const pk = so.active ? ` (승부차기 ${ph} : ${pa})` : '';
    this.menu.open({
      eyebrow: `경기 종료 · ${TEAMS[0].abbr} ${h} : ${a} ${TEAMS[1].abbr}${pk}`,
      title: verdict,
      panel: () => statsPanel(this.match.stats, [h, a], `경기 종료 · ${verdict}`),
      // 온라인: 한쪽만 다시 시작하면 두 경기가 갈라지므로 새 방으로
      items: this.lockstep ? [
        { id: 'again', label: '새 방 만들기', onSelect: () => { location.search = '?online'; } },
        { id: 'menu', label: '메인 메뉴', onSelect: () => this.leaveOnline() },
      ] : [
        { id: 'again', label: '다시 하기', onSelect: () => void this.startMatch() },
        { id: 'menu', label: '메인 메뉴', onSelect: () => this.openMainMenu() },
      ],
    });
  }

  private openHalftime(): void {
    this.state = 'paused';
    this.hud.show(false);
    this.cancelCharge();
    this.input.clearVirtual();
    const [h, a] = this.match.score;
    this.menu.open({
      eyebrow: `하프타임 · ${TEAMS[0].abbr} ${h} : ${a} ${TEAMS[1].abbr}`,
      title: '하프타임',
      panel: () => statsPanel(this.match.stats, [h, a], '전반 종료'),
      onBack: () => this.resume(),
      items: [
        { id: 'second', label: '후반 시작', onSelect: () => this.resume() },
        ...this.linkItems(() => this.openHalftime(), false),
        { id: 'quit', label: '메인 메뉴', onSelect: () => this.openMainMenu() },
      ],
    });
  }

  private clockText(): string {
    const m = this.match;
    const base = m.half * 45;
    const min = Math.floor(m.matchMinutes) + 1;
    return min > base ? `${base}+${min - base}'` : `${Math.max(1, min)}'`;
  }

  /** 온라인 스텝 하나: 내 입력 예약 + 두 입력이 다 온 틱 계산. 못 했으면 false (상대 입력 대기) */
  private stepOnline(cmd: UserCommand): boolean {
    const ls = this.lockstep!;
    if (ls.ready) ls.pushLocal(cmd);
    if (!ls.step()) {
      this.waiting += PHYSICS.step;
      if (this.waiting > 0.5 && this.waiting - PHYSICS.step <= 0.5) this.hud.tick('상대 입력을 기다리는 중…', 1.5);
      return false;
    }
    this.waiting = 0;
    // 재접속 등으로 계산할 틱이 쌓여 있으면 한 프레임에 많이 따라잡는다 (입력은 이미 기록에 있다)
    // 평소에도 입력 지연만큼 몇 틱은 준비돼 있으므로, 그보다 훨씬 많이 밀렸을 때만 (재접속 등)
    const behind = ls.backlog - ls.delay * 2;
    if (behind > 30) for (let i = 0; i < Math.min(600, behind); i++) if (!ls.step()) break;
    return true;
  }

  /** 메뉴가 열려 있어도 온라인 경기를 계속 진행 */
  private runOnline(dt: number, cmd: UserCommand): void {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= PHYSICS.step && steps < 12) {
      if (!this.stepOnline(cmd)) { this.accumulator = Math.min(this.accumulator, PHYSICS.step * 4); break; }
      this.accumulator -= PHYSICS.step;
      steps++;
    }
    this.handleEvents();
  }

  /** 온라인 경기에서 나가기 (방 주소를 지우고 처음 화면으로) */
  private leaveOnline(): void {
    location.search = '';
  }

  private waiting = 0;

  /** UI로 게이지 취소. 온라인에서는 입력 기록 밖에서 경기 상태를 바꾸면 두 화면이 갈라지므로 하지 않는다 */
  private cancelCharge(): void {
    if (!this.lockstep) this.match.cancelUserCharge();
  }

  /** 온라인 경기: 메뉴 없이 바로 킥오프 */
  startOnline(): void {
    void this.startMatch();
  }

  private async startMatch(): Promise<void> {
    if (this.playground) { this.playground.reset(); return; }
    this.menu.close();
    this.state = 'playing';
    this.hud.show(true);
    // 온라인: 경기 시간은 방장(팀 0) 설정
    this.match.duration = this.online ? this.online.start.prefs[0].duration : DURATIONS[this.durationIndex];
    this.match.restart();
    this.hud.tick(`${TEAMS[0].name} vs ${TEAMS[1].name}`, 2.2);
    await this.sound.unlock();
    this.sound.startAmbience();
  }

  private resume(): void {
    this.menu.close();
    this.state = 'playing';
    this.hud.show(true);
    void this.sound.unlock();
  }

  private togglePhysics(): void {
    togglePhysicsPreset();
    this.physics.applyPreset(activePhysics());
  }

  private toggleSound(): boolean {
    return this.sound.toggleMute();
  }

  // ---------------------------------------------------------------- 루프

  private frame(dt: number): void {
    this.ensureViewSize();
    const restart = this.match.setPieces.current;
    const so = this.match.shootout;
    const mode: TouchMode = so.active && this.match.phase === 'shootout' ? (so.turn === 0 ? 'penalty' : 'keeper')
      : restart?.team === 0 ? restart.kind
      : restart?.kind === 'penalty' ? 'keeper'
      : this.match.userAttacking || this.match.ball.owner?.team === 0 ? 'attack' : 'defence';
    this.touch.update(this.state === 'playing', mode);
    const menuWasVisible = this.menu.visible;
    if (menuWasVisible) {
      for (const code of this.input.drainPresses()) if (MENU_KEYS.includes(code)) this.menu.handleKey(code);
      this.input.endFrame();
      // 온라인: 메뉴(일시정지)를 열어도 경기는 멈추지 않는다 — 내 선수는 입력 없음으로 계속 진행 (상대를 멈춰 세우지 않게)
      if (this.lockstep && this.state === 'paused') this.runOnline(dt, IDLE_COMMAND);
    } else if (this.state === 'playing') {
      if (this.input.wasPressed('pause') && this.match.phase !== 'fulltime') {
        this.input.endFrame();
        this.openPauseMenu();
      } else {
        if (this.input.wasPressed('camera')) this.hud.tick(`${CAMERA_LABEL[this.rig.toggle()]} 카메라`, 1);
        this.accumulator += dt;
        let steps = 0;
        while (this.accumulator >= PHYSICS.step && steps < 12) {
          this.buildCommand();
          const stepCommand = this.playground?.commandForStep() ?? this.cmd;
          if (this.lockstep) {
            if (!this.stepOnline(stepCommand)) {
              this.input.endFrame();
              this.accumulator = Math.min(this.accumulator, PHYSICS.step * 4);
              break;
            }
          } else this.match.update(PHYSICS.step, stepCommand);
          if (this.playground) {
            // 텔레메트리의 뼈 높이도 같은 스텝의 애니메이션에서 읽는다.
            for (const p of this.match.players) {
              const distance = Math.hypot(p.pos.x - this.match.ball.position.x, p.pos.z - this.match.ball.position.z);
              p.syncVisual(PHYSICS.step, distance);
            }
            this.playground.step(PHYSICS.step, stepCommand);
            this.playground.endScriptStep();
            this.handleEvents();
          }
          this.input.endFrame();
          this.accumulator -= PHYSICS.step;
          steps++;
        }
        this.handleEvents();
      }
    }
    if (!menuWasVisible) this.input.drainPresses();

    const live = this.state === 'playing';
    for (const p of this.match.players) {
      const distance = Math.hypot(p.pos.x - this.match.ball.position.x, p.pos.z - this.match.ball.position.z);
      p.syncVisual(live && !this.playground ? dt : 0, live ? distance : 0);
    }
    if (!this.playground) this.match.officials.syncVisual(live ? dt : 0);
    this.match.ball.syncVisual();
    // 손에 든 공(키퍼 캐치·스로인)은 화면에서 두 손 사이에 그린다 (판정 위치는 그대로)
    const holder = this.match.ball.owner?.isKeeper && this.match.ball.position.y > 0.4 ? this.match.ball.owner
      : this.match.setPieces.current?.kind === 'throwin' ? this.match.setPieces.current.taker : null;
    const model = holder?.model;
    if (model?.handPosition && model.handPosition(handL, 'L') && model.handPosition(handR, 'R')) {
      this.match.ball.object.position.copy(handL).add(handR).multiplyScalar(0.5);
    }
    this.stadium.update(dt);
    this.updateMarker(dt);

    if (this.state === 'menu') {
      // 메인 메뉴: 경기장을 천천히 둘러본다
      const t = performance.now() / 1000;
      this.rig.camera.position.set(Math.sin(t * 0.06) * PITCH.halfL, 32 + Math.sin(t * 0.1) * 3, Math.cos(t * 0.06) * (PITCH.halfW + 25));
      this.rig.camera.lookAt(0, 0, 0);
    } else if (live) {
      const celebrate =
        this.match.phase === 'goal' && this.match.phaseTimer < 2.6 ? (this.match.lastScorer?.pos ?? null) : null;
      this.rig.update(dt, this.match.ball.position, this.match.local.controlled.pos, celebrate);
      this.hud.update(dt, this.match, this.rig.camera);
    }
    this.renderer.render(this.scene, this.rig.camera);
  }

  private buildCommand(): void {
    const axis = this.input.moveAxis();
    const f = this.rig.forward(new THREE.Vector3());
    const r = this.rig.right(new THREE.Vector3());
    this.cmd.move.set(0, 0, 0).addScaledVector(f, axis.y).addScaledVector(r, axis.x);
    this.input.updateSkillMask(this.input.isDown('skill') || this.input.isDown('finesse'));
    const sa = this.input.skillAxis();
    (this.cmd.skillMove ??= new THREE.Vector3()).set(0, 0, 0).addScaledVector(f, sa.y).addScaledVector(r, sa.x);
    this.cmd.sprint = this.input.isDown('sprint');
    this.cmd.shoot = this.input.button('shoot');
    this.cmd.pass = this.input.button('pass');
    this.cmd.through = this.input.button('through');
    this.cmd.lob = this.input.button('lob');
    this.cmd.modifier = this.input.button('modifier');
    this.cmd.tackle = this.input.button('tackle');
    this.cmd.finesse = this.input.button('finesse');
    this.cmd.power = this.input.button('power');
    this.cmd.keyboardKick = this.input.keyboardKick();
    this.cmd.contain = this.input.button('contain');
    this.cmd.skill = this.input.button('skill');
  }

  private handleEvents(): void {
    for (const e of this.match.events) {
      // 선수 객체는 순환 참조라 이름만 남긴다
      if (import.meta.env.DEV && e.type !== 'bounce') {
        console.debug('[event]', e.type, JSON.stringify(e, (k, v) => (k && v && typeof v === 'object' && 'profile' in v ? v.profile.short : v)));
      }
      switch (e.type) {
        case 'touch': {
          const distance = Math.hypot(e.player.pos.x - this.rig.camera.position.x, e.player.pos.z - this.rig.camera.position.z);
          const decision = decideTouchSound(e.speed, distance, performance.now() / 1000, this.lastTouchSound.get(e.player));
          if (decision.volume > 0) {
            this.lastTouchSound.set(e.player, decision.nextTime);
            const variant = 1 + Math.floor(visualRandom.next() * 4);
            this.sound.play(`touch-${variant}` as 'touch-1' | 'touch-2' | 'touch-3' | 'touch-4', decision.volume, 0.94 + visualRandom.next() * 0.12);
          }
          break;
        }
        case 'kick':
          this.sound.play(e.speed < 12 ? 'kick-light' : 'kick', categoryVolume('ball', 0.55 + e.speed / 38), 0.94 + visualRandom.next() * 0.12);
          break;
        case 'bounce':
          this.sound.play('bounce', categoryVolume('ball', e.speed / 12));
          break;
        case 'post':
          this.sound.play('post', categoryVolume('ball', e.speed / 15));
          this.hud.tick('골대 강타!');
          this.rig.addShake(0.25);
          break;
        case 'net':
          this.sound.play('net', categoryVolume('ball', e.speed / 12));
          break;
        case 'save':
          this.sound.play('save', categoryVolume('body', 0.8));
          this.hud.tick(e.caught ? '골키퍼 선방 · 캐치' : '골키퍼 선방 · 펀칭');
          this.stadium.cheer(0.4);
          break;
        case 'tackle':
          if (e.success) this.sound.play('bounce', categoryVolume('body', 0.6), 0.7);
          break;
        case 'goal': {
          this.sound.play('goal', categoryVolume('crowd', 1));
          this.sound.play('cheer', categoryVolume('crowd', 0.9));
          this.sound.setAmbienceLevel(0.25);
          setTimeout(() => this.sound.setAmbienceLevel(0.12), 4000);
          this.stadium.cheer(1);
          this.rig.addShake(0.4);
          const sub = e.scorer
            ? `${e.scorer.profile.number}  ${e.scorer.profile.name}  ${this.clockText()}`
            : `${TEAMS[e.team].name}  ${this.clockText()}`;
          this.hud.goal(e.team, e.ownGoal ? 'OWN GOAL' : 'GOAL', sub, [...this.match.score] as [number, number]);
          break;
        }
        case 'out':
          this.sound.whistle([0.18]);
          this.hud.tick(`${RESTART_LABEL[e.kind]} · ${TEAMS[e.team].abbr}`, 2.2);
          break;
        case 'restart':
          break;
        case 'foul':
          this.sound.whistle([0.22]);
          this.hud.tick(`${e.penalty ? '페널티킥!' : '파울'} · ${e.by.profile.short}`, 2.2);
          if (e.penalty) this.stadium.cheer(0.6);
          break;
        case 'advantage':
          this.hud.tick('어드밴티지', 1.6);
          break;
        case 'card':
          this.hud.card(e.player, e.card, e.second);
          break;
        case 'skill': {
          // 사용자 개인기는 이름을 잠깐 띄워 실제로 나갔는지 보이게 한다
          if (this.match.isUserControlled(e.player)) {
            const def = SKILLS.find((d) => d.id === e.id);
            if (def) this.hud.tick(`${'★'.repeat(def.stars)} ${def.name}`, 1.2);
          }
          break;
        }
        case 'offside':
          this.sound.whistle([0.16, 0.16]);
          this.hud.tick(`오프사이드 · ${e.player.profile.short}`, 2.2);
          this.hud.flag();
          break;
        case 'stoppage':
          this.hud.stoppage(e.minutes);
          break;
        case 'penaltyKick':
          this.sound.play(e.scored ? 'net' : 'save', categoryVolume(e.scored ? 'ball' : 'body', 0.8));
          if (e.scored) this.stadium.cheer(0.7);
          this.hud.tick(`${e.kicker.profile.short} · ${e.scored ? '성공' : '실패'}`, 1.4);
          break;
        case 'shootoutEnd':
          this.sound.whistle([0.3, 0.3, 0.9]);
          this.stadium.cheer(1);
          this.hud.tick(`승부차기 ${e.score[0]} : ${e.score[1]}`, 3);
          setTimeout(() => {
            if (this.match.phase === 'fulltime' && this.state === 'playing') this.openResult();
          }, 2600);
          break;
        case 'whistle':
          if (e.kind === 'kickoff') this.sound.whistle([0.45]);
          else if (e.kind === 'halftime') {
            this.sound.whistle([0.35, 0.9]);
            this.hud.tick('전반 종료', 2.4);
            // 온라인: 하프타임 메뉴로 멈추지 않는다 (경기가 정해진 시간 뒤 후반을 시작한다)
            if (this.lockstep) this.hud.tick('하프타임 · 잠시 뒤 후반 시작', 3);
            else setTimeout(() => {
              if (this.match.phase === 'halftime' && this.state === 'playing') this.openHalftime();
            }, 2200);
          } else if (this.match.phase === 'shootout') {
            this.sound.whistle([0.3, 0.3, 0.9]);
            this.hud.tick('무승부 · 승부차기', 3);
          } else {
            this.sound.whistle([0.3, 0.3, 0.9]);
            this.hud.tick('경기 종료', 3);
            setTimeout(() => {
              if (this.match.phase === 'fulltime' && this.state === 'playing') this.openResult();
            }, 3000);
          }
          break;
      }
    }
    this.match.events.length = 0;
  }

  // ---------------------------------------------------------------- 씬

  private createMarker(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x2ef59a, transparent: true, opacity: 0.85, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.6, 40), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    // 바라보는 방향 표시
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 3), mat);
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0.02, 0.8);
    g.add(arrow);
    return g;
  }

  private updateMarker(dt: number): void {
    const p = this.match.local.controlled;
    const visible = this.state === 'playing' && this.match.phase !== 'goal';
    this.marker.visible = visible;
    if (!visible) return;
    this.marker.position.set(p.pos.x, 0, p.pos.z);
    const target = Math.atan2(p.facing.x, p.facing.z);
    let d = target - this.marker.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.marker.rotation.y += d * (1 - Math.exp(-20 * dt));
  }

  private setupSky(): void {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#0d1b33');
    grad.addColorStop(0.55, '#2b4a78');
    grad.addColorStop(1, '#8a6d7a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = tex;
    this.scene.fog = new THREE.Fog(0x1a2740, 90, 220);
  }

  private setupLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a3b22, 0.9));
    const sun = this.sun;
    sun.position.set(-30, 80, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(GRAPHICS.high.shadowSize, GRAPHICS.high.shadowSize);
    const s = sun.shadow.camera;
    // 광원 축이 필드와 비스듬하므로 대각선 반경으로 네 모서리까지 덮는다.
    const extent = Math.hypot(PITCH.halfL, PITCH.halfW) + 6;
    s.left = s.bottom = -extent;
    s.right = s.top = extent;
    s.near = 1;
    s.far = 180;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
    fill.position.set(30, 30, -25);
    this.scene.add(fill);
  }

  private applyGraphics(touch: boolean): void {
    const profile = GRAPHICS[graphicsQuality(touch, navigator.hardwareConcurrency ?? 8)];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatio));
    if (this.sun.shadow.mapSize.x !== profile.shadowSize) {
      this.sun.shadow.mapSize.set(profile.shadowSize, profile.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.stadium.setCrowdDensity(profile.crowdDensity);
  }

  private viewW = 0;
  private viewH = 0;

  /** 캔버스의 실제 표시 크기 (회전 직후에도 레이아웃 기준이라 정확하다) */
  private viewSize(): [number, number] {
    const c = this.renderer.domElement;
    return [c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight];
  }

  private resize(): void {
    const [w, h] = this.viewSize();
    if (!w || !h) return;
    this.viewW = w;
    this.viewH = h;
    this.applyGraphics(this.touch?.detected ?? window.matchMedia('(pointer: coarse)').matches);
    this.renderer.setSize(w, h, false);
    this.rig.resize(w / h);
  }

  /** 매 프레임: 표시 크기가 바뀌었는데 resize 이벤트를 놓쳤으면 맞춘다 (화면이 눌려 보이는 문제 방지) */
  private ensureViewSize(): void {
    const [w, h] = this.viewSize();
    if (w !== this.viewW || h !== this.viewH) this.resize();
  }
}
