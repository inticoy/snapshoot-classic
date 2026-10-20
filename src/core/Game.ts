import type { CharacterModel } from '../entities/PlayerModel';
import * as THREE from 'three';
import { GRAPHICS, PHYSICS, PITCH, MATCH, ONLINE_CATCH_UP } from '../config';
import { Input } from './Input';
import { TouchControls } from '../ui/TouchControls';
import type { TouchMode } from './TouchInput';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Stadium } from '../environment/Stadium';
import { Lighting } from '../environment/Lighting';
import { SKILLS } from '../gameplay/Skills';
import { Lockstep } from '../net/Lockstep';
import type { NetSession, StartInfo } from '../net/NetSession';
import { IDLE_COMMAND, Match, type TeamAssist, type UserCommand } from '../gameplay/Match';
import { CAMERA_LABEL, CameraRig } from '../camera/CameraRig';
import { Hud } from '../ui/Hud';
import { Menu, assistPanel, controlsPanel, matchupPanel, SquadView, statsPanel, type MenuScreen } from '../ui/Menu';
import { ASSIST_LABEL, MOVE_ASSIST_LABEL, GRAPHICS_LABEL, cycleAssist, cycleMoveAssist, cycleGraphics, graphicsQuality, settings, setDuration, togglePhysicsPreset, toggleShootout } from './Settings';
import { PRESET_LABEL, activePhysics, setActivePhysics } from '../physics/presets';
import { Sound } from '../audio/Sound';
import { categoryVolume, decideTouchSound } from '../audio/Mix';
import { TEAMS } from '../data/Teams';
import { RESTART_LABEL } from '../gameplay/SetPieces';
import { Random, visualRandom } from './Random';
import type { Playground } from '../playground/Playground';

type AppState = 'menu' | 'playing' | 'paused' | 'result';

const DURATIONS = MATCH.durations;
const MENU_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace'];

const handL = new THREE.Vector3(), handR = new THREE.Vector3();

/** 같은 렌더 프레임의 고정 스텝들이 따라잡기 예산을 중복 사용하지 않게 한다. */
export class OnlineCatchUp {
  private source: object | null = null;
  private target = 0;
  private start = 0;
  private frame: number | null = null;
  private percent = 0;

