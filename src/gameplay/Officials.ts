import * as THREE from 'three';
import { PITCH } from '../config';
import { appearance } from '../data/Appearance';
import { createPlayerModel, type PlayerModelFactory } from '../entities/Player';
import type { CharacterModel, Gesture, ModelColors } from '../entities/PlayerModel';
import type { Match } from './Match';

/**
 * 심판진 (화면 연출 전용, 경기 판정에는 영향 없음).
 *  주심: 대각선 시스템. 공 소유 팀 진영 쪽 뒤, 공에서 10m 남짓 떨어져 선수와 겹치지 않게
 *  부심 2명: 터치라인 하나씩, 경기장 절반씩 맡아 뒤에서 두 번째 수비수(오프사이드 라인)와 나란히
 *  카드 → 주심이 반칙한 선수에게 다가가 카드를 든다 / 오프사이드 → 해당 부심이 깃발을 든다
 */
const KIT: ModelColors = { shirt: 0x17191f, shorts: 0x17191f, socks: 0x17191f, style: 1, trim: 0xe6c300 };
const NAMES = ['Referee Park', 'Assistant Lee', 'Assistant Moon'];
const RUN = 6.2;
const tmp = new THREE.Vector3();

export class Official {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly facing = new THREE.Vector3(0, 0, 1);
  readonly model: CharacterModel;
  /** 손에 쥔 물건 (카드 / 깃발) */
  readonly item: THREE.Mesh;
  gesture: Gesture = 'none';
  gestureTimer = 0;
  /** 카드를 손에 들고 있는 남은 시간 */
  showCard = 0;

  constructor(readonly role: 'referee' | 'assistant', name: string, factory: PlayerModelFactory, item: THREE.Mesh) {
    const look = appearance(name);
    this.model = factory({ ...KIT, skin: look.skin, hair: look.hair, hairStyle: look.hairStyle, decal: { number: 0, name: '', ink: '#fff', inkEdge: '#000', look } }, 0, false);
    this.item = item;
  }

  moveTo(target: THREE.Vector3, dt: number, look: THREE.Vector3 | null): void {
    tmp.subVectors(target, this.pos).setY(0);
    const d = tmp.length();
    const speed = d > 6 ? RUN : Math.min(RUN * 0.6, d * 1.5);
    const desired = d > 0.15 ? tmp.multiplyScalar(speed / d) : tmp.set(0, 0, 0);
    // 가속을 제한해 순간 이동처럼 보이지 않게
    const diff = desired.sub(this.vel);
    const max = 8 * dt;
    if (diff.length() > max) diff.setLength(max);
    this.vel.add(diff);
    this.pos.addScaledVector(this.vel, dt);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (look) {
      const lx = look.x - this.pos.x, lz = look.z - this.pos.z;
      const l = Math.hypot(lx, lz);
      if (l > 0.1) this.facing.lerp(tmp.set(lx / l, 0, lz / l), Math.min(1, dt * 6)).normalize();
    } else if (sp > 0.5) this.facing.lerp(tmp.set(this.vel.x / sp, 0, this.vel.z / sp), Math.min(1, dt * 6)).normalize();
  }

  syncVisual(dt: number): void {
    this.model.root.position.set(this.pos.x, 0, this.pos.z);
    this.model.root.rotation.y = Math.atan2(this.facing.x, this.facing.z);
    this.model.setLocomotion(Math.hypot(this.vel.x, this.vel.z), false);
    const base = Math.hypot(this.vel.x, this.vel.z) > 0.6 ? 'run' : 'idle';
    if (this.model.current !== base) this.model.play(base);
    this.model.setGesture?.(this.gesture);
    this.model.update(dt);
    // 카드는 든 손에, 깃발은 평소에도 손에 쥐고 있다
    this.showCard = Math.max(0, this.showCard - dt);
    const showItem = this.role === 'assistant' || this.gesture === 'raise' || this.showCard > 0;
    this.item.visible = showItem && !!this.model.handPosition;
    if (this.item.visible) {
      // 모션캡처 카드 동작은 왼손으로 든다
      this.model.handPosition!(this.item.position, this.showCard > 0 && this.gesture !== 'raise' ? 'L' : 'R');
      if (this.role === 'assistant') this.item.position.y += this.gesture === 'raise' ? 0.25 : -0.25;
      else this.item.position.y += 0.08;
      this.item.rotation.y = this.model.root.rotation.y;
    }
  }
}

function cardMesh(): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.12), mat);
  m.visible = false;
  return m;
}

function flagMesh(): THREE.Mesh {
  // 빨강·노랑 체크 깃발 (막대 생략, 작은 사각형)
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = (x + y) % 2 ? '#e0242f' : '#ffd400';
    g.fillRect(x * 8, y * 8, 8, 8);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.26), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
  m.visible = false;
  return m;
}

export class Officials {
  readonly referee: Official;
  /** [+Z 터치라인(+X 쪽 절반), -Z 터치라인(-X 쪽 절반)] */
  readonly assistants: [Official, Official];
  private cursor = 0;
  private cardTarget: THREE.Vector3 | null = null;

