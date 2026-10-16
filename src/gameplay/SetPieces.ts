import * as THREE from 'three';
import { BALL, PASS, PITCH } from '../config';
import type { Player } from '../entities/Player';
import type { Match, UserCommand, KickKind } from './Match';

export type RestartKind = 'throwin' | 'corner' | 'goalkick';

export const RESTART_LABEL: Record<RestartKind, string> = {
  throwin: '스로인',
  corner: '코너킥',
  goalkick: '골킥',
};

export interface SetPiece {
  kind: RestartKind;
  team: 0 | 1;
  spot: THREE.Vector3;
  taker: Player;
  /** 준비 후 경과 시간 */
  timer: number;
  ready: boolean;
}

const OUT_DELAY = 1.1; // 공이 나간 뒤 재개 준비까지
const AI_TAKE_DELAY = 1.3;
const tmp = new THREE.Vector3();

/**
 * 아웃 판정과 세트피스(스로인 / 코너킥 / 골킥).
 *  - 터치라인을 완전히 넘으면 마지막으로 건드린 팀의 상대 스로인
 *  - 골라인을 넘었는데 골이 아니면: 수비팀이 마지막 터치 → 코너킥, 공격팀 → 골킥
 *
 * 사용자 팀이 차는 경우 방향키로 조준하고
 *  스로인: S 짧게 / A·W 길게,  코너킥·골킥: S 짧은 패스 / A·W·D 띄워서 (게이지)
 */
export class SetPieces {
  current: SetPiece | null = null;
  private outTimer = 0;

  constructor(private readonly m: Match) {}

  /** playing 중 매 스텝 호출. 아웃이면 true */
  checkOut(): boolean {
    const bp = this.m.ball.position;
    const r = BALL.radius;
    const last = this.m.ball.lastTouch;
    if (Math.abs(bp.z) > PITCH.halfW + r) {
      const team = (last ? 1 - last.team : 0) as 0 | 1;
      const x = THREE.MathUtils.clamp(bp.x, -PITCH.halfL + 1, PITCH.halfL - 1);
      this.begin('throwin', team, new THREE.Vector3(x, 0, Math.sign(bp.z) * PITCH.halfW));
      return true;
    }
    if (Math.abs(bp.x) > PITCH.halfL + r) {
      // 골문 안이면 골 판정이 먼저 처리된다
      const end = Math.sign(bp.x);
      const defending = (end > 0 ? 1 : 0) as 0 | 1; // +X 골대는 원정팀(1)이 지킨다
      const side = Math.sign(bp.z) || 1;
      if (last && last.team === defending) {
        const attacking = (1 - defending) as 0 | 1;
        this.begin('corner', attacking, new THREE.Vector3(end * (PITCH.halfL - 0.25), 0, side * (PITCH.halfW - 0.25)));
      } else {
        this.begin('goalkick', defending, new THREE.Vector3(end * (PITCH.halfL - 3), 0, side * 2.5));
      }
      return true;
    }
    return false;
  }

  private begin(kind: RestartKind, team: 0 | 1, spot: THREE.Vector3): void {
    const m = this.m;
    m.phase = 'out';
    this.outTimer = OUT_DELAY;
    m.charge = null;
    m.passTarget = null;
    m.ball.owner = null;
    m.ball.shot = null;
    const taker = this.pickTaker(kind, team, spot);
    this.current = { kind, team, spot, taker, timer: 0, ready: false };
    m.events.push({ type: 'out', kind, team });
  }

