import * as THREE from 'three';
import { PHYSICS, PITCH, TEAM_COLORS } from '../config';
import { Input } from './Input';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Stadium } from '../environment/Stadium';
import { Match, type UserCommand } from '../gameplay/Match';
import { CameraRig } from '../camera/CameraRig';
import { Hud } from '../ui/Hud';
import { Sound } from '../audio/Sound';

type AppState = 'title' | 'playing' | 'paused';

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly input = new Input();
  private readonly physics = new PhysicsWorld();
  private readonly stadium: Stadium;
  private readonly match: Match;
  private readonly rig: CameraRig;
  private readonly hud = new Hud();
  private readonly sound = new Sound();
  private readonly marker: THREE.Group;
  private readonly overlay = document.getElementById('overlay')!;
  private readonly overlaySub = document.getElementById('overlay-sub')!;
  private readonly startBtn = document.getElementById('start-btn')!;

  private state: AppState = 'title';
  private accumulator = 0;
  private last = performance.now();
  private readonly cmd: UserCommand = {
    move: new THREE.Vector3(),
    sprint: false,
    shootHeld: false,
    shootPressed: false,
    shootReleased: false,
    finesseHeld: false,
    finessePressed: false,
    finesseReleased: false,
    passPressed: false,
    switchPressed: false,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    if (import.meta.env.DEV) (window as unknown as { __game: unknown }).__game = { match: this.match, game: this };

    this.marker = this.createMarker();
    this.scene.add(this.marker);

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.startBtn.addEventListener('click', () => this.start());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.hud.flash(this.sound.toggleMute() ? '소리 끔' : '소리 켬', 1, true);
    });
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

  private async start(): Promise<void> {
    if (this.state === 'playing') return;
    const fresh = this.state === 'title' || this.match.phase === 'fulltime';
    this.state = 'playing';
    this.overlay.classList.add('hidden');
    this.hud.show(true);
    await this.sound.unlock();
    this.sound.startAmbience();
    if (fresh) {
      this.match.restart();
      this.hud.flash('KICK OFF', 1.4, true);
    }
  }

  private pause(): void {
    this.state = 'paused';
    this.overlaySub.textContent = '일시정지';
    this.startBtn.textContent = 'Enter 또는 클릭해서 계속';
    this.overlay.classList.remove('hidden');
  }

  private frame(dt: number): void {
    // 메뉴 조작
    if (this.input.wasPressed('start') && this.state !== 'playing') void this.start();
    if (this.input.wasPressed('pause') && this.state === 'playing' && this.match.phase !== 'fulltime') this.pause();
    if (this.input.wasPressed('camera')) {
      this.hud.flash(this.rig.toggle() === 'pro' ? '선수 뒤 카메라' : '중계 카메라', 1, true);
    }
    if (this.state === 'playing' && this.match.phase === 'fulltime' && this.input.wasPressed('start')) {
      this.match.restart();
    }

    if (this.state === 'playing') {
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
    } else {
      this.input.endFrame();
      // 타이틀 화면에서는 경기장을 천천히 둘러본다
      if (this.state === 'title') {
        const t = performance.now() / 1000;
        this.rig.camera.position.set(Math.sin(t * 0.08) * 48, 22, Math.cos(t * 0.08) * 40);
        this.rig.camera.lookAt(0, 0, 0);
      }
    }

    // 시각 동기화
    for (const p of this.match.players) p.syncVisual(this.state === 'playing' ? dt : 0);
    this.match.ball.syncVisual();
    this.stadium.update(dt);
    this.updateMarker(dt);

    if (this.state !== 'title') {
      const celebrate = this.match.phase === 'goal' && this.match.phaseTimer < 2.6 ? this.match.lastScorer?.pos ?? null : null;
      if (this.state === 'playing') this.rig.update(dt, this.match.ball.position, this.match.controlled.pos, celebrate);
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
    this.cmd.shootHeld = this.input.isDown('shoot');
    this.cmd.shootPressed = this.input.wasPressed('shoot');
    this.cmd.shootReleased = this.input.wasReleased('shoot');
    this.cmd.finesseHeld = this.input.isDown('finesse');
    this.cmd.finessePressed = this.input.wasPressed('finesse');
    this.cmd.finesseReleased = this.input.wasReleased('finesse');
    this.cmd.passPressed = this.input.wasPressed('pass');
    this.cmd.switchPressed = this.input.wasPressed('switch');
  }

  private handleEvents(): void {
    for (const e of this.match.events) {
      if (import.meta.env.DEV && e.type !== 'bounce') console.debug('[event]', e.type, JSON.stringify({ ...e, scorer: undefined }));
      switch (e.type) {
        case 'kick':
          this.sound.play('kick', Math.min(1, 0.35 + e.speed / 30), 0.9 + Math.random() * 0.2);
          break;
        case 'bounce':
          this.sound.play('bounce', Math.min(0.8, e.speed / 12));
          break;
        case 'post':
          this.sound.play('post', Math.min(1, e.speed / 15));
          this.hud.flash('골대!', 1.2, true);
          this.rig.addShake(0.25);
          break;
        case 'net':
          this.sound.play('net', Math.min(1, e.speed / 12));
          break;
        case 'save':
          this.sound.play('save', 0.8);
          this.hud.flash(e.caught ? '선방!' : '쳐냈다!', 1.2, true);
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
          const who = e.scorer ? `${e.scorer.number} ${e.scorer.name}` : '';
          this.hud.flash(e.ownGoal ? 'OWN GOAL' : 'GOAL!', 2.6);
          if (who && !e.ownGoal) setTimeout(() => this.hud.flash(`${TEAM_COLORS[e.team].name} · ${who}`, 1.4, true), 1500);
          break;
        }
        case 'whistle':
          if (e.kind === 'kickoff') this.sound.whistle([0.45]);
          else {
            this.sound.whistle([0.3, 0.3, 0.9]);
            const [h, a] = this.match.score;
            this.hud.flash(h > a ? 'YOU WIN' : h < a ? 'YOU LOSE' : 'DRAW', 4);
            setTimeout(() => {
              if (this.match.phase !== 'fulltime') return;
              this.overlaySub.textContent = `경기 종료 · HOME ${h} - ${a} AWAY`;
              this.startBtn.textContent = 'Enter 또는 클릭해서 다시 하기';
              this.overlay.classList.remove('hidden');
              this.state = 'paused';
            }, 3500);
          }
          break;
      }
    }
    this.match.events.length = 0;
  }

  private createMarker(): THREE.Group {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 32),
      new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    // 바라보는 방향 표시
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.36, 3),
      new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0.02, 0.85);
    g.add(arrow);
    return g;
  }

  private updateMarker(dt: number): void {
    const p = this.match.controlled;
    const visible = this.state !== 'title' && this.match.phase !== 'goal';
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
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    sun.position.set(-25, 45, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -PITCH.halfL - 6;
    s.right = PITCH.halfL + 6;
    s.top = PITCH.halfW + 6;
    s.bottom = -PITCH.halfW - 6;
    s.near = 1;
    s.far = 120;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    // 반대편 보조광 (조명탑 느낌)
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
    fill.position.set(30, 30, -25);
    this.scene.add(fill);
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w / h);
  }
}
