import * as THREE from 'three';
import { AI, GOAL, PITCH } from '../config';
import type { Player } from '../entities/Player';
import type { Match } from '../gameplay/Match';
import { n } from '../data/Stats';

interface Intent {
  target: THREE.Vector3;
  sprint: boolean;
  /** 목표 지점에 도착하면 바라볼 곳 */
  look: THREE.Vector3 | null;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/**
 * 필드 플레이어 AI. 일정 주기(AI.reaction)마다 의사결정을 하고,
 * 그 사이에는 마지막 목표 지점으로 이동한다.
 *
 * 역할:
 *  - 공 소유자: 드리블 / 패스 / 슛
 *  - 체이서: 팀에서 공에 가장 가까운 선수가 압박하거나 공을 주우러 간다
 *  - 서포터: 포메이션 위치 (공격 시 앞으로, 수비 시 골문 쪽으로)
 */
export class TeamAI {
  private readonly intents = new Map<Player, Intent>();
  private readonly timers = new Map<Player, number>();

  constructor(private readonly match: Match) {
    for (const p of match.players) {
      this.intents.set(p, { target: p.pos.clone(), sprint: false, look: null });
      this.timers.set(p, Math.random() * AI.reaction);
    }
  }

  update(dt: number): void {
    const m = this.match;
    for (const p of m.players) {
      if (p.isKeeper || m.isUserControlled(p)) continue;
      let t = this.timers.get(p)! - dt;
      if (t <= 0) {
        // 반응 속도가 좋을수록 상황 판단이 빠르다
        t += AI.reaction * (1.35 - 0.6 * n(p.profile.stats.reactions));
        this.decide(p);
      }
      this.timers.set(p, t);
      this.move(p, dt);
    }
  }

  private move(p: Player, dt: number): void {
    if (p.busy) return;
    const intent = this.intents.get(p)!;
    const hasBall = this.match.ball.owner === p;
    tmp.set(intent.target.x - p.pos.x, 0, intent.target.z - p.pos.z);
    const d = tmp.length();
    // 도착 지점 근처에서는 감속
    const arrive = hasBall ? 1 : Math.min(1, d / 2.5);
    if (d > 0.25) tmp.multiplyScalar(arrive / d);
    else tmp.set(0, 0, 0);
    const speedScale = p.team === 1 ? AI.speedFactor : 1;
    p.steer(tmp, intent.sprint && d > 3, hasBall, dt, speedScale);
    if (d < 0.5 && intent.look) p.faceTowards(intent.look.x, intent.look.z);
  }

  private decide(p: Player): void {
    const m = this.match;
    const ball = m.ball;
    const intent = this.intents.get(p)!;
    const bp = ball.position;
    intent.look = null;
    intent.sprint = false;

    if (ball.owner === p) {
      this.decideWithBall(p, intent);
      return;
    }

    const teamHasBall = ball.owner?.team === p.team;
    const oppHasBall = !!ball.owner && ball.owner.team !== p.team;
    const chaser = this.chaser(p.team);

    // 패스를 받는 중이면 공 쪽으로
    if (m.passTarget === p && !ball.owner) {
      this.interceptBall(p, intent);
      return;
    }

    if (p === chaser && !teamHasBall) {
      if (oppHasBall) {
        // 압박: 상대와 자기 골대 사이로 들어간다
        const carrier = ball.owner!;
        const gx = m.ownGoalX(p.team);
        tmp.set(gx - carrier.pos.x, 0, -carrier.pos.z).normalize();
        intent.target.copy(carrier.pos).addScaledVector(tmp, 0.9).addScaledVector(carrier.vel, 0.25);
        intent.sprint = carrier.pos.distanceTo(p.pos) > 4;
        intent.look = carrier.pos.clone();
        this.maybeTackle(p, carrier);
      } else {
        this.interceptBall(p, intent);
      }
      return;
    }

    // 서포트 위치
    const a = p.attackDir;
    const bx = THREE.MathUtils.clamp(bp.x, -PITCH.halfL, PITCH.halfL);
    if (teamHasBall) {
      if (p.role === 'FWD') {
        // 공보다 앞에서 반대편 공간으로
        const x = THREE.MathUtils.clamp(bx + a * 11, -PITCH.halfL + 8, PITCH.halfL - 8);
        const z = -Math.sign(bp.z || 1) * 7 + Math.sin(performance.now() / 2500 + p.number) * 3;
        intent.target.set(x, 0, z);
        intent.sprint = Math.abs(p.pos.x - x) > 6;
      } else {
        const x = THREE.MathUtils.clamp(bx - a * 9, -PITCH.halfL + 6, PITCH.halfL - 12);
        intent.target.set(x, 0, bp.z * 0.35 + (p.team === 0 ? 3 : -3));
      }
    } else {
      // 수비: 공과 골대 사이에 선다 (골문 쪽)
      const gx = m.ownGoalX(p.team);
      if (p.role === 'DEF' || p.role === 'FWD') {
        const share = p.role === 'DEF' ? 0.45 : 0.75;
        intent.target.set(gx + (bx - gx) * share, 0, bp.z * (p.role === 'DEF' ? 0.6 : 0.4));
        // 위험 지역이면 더 빨리 복귀
        intent.sprint = Math.abs(bx - gx) < 22 && Math.abs(p.pos.x - gx) > Math.abs(bx - gx);
        intent.look = new THREE.Vector3(bp.x, 0, bp.z);
        // 공 소유자가 가까이 오면 태클 시도
        if (oppHasBall && ball.owner!.pos.distanceTo(p.pos) < 2.2) {
          intent.target.copy(ball.owner!.pos);
          this.maybeTackle(p, ball.owner!);
        }
      }
    }
  }