  private pickTaker(kind: RestartKind, team: 0 | 1, spot: THREE.Vector3): Player {
    const squad = this.m.teams[team];
    if (kind === 'goalkick') return squad[0];
    // 가장 가까운 필드 플레이어
    let best = squad[1];
    let bestD = Infinity;
    for (const p of squad) {
      if (p.isKeeper) continue;
      const d = p.pos.distanceTo(spot);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** 'out' / 'setpiece' 단계 업데이트 */
  update(dt: number, cmd: UserCommand): void {
    const m = this.m;
    const sp = this.current!;
    if (m.phase === 'out') {
      // 공은 굴러가게 두고 선수들은 멈춘다
      for (const p of m.players) {
        p.steer(tmp.set(0, 0, 0), false, false, dt);
        p.update(dt);
      }
      m.stepWorld(dt);
      this.outTimer -= dt;
      if (this.outTimer <= 0) this.setup(sp);
      return;
    }

    // setpiece: 키커가 찰 때까지 대기
    sp.timer += dt;
    for (const p of m.players) {
      p.steer(tmp.set(0, 0, 0), false, false, dt);
      p.update(dt);
    }
    this.holdBall(sp);
    const t = sp.taker;
    const userTakes = m.isUserControlled(t);

    if (userTakes) {
      // 방향키로 조준 (제자리에서 몸만 돌린다)
      if (cmd.move.lengthSq() > 0.01) {
        const target = Math.atan2(cmd.move.x, cmd.move.z);
        const cur = Math.atan2(t.facing.x, t.facing.z);
        let d = target - cur;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const a = cur + THREE.MathUtils.clamp(d, -4 * dt, 4 * dt);
        t.facing.set(Math.sin(a), 0, Math.cos(a));
      }
      if (sp.timer < 0.4) return; // 준비 직후 오입력 방지
      if (!m.charge) {
        for (const kind of ['pass', 'lob', 'through', 'shoot'] as KickKind[]) {
          if (cmd[kind].pressed) {
            m.charge = { kind, value: 0, finesse: false, chip: false };
            break;
          }
        }
      }
      if (m.charge) {
        const btn = cmd[m.charge.kind];
        m.charge.value = Math.min(1, m.charge.value + dt / PASS.chargeTime);
        if (btn.released || !btn.held) {
          const { kind, value } = m.charge;
          m.charge = null;
          this.take(kind === 'pass' ? 'short' : 'long', value, t.facing.clone());
        }
      }
    } else if (sp.timer > AI_TAKE_DELAY) {
      this.aiTake(sp);
    }
  }

  /** 세트피스 위치로 선수와 공을 배치 */
  private setup(sp: SetPiece): void {
    const m = this.m;
    m.phase = 'setpiece';
    sp.ready = true;
    sp.timer = 0;
    const { kind, team, spot, taker } = sp;
    const att = m.teams[team];
    const def = m.teams[1 - team];
    const a = att[0].attackDir;

    for (const p of m.players) {
      p.vel.set(0, 0, 0);
      p.stunned = p.tackleTimer = p.diveTimer = 0;
      p.kickCooldown = 0;
      p.basePose = null;
    }

    // 키커: 공 뒤에서 경기장 안쪽을 바라본다
    const inward = new THREE.Vector3(-spot.x, 0, -spot.z).normalize();
    if (kind === 'throwin') inward.set(a * 0.5, 0, -Math.sign(spot.z)).normalize();
    if (kind === 'goalkick') inward.set(a, 0, 0);
    taker.pos.copy(spot).addScaledVector(inward, kind === 'throwin' ? -0.25 : -0.6);
    taker.facing.copy(inward);

    if (kind === 'corner') {
      // 공격: 페널티 스팟 근처 / 수비: 대인 마크 + 키퍼는 골라인
      const end = Math.sign(spot.x);
      const box = end * (PITCH.halfL - 7);
      const others = att.filter((p) => p !== taker && !p.isKeeper);
      others.forEach((p, i) => p.pos.set(box - end * i * 4, 0, (i === 0 ? -1 : 1) * 1.5));
      att[0].pos.set(m.ownGoalX(team) + a * 1, 0, 0);
      const defOut = def.filter((p) => !p.isKeeper);
      defOut.forEach((p, i) => {
        const mark = others[i] ?? others[0];
        p.pos.set(mark.pos.x + end * 0.9, 0, mark.pos.z + (i === 0 ? 0.6 : -0.6));
      });
      def[0].pos.set(end * (PITCH.halfL - 0.6), 0, Math.sign(spot.z) * 0.8);
    } else if (kind === 'goalkick') {
      // 차는 팀은 넓게 벌리고, 상대는 페널티 박스 밖으로
      const own = m.ownGoalX(team);
      att[1].pos.set(own + a * 14, 0, -spot.z * 3);
      att[2].pos.set(a * 4, 0, spot.z * 3);
      def[1].pos.set(a * 2, 0, -spot.z * 2);
      def[2].pos.set(own + a * (PITCH.boxDepth + 4), 0, spot.z * 1.5);
      def[0].pos.set(-own + -a * 0.8, 0, 0);
    } else {
      // 스로인: 동료 한 명은 가까이 받으러, 상대는 2m 이상 떨어져서 마크
      const side = Math.sign(spot.z);
      const mate = att.find((p) => p !== taker && !p.isKeeper)!;
      mate.pos.set(THREE.MathUtils.clamp(spot.x + a * 5, -PITCH.halfL + 2, PITCH.halfL - 2), 0, spot.z - side * 6);
      for (const d of def) {
        if (d.isKeeper) continue;
        if (d.pos.distanceTo(spot) < 3) d.pos.copy(spot).addScaledVector(new THREE.Vector3(0, 0, -side), 3.5);
      }
      const marker = def.find((p) => !p.isKeeper && p !== def[0]);
      if (marker) marker.pos.set(mate.pos.x + a * 1.2, 0, mate.pos.z + side * 0.8);
    }
    // 모두 공을 바라본다
    for (const p of m.players) if (p !== taker) p.faceTowards(spot.x, spot.z);

    // 사용자 팀이면 키커를 조종 (골킥은 키퍼)
    if (team === 0) m.controlled = taker;
    else if (m.controlled.isKeeper) m.switchToNearest();

    m.ball.owner = null;
    m.ball.lastTouch = taker;
    m.ball.body.velocity.setZero();
    m.ball.body.angularVelocity.setZero();
    if (kind === 'throwin') taker.basePose = 'hold';
    this.holdBall(sp);
    m.events.push({ type: 'restart', kind, team });
  }

  /** 공을 키커 손(스로인) 또는 지정 위치(코너/골킥)에 고정 */
  private holdBall(sp: SetPiece): void {
    const b = this.m.ball.body;
    if (sp.kind === 'throwin') {
      const t = sp.taker;
      b.position.set(t.pos.x + t.facing.x * 0.15, 2.15, t.pos.z + t.facing.z * 0.15);
    } else {
      b.position.set(sp.spot.x, BALL.radius, sp.spot.z);
    }
    b.velocity.setZero();
    b.angularVelocity.setZero();
  }

  private aiTake(sp: SetPiece): void {
    const m = this.m;
    const t = sp.taker;
    const mates = m.teams[sp.team].filter((p) => p !== t && !p.isKeeper);
    if (sp.kind === 'corner') {
      // 박스 안 동료에게 크로스
      const target = mates[0];
      t.faceTowards(target.pos.x, target.pos.z);
      this.take('long', 0.55, tmp.set(target.pos.x - t.pos.x, 0, target.pos.z - t.pos.z).normalize().clone());
      return;
    }
    // 가장 열린 동료
    mates.sort((x, y) => m.openness(y) - m.openness(x));
    const target = mates[0];
    const dist = target.pos.distanceTo(t.pos);
    t.faceTowards(target.pos.x, target.pos.z);
    this.take(dist > 16 ? 'long' : 'short', 0.5, tmp.set(target.pos.x - t.pos.x, 0, target.pos.z - t.pos.z).normalize().clone());
  }

  private take(style: 'short' | 'long', charge: number, dir: THREE.Vector3): void {
    const m = this.m;
    const sp = this.current!;
    const t = sp.taker;
    t.basePose = null;
    m.phase = 'playing';
    if (sp.kind === 'throwin') {
      const r = m.kicks.throwIn(t, dir, style === 'long', charge, m.assistFor(t, 'pass'));
      m.applyThrow(t, r.vel, r.receiver);
    } else {
      m.pass(t, dir, style === 'short' ? 'short' : 'lob', charge);
    }
    // 키커는 다른 선수가 건드리기 전에 다시 만질 수 없다 (더블 터치 금지)
    t.kickCooldown = 0.8;
    this.current = null;
    if (m.controlled.isKeeper) m.switchToNearest();
  }
}
