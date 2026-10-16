import * as THREE from 'three';
import { GRAPHICS, PHYSICS, PITCH } from '../config';
import { Input } from './Input';
import { TouchControls } from '../ui/TouchControls';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Stadium } from '../environment/Stadium';
import { Match, type UserCommand } from '../gameplay/Match';
import { CAMERA_LABEL, CameraRig } from '../camera/CameraRig';
import { Hud } from '../ui/Hud';
import { Menu, assistPanel, controlsPanel, matchupPanel, playerDetailPanel, squadPanel, statsPanel, type MenuScreen } from '../ui/Menu';
import { ASSIST_LABEL, MOVE_ASSIST_LABEL, GRAPHICS_LABEL, cycleAssist, cycleMoveAssist, cycleGraphics, graphicsQuality, settings, togglePhysicsPreset } from './Settings';
import { PRESET_LABEL, activePhysics } from '../physics/presets';
import { Sound } from '../audio/Sound';
import { TEAMS } from '../data/Teams';
import { RESTART_LABEL } from '../gameplay/SetPieces';
import { visualRandom } from './Random';

type AppState = 'menu' | 'playing' | 'paused' | 'result';

const DURATIONS = [120, 240, 360, 480];
const MENU_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace'];

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
  private readonly marker: THREE.Group;
  private readonly touch: TouchControls;
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

  constructor(canvas: HTMLCanvasElement) {
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

    this.match = new Match(this.physics);
    for (const g of this.match.goals) this.scene.add(g.group);
    for (const p of this.match.players) this.scene.add(p.model.root);
    this.scene.add(this.match.ball.object, this.match.ball.shadow);
    void this.match.ball.load('assets/ball/basic.glb');

    // 개발 중 콘솔에서 상태를 들여다보기 위한 훅
    if (import.meta.env.DEV) (window as unknown as { __game: unknown }).__game = { match: this.match, game: this, settings };

    this.marker = this.createMarker();
    this.scene.add(this.marker);

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && this.state === 'playing') this.hud.tick(this.toggleSound() ? '사운드 끔' : '사운드 켬');
    });

    this.touch = new TouchControls(this.input, () => this.match.cancelUserCharge(), () => this.applyGraphics(true), () => {
      if (this.state === 'playing') this.openPauseMenu();
    });
    this.applyGraphics(this.touch.detected);
    this.openMainMenu();
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
        panel: () => `<div class="card"><h3>PHYSICS PRESET</h3><p><b>실제</b> · 실측값 그대로. 공기 저항이 속도에 따라 급변하는 구간(drag crisis), 잔디 구름 저항 약 0.9 m/s², 반발 계수 0.62 (FIFA 잔디 시험 기준 범위).<br/><br/><b>아케이드</b> · 실제 값 위에 게임용 보정: 땅볼이 더 빨리 서고(놓친 공을 쫓아갈 수 있게), 커브가 조금 더 크고, 공기 저항을 평평하게 해서 로빙 거리를 예측하기 쉽게.<br/><br/>패스·슛 세기 보정은 아케이드 기준으로 맞춰져 있어서, 실제로 바꾸면 느린 로빙이나 칩슛이 조금 짧게 떨어질 수 있어요. 값은 <code>src/physics/presets.ts</code>에서 관리합니다.</p></div>`,
      },
      {
        id: 'moveAssist',
        label: '자동 전환 이동 보조',
        value: () => MOVE_ASSIST_LABEL[settings.moveAssist],
        onLeft: () => cycleMoveAssist(-1),
        onRight: () => cycleMoveAssist(1),
        panel: () => `<div class="card"><h3>AUTO SWITCHING MOVE ASSISTANCE</h3><p>패스로 받는 선수가 바뀐 직후, 얼마 동안 AI가 받으러 가는 움직임을 유지할지 정합니다 (FC의 같은 이름 설정).<br/><br/><b>높음</b> · 0.55초 · <b>낮음</b> · 0.25초 · <b>없음</b> · 바로 내 입력<br/><br/>어떤 설정이든 방향키가 공 쪽을 향하면 공을 가로챌 지점으로 가서 그 앞에서 멈추므로 공을 지나치지 않고, 입력 없이 두면 자동으로 받으러 갑니다. 받는 순간 누르고 있던 방향으로 첫 터치를 합니다.</p></div>`,
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
        panel: () => `<div class="card"><h3>CAMERA</h3><p><b>TV 중계</b>는 FIFA 기본 카메라처럼 관중석 높은 곳에서 망원으로 당겨 찍어 선수가 크게 보이고, <b>넓은 중계</b>는 가까이서 넓게, <b>선수 뒤</b>는 공격 방향을 정면으로 봅니다. 경기 중 <kbd>V</kbd> 로도 바꿀 수 있어요.</p></div>`,
      },
      {
        id: 'sound',
        label: '사운드',
        value: () => (this.sound.muted ? '끔' : '켬'),
        onLeft: () => this.toggleSound(),
        onRight: () => this.toggleSound(),
        panel: () => `<div class="card"><h3>AUDIO</h3><p>효과음과 관중 소리를 켜거나 끕니다. 경기 중 <kbd>M</kbd> 키로도 바꿀 수 있어요.</p></div>`,
      },
      {
        id: 'graphics',
        label: '그래픽 품질',
        value: () => GRAPHICS_LABEL[settings.graphicsQuality],
        onLeft: () => { cycleGraphics(-1); this.applyGraphics(this.touch.detected); },
        onRight: () => { cycleGraphics(1); this.applyGraphics(this.touch.detected); },
        panel: () => `<div class="card"><h3>GRAPHICS</h3><p>자동은 터치 기기 또는 CPU 4코어 이하에서 낮음으로 동작합니다. 낮음은 픽셀 비율 최대 1.25, 그림자 1024, 관중 25%로 줄입니다. 높음은 픽셀 비율 최대 2, 그림자 2048, 전체 관중을 표시합니다.</p></div>`,
      },
      { id: 'controls', label: '조작법', panel: controlsPanel, onSelect: () => {} },
    ];
  }

  private openMainMenu(): void {
    this.state = 'menu';
    this.hud.show(false);
    const lengthLabel = () => `${DURATIONS[this.durationIndex] / 60}분`;
    this.menu.open({
      eyebrow: 'SNAPSHOOT CLASSIC · 11 VS 11',
      title: 'KICK OFF',
      panel: () => matchupPanel(null, [`경기 시간 ${lengthLabel()}`, '중계 · 11대11 · 4-3-3', TEAMS[0].name + ' 홈']),
      items: [
        { id: 'start', label: '경기 시작', onSelect: () => void this.startMatch() },
        {
          id: 'length',
          label: '경기 시간',
          value: lengthLabel,
          onLeft: () => (this.durationIndex = (this.durationIndex + DURATIONS.length - 1) % DURATIONS.length),
          onRight: () => (this.durationIndex = (this.durationIndex + 1) % DURATIONS.length),
        },
        ...this.settingsItems(),
        {
          id: 'snapshoot',
          label: 'SnapShoot 승부차기 ↗',
          onSelect: () => window.open('https://inticoy.github.io/snapshoot', '_blank', 'noopener'),
          panel: () => `<div class="card"><h3>SNAPSHOOT</h3><p>스와이프 한 번으로 차는 승부차기 게임. 같은 SnapShoot 시리즈예요. 나중에 이 게임의 승부차기 모드로 합쳐질 예정입니다.</p></div>`,
        },
      ],
    });
  }

  private openPauseMenu(): void {
    this.state = 'paused';
    this.match.cancelUserCharge();
    this.input.clearVirtual();
    const [h, a] = this.match.score;
    this.menu.open({
      eyebrow: `PAUSED · ${this.clockText()}`,
      title: 'PAUSE',
      panel: () => statsPanel(this.match.stats, [h, a], `경기 진행 ${this.clockText()}`),
      onBack: () => this.resume(),
      items: [
        { id: 'resume', label: '계속하기', onSelect: () => this.resume() },
        { id: 'restart', label: '다시 시작', onSelect: () => void this.startMatch() },
        ...this.settingsItems(),
        { id: 'quit', label: '메인 메뉴', onSelect: () => this.openMainMenu() },
      ],
    });
  }

  private openResult(): void {
    this.state = 'result';
    this.hud.show(false);
    const [h, a] = this.match.score;
    const verdict = h > a ? '승리' : h < a ? '패배' : '무승부';
    this.menu.open({
      eyebrow: `FULL TIME · ${verdict}`,
      title: h > a ? 'VICTORY' : h < a ? 'DEFEAT' : 'DRAW',
      panel: () => statsPanel(this.match.stats, [h, a], `경기 종료 · ${verdict}`),
      items: [
        { id: 'again', label: '다시 하기', onSelect: () => void this.startMatch() },
        { id: 'menu', label: '메인 메뉴', onSelect: () => this.openMainMenu() },
      ],
    });
  }

  private clockText(): string {
    return `${Math.min(90, Math.floor((this.match.clock / this.match.duration) * 90))}'`;
  }

  private async startMatch(): Promise<void> {
    this.menu.close();
    this.state = 'playing';
    this.hud.show(true);
    this.match.duration = DURATIONS[this.durationIndex];
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
    const restart = this.match.setPieces.current;
    const mode = restart?.team === 0 ? restart.kind
      : this.match.userAttacking || this.match.ball.owner?.team === 0 ? 'attack' : 'defence';
    this.touch.update(this.state === 'playing', mode);
    const menuWasVisible = this.menu.visible;
    if (menuWasVisible) {
      for (const code of this.input.drainPresses()) if (MENU_KEYS.includes(code)) this.menu.handleKey(code);
      this.input.endFrame();
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
          this.match.update(PHYSICS.step, this.cmd);
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
      p.syncVisual(live ? dt : 0, live ? distance : 0);
    }
    this.match.ball.syncVisual();
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
      this.rig.update(dt, this.match.ball.position, this.match.controlled.pos, celebrate);
      this.hud.update(dt, this.match, this.rig.camera);
    }
    this.renderer.render(this.scene, this.rig.camera);
  }

  private buildCommand(): void {
    const axis = this.input.moveAxis();
    const f = this.rig.forward(new THREE.Vector3());
    const r = this.rig.right(new THREE.Vector3());
    this.cmd.move.set(0, 0, 0).addScaledVector(f, axis.y).addScaledVector(r, axis.x);
    this.cmd.sprint = this.input.isDown('sprint');
    this.cmd.shoot = this.input.button('shoot');
    this.cmd.pass = this.input.button('pass');
    this.cmd.through = this.input.button('through');
    this.cmd.lob = this.input.button('lob');
    this.cmd.modifier = this.input.button('modifier');
    this.cmd.tackle = this.input.button('tackle');
    this.cmd.finesse = this.input.button('finesse');
    this.cmd.contain = this.input.button('contain');
  }

  private handleEvents(): void {
    for (const e of this.match.events) {
      if (import.meta.env.DEV && e.type !== 'bounce') console.debug('[event]', e.type, JSON.stringify({ ...e, scorer: undefined }));
      switch (e.type) {
        case 'kick':
          this.sound.play('kick', Math.min(1, 0.35 + e.speed / 30), 0.9 + visualRandom.next() * 0.2);
          break;
        case 'bounce':
          this.sound.play('bounce', Math.min(0.8, e.speed / 12));
          break;
        case 'post':
          this.sound.play('post', Math.min(1, e.speed / 15));
          this.hud.tick('골대 강타!');
          this.rig.addShake(0.25);
          break;
        case 'net':
          this.sound.play('net', Math.min(1, e.speed / 12));
          break;
        case 'save':
          this.sound.play('save', 0.8);
          this.hud.tick(e.caught ? '골키퍼 선방 · 캐치' : '골키퍼 선방 · 펀칭');
          this.stadium.cheer(0.4);
          break;
        case 'tackle':
          if (e.success) this.sound.play('bounce', 0.6, 0.7);
          break;
        case 'goal': {
          this.sound.play('goal', 1);
          this.sound.play('cheer', 0.9);
          this.sound.setAmbienceLevel(0.4);
          setTimeout(() => this.sound.setAmbienceLevel(0.18), 4000);
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
        case 'whistle':
          if (e.kind === 'kickoff') this.sound.whistle([0.45]);
          else {
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
    const p = this.match.controlled;
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

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.applyGraphics(this.touch?.detected ?? window.matchMedia('(pointer: coarse)').matches);
    this.renderer.setSize(w, h, false);
    this.rig.resize(w / h);
  }
}