  run(frame: number, ls: Pick<Lockstep, 'tick' | 'backlog' | 'delay' | 'step'>,
    discardEvents: () => void, now: () => number = () => performance.now()): number | null {
    if (this.source !== ls) {
      this.source = ls;
      this.target = ls.tick;
      this.frame = null;
    }
    if (this.frame === frame) return this.percent;
    if (ls.tick >= this.target) {
      const behind = ls.backlog - ls.delay * 2;
      if (behind <= ONLINE_CATCH_UP.threshold) return null;
      this.start = ls.tick;
      this.target = ls.tick + behind;
    }
    this.frame = frame;
    const deadline = now() + ONLINE_CATCH_UP.budgetMs;
    let steps = 0;
    // 느린 기기에서도 조금씩 진행하되, 이미 받은 기록의 이벤트는 마지막 틱까지 버린다.
    discardEvents();
    while (ls.tick < this.target && (steps < ONLINE_CATCH_UP.minTicks || now() < deadline)) {
      if (!ls.step()) break;
      discardEvents();
      steps++;
    }
    this.percent = Math.min(100, Math.floor((ls.tick - this.start) * 100 / (this.target - this.start)));
    return this.percent;
  }
}

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
  private readonly lighting: Lighting;
  readonly sun: THREE.DirectionalLight;

  private state: AppState = 'menu';
  private accumulator = 0;
  private last = performance.now();
  private durationIndex = DURATIONS.indexOf(settings.duration);
  private readonly squad = new SquadView();
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
  private readonly catchUp = new OnlineCatchUp();
  private readonly lodFar = new Set<CharacterModel>();
  private online: { session: NetSession; start: StartInfo } | null = null;

  constructor(canvas: HTMLCanvasElement, options: { playground?: typeof Playground; online?: { session: NetSession; start: StartInfo } } = {}) {
    // 메뉴를 거치지 않는 연습장·초대 링크도 첫 사용자 입력 안에서 오디오를 깨운다.
    const unlockAudio = () => { void this.sound.unlock().catch((error) => console.warn('audio unlock failed', error)); };
    window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
    window.addEventListener('keydown', unlockAudio, { once: true, capture: true });
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, GRAPHICS.high.pixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.lighting = new Lighting(this.scene, this.renderer);
    this.sun = this.lighting.sun;

    this.stadium = new Stadium(this.physics);
    this.scene.add(this.stadium.group);

    const online = options.online;
    this.online = online ?? null;
    // 온라인: 물리 프리셋도 방장(팀 0) 것을 양쪽에 (공 궤적이 달라지면 경기가 갈라진다)
    if (online) {
      setActivePhysics(online.start.prefs[0].physics === 'real' ? 'real' : 'arcade');
      // 월드는 필드 초기화 때 내 설정으로 만들어졌으니 방장 값으로 다시 맞춘다
      this.physics.applyPreset(activePhysics());
    }
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
      // 어긋나면 양쪽 모두 같은 방에 다시 들어가 서버 입력 기록으로 처음부터 다시 계산한다 (기록이 같으니 결과도 같다)
      online.session.onDesync = (tick) => {
        if (this.resyncing) return;
        this.resyncing = true;
        online.session.close();
        // 같은 기록으로 다시 계산해도 또 어긋나면(원인이 결정적이면) 새로고침이 끝없이 돌므로 두 번까지만
        const key = `snapshoot-resync:${online.session.code}`;
        const tries = (() => { try { return Number(sessionStorage.getItem(key)) || 0; } catch { return 0; } })();
        if (tries >= 2) {
          this.netNotice('동기화를 복구하지 못해 경기를 끝내요');
          setTimeout(() => this.leaveOnline(), 4000);
          return;
        }
        try { sessionStorage.setItem(key, String(tries + 1)); } catch { /* 저장 못 해도 진행 */ }
        this.hud.tick(`동기화를 복구하고 있어요 (틱 ${tick})`, 3);
        setTimeout(() => location.reload(), 600);
      };
      online.session.onClosed = () => {
        if (this.resyncing) return;
        this.netNotice('서버 연결이 끊겼어요 · 다시 연결해요');
        setTimeout(() => location.reload(), 2500);
      };
      online.session.onPause = (p) => {
        this.netPause = p ? { team: p.team, until: performance.now() + p.ms } : null;
        if (p) this.pausesLeft = p.left[online.start.team] ?? this.pausesLeft;
        if (!p && this.menu.visible && this.state === 'paused') this.resume();
        if (p && p.team !== online.start.team) this.hud.tick('상대가 경기를 멈췄어요', 2);
      };
      online.session.onOpponentLeft = () => this.hud.tick('상대 연결이 끊겼어요 · 같은 링크로 돌아오면 경기를 이어가요', 6);
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
      if (e.code === 'KeyM' && this.state === 'playing') this.hud.tick(this.toggleSound() ? '소리를 껐어요' : '소리를 켰어요');
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
    }, {
      setSpeed: (scale) => { this.timeScale = scale; },
      setCloseUp: (view, snap) => this.rig.setCloseUp(view, snap),
    }) : null;
  }

  run(): void {
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      this.updateNetStatus();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- 메뉴

  private settingsItems(): MenuScreen['items'] {
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
        panel: () => `<div class="card"><h3>물리</h3><p><b>실제</b> · 실측값을 그대로 사용해요. 속도에 따라 공기 저항이 급변하는 구간(drag crisis)을 반영해요. 잔디 위 구름 저항은 약 0.9 m/s², 반발 계수는 0.62로 잔디 시험 기준 범위에 맞췄어요.<br/><br/><b>아케이드</b> · 실제 값에 게임용 보정을 더해요. 놓친 공을 쫓아갈 수 있도록 땅볼이 더 빨리 멈추고 커브가 조금 더 커져요. 공기 저항의 변화를 줄여 로빙 거리를 예측하기 쉬워요.<br/><br/>패스·슛 세기 보정은 아케이드 기준으로 맞춰져 있어서, 실제로 바꾸면 느린 로빙이나 칩슛이 조금 짧게 떨어질 수 있어요. 값은 <code>src/physics/presets.ts</code>에서 관리해요.</p></div>`,
      },
      {
        id: 'moveAssist',
        label: '자동 전환 이동 보조',
        value: () => MOVE_ASSIST_LABEL[settings.moveAssist],
        onLeft: () => cycleMoveAssist(-1),
        onRight: () => cycleMoveAssist(1),
        panel: () => `<div class="card"><h3>자동 전환 이동 보조</h3><p>패스를 받을 선수로 자동 전환된 직후, AI가 공을 받으러 가는 움직임을 얼마나 오래 유지할지 정해요.<br/><br/><b>높음</b> · 0.55초 · <b>낮음</b> · 0.25초 · <b>없음</b> · 바로 직접 조작<br/><br/>어떤 설정이든 방향키가 공 쪽을 향하면 공을 가로챌 지점으로 가서 그 앞에서 멈추므로 공을 지나치지 않고, 입력 없이 두면 자동으로 공을 받으러 가요. 공을 받는 순간 누르고 있던 방향으로 첫 터치를 해요.</p></div>`,
      },
      {
        id: 'shootout',
        label: '무승부 시 승부차기',
        value: () => (settings.shootout ? '켜기' : '끄기'),
        onLeft: () => toggleShootout(),
        onRight: () => toggleShootout(),
        onSelect: () => toggleShootout(),
        panel: () => `<div class="card"><h3>승부차기</h3><p>후반 추가 시간까지 비기면 승부차기로 승자를 정해요. 다섯 번씩 차고도 동점이면 승부가 날 때까지 한 번씩 더 차요.<br/><br/><b>찰 때</b> · 방향키 ↑↓로 구석을 고르고 D를 길게 눌렀다 놓아요.<br/><b>막을 때</b> · 상대가 차는 순간 누르고 있는 ↑↓ 쪽으로 골키퍼가 몸을 던져요. 아무 키도 누르지 않으면 가운데에서 버텨요.</p></div>`,
      },
      {
        id: 'squad', label: '스쿼드',
        panel: () => `<div class="card"><h3>스쿼드</h3><p>포메이션과 선수 능력치를 보고 선발을 바꿔요.</p><p>스쿼드 화면에서 선수 카드를 눌러 봐요.</p></div>`,
        onSelect: () => this.openSquad(),
      },
      {
        id: 'camera',
        label: '카메라',
        value: () => CAMERA_LABEL[this.rig.mode],
        onLeft: () => this.rig.toggle(),
        onRight: () => this.rig.toggle(),
        panel: () => `<div class="card"><h3>카메라</h3><p><b>TV 중계</b>는 높은 관중석에서 당겨 찍어 선수를 크게 보여 줘요. <b>넓은 중계</b>는 가까운 곳에서 넓게 보여 줘요. <b>선수 뒤</b>는 공격 방향을 정면으로 보여 줘요. 경기 중 <kbd>V</kbd> 키로도 바꿀 수 있어요.</p></div>`,
      },
      {
        id: 'sound',
        label: '사운드',
        value: () => (this.sound.muted ? '끔' : '켬'),
        onLeft: () => this.toggleSound(),
        onRight: () => this.toggleSound(),
        panel: () => `<div class="card"><h3>사운드</h3><p>효과음과 관중 소리를 켜거나 꺼요. 경기 중 <kbd>M</kbd> 키로도 바꿀 수 있어요.</p></div>`,
      },
      {
        id: 'graphics',
        label: '그래픽 품질',
        value: () => GRAPHICS_LABEL[settings.graphicsQuality],
        onLeft: () => { cycleGraphics(-1); this.applyGraphics(this.touch.detected); },
        onRight: () => { cycleGraphics(1); this.applyGraphics(this.touch.detected); },
        panel: () => `<div class="card"><h3>그래픽 품질</h3><p>자동으로 설정하면 터치 기기나 CPU가 4코어 이하인 기기에서는 낮음으로 설정돼요. 낮음에서는 픽셀 비율을 최대 1.75, 그림자 해상도를 1024, 관중을 25%로 줄여요. 높음에서는 픽셀 비율을 최대 2, 그림자 해상도를 2048로 설정하고 모든 관중을 보여 줘요.</p></div>`,
      },
      { id: 'controls', label: '조작법', panel: controlsPanel, onSelect: () => {} },
    ];
  }

  /** 설정 하위 화면 (FC 온라인처럼 메인 목록을 짧게 유지) */
  private openSettings(back: () => void): void {
    const items = this.settingsItems().filter((i) => !['squad', 'controls'].includes(i.id));
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
      ...(withSquad ? [pick('squad')] : []),
      pick('controls'),
    ];
  }

  private openSquad(): void {
    this.menu.open({
      eyebrow: '경기 준비', title: '스쿼드',
      panel: this.squad.panel, bindPanel: this.squad.bind,
      onBack: () => this.openMainMenu(),
      items: [{ id: 'back', label: '돌아가기', onSelect: () => this.openMainMenu() }],
    });
    document.querySelector<HTMLElement>('.squad-view [data-player]')?.focus();
  }

  /** 온라인 대전 하위 메뉴 */
  private openOnlineMenu(): void {
    this.menu.open({
      eyebrow: '1 vs 1 · 온라인',
      title: '온라인 대전',
      panel: () => `<div class="online-panel"><h3>1:1 온라인</h3><ul>
        <li><b>빠른 매칭</b> 지금 상대를 찾는 사람과 바로 연결돼요.</li>
        <li><b>방 만들기</b> 6자리 코드나 링크로 친구를 초대해요.</li>
        <li><b>코드로 입장</b> 받은 코드를 입력해요.</li></ul>
        <p>먼저 들어온 사람이 홈 팀이에요. 경기 시간과 승부차기는 방장 설정을, 보정은 각자 설정을 사용해요. 일시정지 횟수를 다 쓰면 메뉴를 열어도 경기는 계속돼요.</p></div>`,
      onBack: () => this.openMainMenu(),
      items: [
        { id: 'quick', label: '빠른 매칭', onSelect: () => { location.search = '?quick'; } },
        { id: 'create', label: '방 만들기', onSelect: () => { location.search = '?online'; } },
        { id: 'join', label: '코드로 입장', onSelect: () => { location.search = '?join'; } },
        { id: 'back', label: '뒤로', onSelect: () => this.openMainMenu() },
      ],
    });
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
        { id: 'online', label: '온라인 대전', onSelect: () => this.openOnlineMenu() },
        {
          id: 'length',
          label: '경기 시간',
          value: lengthLabel,
          onLeft: () => { this.durationIndex = (this.durationIndex + DURATIONS.length - 1) % DURATIONS.length; setDuration(DURATIONS[this.durationIndex]); },
          onRight: () => { this.durationIndex = (this.durationIndex + 1) % DURATIONS.length; setDuration(DURATIONS[this.durationIndex]); },
        },
        ...this.linkItems(() => this.openMainMenu(), true),
        {
          id: 'snapshoot',
          label: 'SnapShoot 승부차기 ↗',
          onSelect: () => window.open('https://inticoy.github.io/snapshoot', '_blank', 'noopener'),
          panel: () => `<div class="card"><h3>SnapShoot</h3><p>스와이프 한 번으로 공을 차는 승부차기 게임이에요. 같은 SnapShoot 시리즈예요. 나중에 이 게임의 승부차기 모드로 합쳐질 예정이에요.</p></div>`,
        },
      ],
    });
  }

  private openPauseMenu(): void {
    // 온라인: 남은 횟수가 있으면 둘 다 멈춘다 (서버가 횟수·시간을 확인해 양쪽에 알린다)
    const canPause = !!this.online && !this.netPause && this.pausesLeft > 0;
    if (canPause) this.online!.session.requestPause(true);
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
        { id: 'resume', label: canPause ? `계속하기 (남은 일시정지 ${this.pausesLeft - 1}회 · 최대 60초)` : this.netPause ? '계속하기' : '계속하기 (일시정지를 다 썼어요 · 경기 진행 중)', onSelect: () => this.resume() },
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
    // 승패는 이 화면 사람의 팀 기준 (온라인 원정이면 반대)
    const mine = this.match.localTeam === 0 ? ph - pa : pa - ph;
    const verdict = mine > 0 ? '승리' : mine < 0 ? '패배' : '무승부';
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
      panel: () => statsPanel(this.match.stats, [h, a], '전반이 끝났어요'),
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
    // 일시정지 중이거나 재접속 기록을 아직 다 못 받았으면 진행하지 않는다
    if (this.netPause || this.online!.session.resuming) return false;
    const progress = this.catchUp.run(this.last, ls, () => { this.match.events.length = 0; });
    if (progress !== null) {
      this.hud.tick(`지난 경기 상황을 복원하고 있어요… ${progress}%`, 0.5);
      return false;
    }
    // 내 입력은 늘 지금 틱 + delay까지 예약해 둔다 (재접속 따라잡기 뒤에도 간격이 벌어진 채 멈추지 않게)
    while (ls.scheduled < ls.tick + ls.delay) ls.pushLocal(cmd);
    if (!ls.step()) {
      this.waiting += PHYSICS.step;
      if (this.waiting > 0.5 && this.waiting - PHYSICS.step <= 0.5) this.hud.tick('상대 입력을 기다리고 있어요…', 1.5);
      return false;
    }
    this.waiting = 0;
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
  private resyncing = false;
  /** 온라인 일시정지 (둘 다 멈춤). until = 자동 재개 시각 */
  private netPause: { team: 0 | 1; until: number } | null = null;
  private pausesLeft = 3;
  private netEl: HTMLElement | null = null;

  /** 온라인 상태 줄: 핑, 일시정지 남은 시간 (화면 구석에 작게) */
  private updateNetStatus(): void {
    const s = this.online?.session;
    if (!s) return;
    if (!this.netEl) {
      this.netEl = document.createElement('div');
      this.netEl.className = 'net-status';
      document.body.append(this.netEl);
    }
    const ms = s.rtt === null ? null : Math.round(s.rtt);
    const level = ms === null ? '' : ms < 60 ? 'good' : ms < 120 ? 'ok' : 'bad';
    const ping = `<span class="net-ping ${level}">● ${ms === null ? '—' : `${ms}ms`}</span>`;
    const p = this.netPause;
    const pause = p ? `<b class="net-paused">${p.team === this.online!.start.team ? '일시정지' : '상대가 일시정지했어요'} ${Math.max(0, Math.ceil((p.until - performance.now()) / 1000))}초</b>` : '';
    const html = ping + pause;
    if (this.netEl.innerHTML !== html) this.netEl.innerHTML = html;
  }

  private netNotice(text: string): void {
    this.hud.tick(text, 6);
  }
  /** 연습장 느린 화면 (경기·온라인은 늘 1) */
  private timeScale = 1;

  /** UI로 게이지 취소. 온라인에서는 입력 기록 밖에서 경기 상태를 바꾸면 두 화면이 갈라지므로 하지 않는다 */
  private cancelCharge(): void {
    if (!this.lockstep) this.match.cancelUserCharge();
  }

  /** 온라인 경기: 메뉴 없이 바로 킥오프 */
  startOnline(): void {
    void this.startMatch();
    const me = this.match.localTeam;
    // 내 팀 표시: 점수판의 내 팀 약칭을 강조하고 시작 안내
    document.getElementById(me === 0 ? 'abbr-h' : 'abbr-a')?.classList.add('sb-me');
    setTimeout(() => this.hud.tick(`온라인 · 내 팀 ${me === 0 ? '홈' : '원정'} ${TEAMS[me].name}`, 4), 2400);
  }

  private async startMatch(): Promise<void> {
    if (this.playground) { this.playground.reset(); return; }
    this.menu.close();
    this.state = 'playing';
    this.hud.show(true);
    // 온라인: 경기 시간은 방장(팀 0) 설정
    this.match.duration = this.online ? this.online.start.prefs[0].duration : DURATIONS[this.durationIndex];
    const oldPlayers = [...this.match.players];
    // 온라인은 전달된 명단 없이 시작해 양쪽 모두 기본 선수를 유지한다.
    this.match.restart(this.online ? undefined : this.squad.lineups);
    for (const p of oldPlayers) if (!this.match.players.includes(p)) this.scene.remove(p.model.root);
    for (const p of this.match.players) this.scene.add(p.model.root);
    this.hud.tick(`${TEAMS[0].name} vs ${TEAMS[1].name}`, 2.2);
    await this.sound.unlock();
    this.sound.startAmbience();
  }

  private resume(): void {
    // 내가 건 온라인 일시정지면 풀기
    if (this.online && this.netPause?.team === this.online.start.team) this.online.session.requestPause(false);
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
    // 이 화면 사람의 팀 기준 (온라인 원정이면 팀 1)
    const me = this.match.localTeam;
    const mode: TouchMode = so.active && this.match.phase === 'shootout' ? (so.turn === me ? 'penalty' : 'keeper')
      : restart?.team === me ? restart.kind
      : restart?.kind === 'penalty' ? 'keeper'
      : this.match.localAttacking || this.match.ball.owner?.team === me ? 'attack' : 'defence';
    this.touch.update(this.state === 'playing', mode);
    // 온라인: 핑이 흔들리거나 상대 입력을 자주 기다리면 입력 지연을 늘리고, 안정되면 줄인다
    if (this.lockstep && !this.netPause) this.lockstep.adapt(dt, this.online!.session.rtt);
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
        this.accumulator += this.playground ? dt * this.timeScale : dt;
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
    this.interpolate(live);
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
      this.rig.attack = this.match.local.controlled.attackDir > 0 ? 1 : -1;
      this.rig.update(dt, this.match.ball.position, this.match.local.controlled.pos, celebrate);
      this.hud.update(dt, this.match, this.rig.camera);
    }
    this.lighting.update(this.rig.camera);
    this.updateLod();
    this.renderer.render(this.scene, this.rig.camera);
  }

  /**
   * 렌더 보간: 물리는 120Hz 고정 스텝이라 화면 주사율(60·144Hz 등)과 박자가 어긋나 떨려 보인다.
   * 남은 누적 시간 비율만큼 직전 스텝과 지금 스텝 사이 위치로 그린다 (한 스텝 늦게 보이는 대신 매끄럽다). 순간이동은 그대로
   */
  private interpolate(live: boolean): void {
    if (!live || this.playground) return;
    const a = THREE.MathUtils.clamp(this.accumulator / PHYSICS.step, 0, 1) - 1;
    for (const p of this.match.players) {
      const r = p.model.root.position;
      // 다리 IK 개인기는 발 목표가 판정 좌표라 몸만 늦추면 발이 미끄러진다
      if (!p.legPose && p.prevPos.distanceToSquared(p.pos) < 1) r.set(p.pos.x + (p.pos.x - p.prevPos.x) * a, 0, p.pos.z + (p.pos.z - p.prevPos.z) * a);
    }
    const b = this.match.ball, bp = b.position, o = b.object.position;
    if (!b.owner?.legPose && b.prevPos.distanceToSquared(o) < 1 && Math.abs(o.x - bp.x) < 1e-6 && Math.abs(o.z - bp.z) < 1e-6) {
      o.set(bp.x + (bp.x - b.prevPos.x) * a, bp.y + (bp.y - b.prevPos.y) * a, bp.z + (bp.z - b.prevPos.z) * a);
    }
  }

  /** 화면에서 키가 작게(약 120px 미만) 보이는 사람은 저폴리 메시로 그린다 (경계에서 깜빡이지 않게 여유를 둔다) */
  private updateLod(): void {
    const cam = this.rig.camera;
    const px = this.renderer.domElement.height / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const models = [...this.match.players.map((p) => p.model), ...this.match.officials.all.map((o) => o.model)];
    for (const m of models) {
      if (!m.setFar) continue;
      const h = (1.8 * px) / Math.max(0.1, cam.position.distanceTo(m.root.position));
      const far = h < (this.lodFar.has(m) ? 140 : 120);
      if (far) this.lodFar.add(m); else this.lodFar.delete(m);
      m.setFar(far);
    }
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
          this.hud.tick('골대를 맞혔어요!');
          this.rig.addShake(0.25);
          break;
        case 'net':
          this.sound.play('net', categoryVolume('ball', e.speed / 12));
          break;
        case 'save':
          this.sound.play('save', categoryVolume('body', 0.8));
          this.hud.tick(e.caught ? '골키퍼가 공을 잡았어요' : '골키퍼가 공을 쳐냈어요');
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
          this.hud.tick('어드밴티지 · 계속해요', 1.6);
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
        case 'run':
          // 내 팀 침투 지시만 알린다 (상대 화면에는 안 보이게)
          if (e.player.team === this.match.localTeam) this.hud.tick(`${e.player.profile.short} 침투해요`, 1);
          break;
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
            this.hud.tick('전반이 끝났어요', 2.4);
            // 온라인: 하프타임 메뉴로 멈추지 않는다 (경기가 정해진 시간 뒤 후반을 시작한다)
            if (this.lockstep) this.hud.tick('전반이 끝났어요. 잠시 뒤 후반을 시작해요.', 3);
            else setTimeout(() => {
              if (this.match.phase === 'halftime' && this.state === 'playing') this.openHalftime();
            }, 2200);
          } else if (this.match.phase === 'shootout') {
            this.sound.whistle([0.3, 0.3, 0.9]);
            this.hud.tick('동점이에요. 승부차기를 시작해요.', 3);
          } else {
            this.sound.whistle([0.3, 0.3, 0.9]);
            this.hud.tick('경기가 끝났어요', 3);
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

  private applyGraphics(touch: boolean): void {
    const quality = graphicsQuality(touch, navigator.hardwareConcurrency ?? 8);
    const profile = GRAPHICS[quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatio));
    this.lighting.setQuality(quality);
    this.stadium.setQuality(quality);
    for (const goal of this.match.goals) goal.setVisualQuality(quality);
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