  constructor(private readonly m: Match, factory: PlayerModelFactory = createPlayerModel) {
    const canvasOk = typeof document !== 'undefined';
    const item = (f: () => THREE.Mesh) => (canvasOk ? f() : new THREE.Mesh());
    this.referee = new Official('referee', NAMES[0], factory, item(cardMesh));
    this.assistants = [
      new Official('assistant', NAMES[1], factory, item(flagMesh)),
      new Official('assistant', NAMES[2], factory, item(flagMesh)),
    ];
    this.reset();
  }

  get all(): Official[] {
    return [this.referee, ...this.assistants];
  }

  /** 킥오프 위치: 주심은 센터서클 가장자리, 부심은 하프라인 근처 터치라인 */
  reset(): void {
    this.referee.pos.set(-4, 0, -6);
    this.assistants[0].pos.set(8, 0, PITCH.halfW + 1.2);
    this.assistants[1].pos.set(-8, 0, -PITCH.halfW - 1.2);
    for (const o of this.all) {
      o.vel.set(0, 0, 0);
      o.gesture = 'none';
      o.gestureTimer = 0;
    }
    this.cardTarget = null;
  }

  update(dt: number): void {
    const m = this.m;
    this.readEvents();
    const bp = m.ball.position;
    const ball = tmp.set(bp.x, 0, bp.z).clone();
    for (const o of this.all) {
      if (o.gestureTimer > 0 && (o.gestureTimer -= dt) <= 0) o.gesture = 'none';
    }

    // 주심
    const holder = m.ball.owner ?? m.ball.lastTouch;
    const dir = holder ? holder.attackDir : 1;
    const ref = this.referee;
    let target: THREE.Vector3;
    if (this.cardTarget) {
      target = this.cardTarget.clone().add(new THREE.Vector3(-1.6 * dir, 0, 0.8));
    } else if (m.phase === 'kickoff') {
      target = new THREE.Vector3(-4, 0, -6);
    } else {
      // 공의 뒤쪽(소유 팀 진영)·반대쪽 사선, 경기장 안
      const side = bp.z > 0 ? -1 : 1;
      target = new THREE.Vector3(
        THREE.MathUtils.clamp(bp.x - dir * 9, -PITCH.halfL + 12, PITCH.halfL - 12),
        0,
        THREE.MathUtils.clamp(bp.z + side * 9, -PITCH.halfW + 4, PITCH.halfW - 4),
      );
      // 선수와 겹치지 않게 비켜 선다
      for (const p of m.players) {
        const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.5 && d > 0.01) target.addScaledVector(new THREE.Vector3(dx / d, 0, dz / d), 2.5 - d);
      }
    }
    ref.moveTo(target, dt, this.cardTarget ?? ball);

    // 부심: 맡은 절반에서 오프사이드 라인(또는 공이 더 깊으면 공)과 나란히
    for (const [i, a] of this.assistants.entries()) {
      const end = i === 0 ? 1 : -1;
      const z = end * (PITCH.halfW + 1.2);
      const attacking = m.teams[0][0].attackDir === end ? 0 : 1;
      const line = m.rules.offsideLine(attacking) * end;
      let x = end > 0 ? Math.max(line, bp.x) : Math.min(line, bp.x);
      if (m.phase === 'kickoff') x = end * 8;
      x = THREE.MathUtils.clamp(x, end > 0 ? 0 : -PITCH.halfL, end > 0 ? PITCH.halfL : 0);
      // 깃발을 든 동안은 제자리
      const t = a.gesture === 'raise' ? a.pos.clone() : new THREE.Vector3(x, 0, z);
      a.moveTo(t, dt, new THREE.Vector3(a.pos.x, 0, 0));
    }
  }

  private readEvents(): void {
    const ev = this.m.events;
    if (this.cursor > ev.length) this.cursor = 0; // Game이 이벤트를 비웠다
    for (; this.cursor < ev.length; this.cursor++) {
      const e = ev[this.cursor];
      if (e.type === 'card') {
        const card = this.referee.item.material as THREE.MeshBasicMaterial;
        card.color.set(e.card === 'red' ? 0xe0242f : 0xffd400);
        // 모션캡처 카드 동작이 있으면 그걸로, 없으면 팔 들기
        const played = this.referee.model.playMotion?.(e.card === 'red' ? 'mc_card_red' : 'mc_card_yellow', { startAt: 0.1 });
        this.referee.gesture = played ? 'none' : 'raise';
        this.referee.showCard = 2.8;
        this.referee.gestureTimer = 2.8;
        this.cardTarget = e.player.pos.clone();
      } else if (e.type === 'foul' || e.type === 'advantage') {
        if (this.referee.gesture === 'none') {
          this.referee.gesture = 'point';
          this.referee.gestureTimer = e.type === 'advantage' ? 1.2 : 1.6;
        }
      } else if (e.type === 'offside') {
        const a = this.assistants[e.player.pos.x >= 0 ? 0 : 1];
        a.gesture = 'raise';
        a.gestureTimer = 2.4;
      } else if (e.type === 'whistle' && e.kind === 'kickoff') {
        this.cardTarget = null;
      }
    }
    if (this.cardTarget && this.referee.gestureTimer <= 0) this.cardTarget = null;
  }

  syncVisual(dt: number): void {
    for (const o of this.all) o.syncVisual(dt);
  }
}