  private decideWithBall(p: Player, intent: Intent): void {
    const m = this.match;
    const a = p.attackDir;
    const gx = m.oppGoalX(p.team);
    const toGoal = Math.hypot(gx - p.pos.x, p.pos.z);
    const angleOk = Math.abs(p.pos.z) < Math.abs(gx - p.pos.x) * 1.1 + 2;
    const pressure = m.nearestOpponentDist(p);

    // 1) 슛
    if (toGoal < AI.shootRange && angleOk) {
      const chancePerDecision = toGoal < 12 ? 0.55 : 0.18;
      if (Math.random() < chancePerDecision) {
        const finesse = toGoal > 12 && Math.random() < 0.35;
        const corner = (Math.random() < 0.5 ? -1 : 1) * (GOAL.width / 2 - 0.7);
        tmp.set(gx - p.pos.x, 0, corner - p.pos.z).normalize();
        const charge = finesse ? 0.5 + Math.random() * 0.4 : 0.35 + Math.random() * 0.45;
        m.shoot(p, charge, finesse, tmp);
        return;
      }
    }

    // 2) 압박받으면 패스
    if (pressure < 2.6) {
      const mate = this.bestPassTarget(p);
      if (mate && Math.random() < 0.55) {
        tmp.copy(mate.pos).sub(p.pos).setY(0).normalize();
        m.pass(p, tmp);
        return;
      }
    }

    // 3) 앞에 있는 열린 동료에게 전진 패스
    const forward = this.bestPassTarget(p, true);
    if (forward && Math.random() < 0.06) {
      tmp.copy(forward.pos).sub(p.pos).setY(0).normalize();
      m.pass(p, tmp);
      return;
    }

    // 4) 드리블: 골대 방향 + 상대 회피
    const dir = tmp.set(gx - p.pos.x, 0, -p.pos.z * 0.6).normalize();
    for (const o of m.teams[1 - p.team]) {
      tmp2.copy(p.pos).sub(o.pos).setY(0);
      const d = tmp2.length();
      if (d < 5 && d > 0.01) {
        // 앞을 막고 있는 상대일수록 크게 피한다
        const ahead = Math.max(0, -tmp2.dot(dir) / d);
        dir.addScaledVector(tmp2.normalize(), ((5 - d) / 5) * (0.6 + ahead * 1.4));
      }
    }
    // 측면 라인 밖으로 나가지 않게
    if (Math.abs(p.pos.z) > PITCH.halfW - 3) dir.z -= Math.sign(p.pos.z) * 0.8;
    dir.normalize();
    intent.target.copy(p.pos).addScaledVector(dir, 4);
    intent.sprint = pressure > 3.5 && p.stamina > 0.3 && dir.x * a > 0.3;
  }

  private bestPassTarget(p: Player, forwardOnly = false): Player | null {
    const m = this.match;
    let best: Player | null = null;
    let bestScore = -Infinity;
    for (const mate of m.teams[p.team]) {
      if (mate === p || mate.isKeeper) continue;
      const gain = (mate.pos.x - p.pos.x) * p.attackDir;
      if (forwardOnly && gain < 5) continue;
      if (m.laneBlocked(p, mate)) continue;
      const open = m.nearestOpponentDist(mate);
      if (open < 2.5) continue;
      const score = open + gain * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = mate;
      }
    }
    return best;
  }

  private interceptBall(p: Player, intent: Intent): void {
    const ball = this.match.ball;
    const bp = ball.position;
    const bv = ball.velocity;
    // 공이 도착할 지점을 대략 예측해서 그쪽으로 간다
    const d = Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z);
    const t = Math.min(1.2, d / 7);
    intent.target.set(bp.x + bv.x * t * 0.7, 0, bp.z + bv.z * t * 0.7);
    intent.sprint = d > 3;
  }

  private maybeTackle(p: Player, carrier: Player): void {
    if (p.tackleCooldown > 0 || p.busy) return;
    const d = carrier.pos.distanceTo(p.pos);
    if (d > 1.5) return;
    const chance = 1 - Math.exp(-AI.tackleChancePerSec * AI.reaction);
    if (Math.random() < chance) {
      const bp = this.match.ball.position;
      tmp.set(bp.x - p.pos.x, 0, bp.z - p.pos.z).normalize();
      // 가까우면 주로 스탠딩 태클, 가끔 슬라이딩
      p.startTackle(tmp, d < 1.15 && Math.random() < 0.7 ? 'stand' : 'slide');
    }
  }

  /** 팀에서 공에 가장 가까운 (사람이 조종하지 않는) 필드 플레이어 */
  private chaser(team: 0 | 1): Player | null {
    const m = this.match;
    const bp = m.ball.position;
    let best: Player | null = null;
    let bestD = Infinity;
    let userD = Infinity;
    for (const p of m.teams[team]) {
      if (p.isKeeper) continue;
      const d = Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z);
      if (m.isUserControlled(p)) {
        userD = d;
        continue;
      }
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    // 사용자 팀: 사람이 조종하는 선수가 더 가깝거나 비슷하면 AI 동료는 쫓지 않는다
    if (team === 0 && userD < bestD + 4 && !m.teammatePress) return null;
    // 상대 공일 때 사용자 팀 AI 동료는 동료 압박(S) 중일 때만 압박한다
    if (team === 0 && userD < Infinity && m.ball.owner && m.ball.owner.team !== 0) return m.teammatePress ? best : null;
    return best;
  }
}
