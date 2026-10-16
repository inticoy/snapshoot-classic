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
      this.timers.set(p, this.match.random.next() * AI.reaction);
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

    // 수비 시: 위험한 상대 공격수를 대인 마크
    if (!teamHasBall) {
      const mark = this.markAssignments(p.team).get(p);
      if (mark) {
        const gx = m.ownGoalX(p.team);
        // 상대와 우리 골대 사이, 공 쪽으로 약간 치우쳐서
        tmp.set(gx - mark.pos.x, 0, -mark.pos.z).normalize();
        tmp2.set(bp.x - mark.pos.x, 0, bp.z - mark.pos.z).normalize();
        intent.target.copy(mark.pos).addScaledVector(tmp, 1.6).addScaledVector(tmp2, 0.6);
        intent.sprint = p.pos.distanceTo(intent.target) > 5;
        intent.look = new THREE.Vector3(bp.x, 0, bp.z);
        if (oppHasBall && ball.owner === mark) this.maybeTackle(p, mark);
        return;
      }
    }

    // 포메이션 위치 (공 위치에 따라 팀 전체가 움직인다)
    this.formationTarget(p, teamHasBall, intent.target);
    intent.sprint = p.pos.distanceTo(intent.target) > 8;
    intent.look = new THREE.Vector3(bp.x, 0, bp.z);
    if (oppHasBall && ball.owner!.pos.distanceTo(p.pos) < 2.2) {
      intent.target.copy(ball.owner!.pos);
      this.maybeTackle(p, ball.owner!);
    }
  }

  /**
   * 포메이션 기본 위치를 공 위치에 맞춰 이동시킨 목표 지점.
   * fx는 팀 기준 좌표 (공격 방향 +).
   */
  formationTarget(p: Player, teamHasBall: boolean, out: THREE.Vector3): THREE.Vector3 {
    const a = p.attackDir;
    const bp = this.match.ball.position;
    const ballF = THREE.MathUtils.clamp(bp.x * a, -PITCH.halfL, PITCH.halfL);
    const slot = p.slot;
    let fx = slot.fx + 12 + ballF * 0.5 + (teamHasBall ? 5 : -3);
    if (p.role === 'DEF') {
      // 수비 라인: 공보다 항상 뒤에
      fx = Math.min(fx - 4, ballF - (teamHasBall ? 7 : 4));
    } else if (p.role === 'MID') {
      // 공 근처에서 받을 각도를 만든다
      fx = teamHasBall ? ballF - 3 : Math.min(fx, ballF - 2);
    } else if (p.role === 'FWD') {
      // 공격 시 수비 뒷공간으로, 수비 시 하프라인 근처에서 역습 대기
      fx = teamHasBall ? Math.max(fx, ballF + 8) : Math.max(-4, ballF * 0.4);
    }
    fx = THREE.MathUtils.clamp(fx, -PITCH.halfL + 4, PITCH.halfL - 5);
    const width = teamHasBall ? 1.35 : 0.85;
    let z = slot.z * a * width + bp.z * 0.35;
    if (p.role === 'FWD' && teamHasBall) z = -Math.sign(bp.z || 1) * 5 + Math.sin(this.match.elapsed / AI.runSwayPeriod + p.number) * 3;
    if (p.role === 'MID' && teamHasBall) z = bp.z * 0.5 - Math.sign(bp.z || 1) * 5;
    z = THREE.MathUtils.clamp(z, -PITCH.halfW + 2, PITCH.halfW - 2);
    return out.set(fx * a, 0, z);
  }

  /**
   * 수비 시 마크 배정: 우리 진영 쪽에 들어온 상대 필드 플레이어를
   * 가장 가까운 수비 가능 선수(체이서 제외)에게 한 명씩 붙인다.
   */
  private markAssignments(team: 0 | 1): Map<Player, Player> {
    const m = this.match;
    const result = new Map<Player, Player>();
    const chaser = this.chaser(team);
    const carrier = m.ball.owner;
    const defenders = m.teams[team].filter(
      (p) => !p.isKeeper && p !== chaser && !m.isUserControlled(p) && p.role !== 'FWD',
    );
    const a = m.teams[team][0].attackDir;
    // 우리 진영에 가까운 순서로 위협 정렬 (공 소유자는 체이서 담당)
    const threats = m.teams[1 - team]
      .filter((o) => !o.isKeeper && o !== carrier && o.pos.x * a < 8)
      .sort((x, y) => x.pos.x * a - y.pos.x * a);
    const free = new Set(defenders);
    for (const t of threats) {
      let best: Player | null = null;
      let bestD = Infinity;
      for (const d of free) {
        const dd = d.pos.distanceTo(t.pos);
        if (dd < bestD) {
          bestD = dd;
          best = d;
        }
      }
      if (!best) break;
      result.set(best, t);
      free.delete(best);
    }
    return result;
  }

  private decideWithBall(p: Player, intent: Intent): void {
    const m = this.match;
    const a = p.attackDir;
    const gx = m.oppGoalX(p.team);
    const toGoal = Math.hypot(gx - p.pos.x, p.pos.z);
    const angleOk = Math.abs(p.pos.z) < Math.abs(gx - p.pos.x) * 1.1 + 2;
    const pressure = m.nearestOpponentDist(p);

    // 1) 슛: 가까울수록, 슛 길목이 비어 있을수록 자주. 중거리는 중거리 슛 능력치가 좋을수록 시도
    const laneClear = this.shotLaneClear(p, gx);
    if (toGoal < AI.shootRange + 6 && angleOk) {
      const longShot = n(p.profile.stats.longShots);
      const chancePerDecision =
        toGoal < 12 ? 0.6 : toGoal < 18 ? (laneClear ? 0.4 : 0.15) : laneClear ? 0.06 + 0.12 * longShot : 0.02;
      if (this.match.random.next() < chancePerDecision) {
        const finesse = toGoal > 12 && this.match.random.next() < 0.35;
        const corner = (this.match.random.next() < 0.5 ? -1 : 1) * (GOAL.width / 2 - 0.7);
        tmp.set(gx - p.pos.x, 0, corner - p.pos.z).normalize();
        const charge = finesse ? 0.5 + this.match.random.next() * 0.4 : 0.35 + this.match.random.next() * 0.45;
        m.shoot(p, charge, finesse, tmp);
        return;
      }
    }

    // 1-b) 측면 깊은 곳이면 박스 안 동료에게 크로스 (헤더 노림)
    if (Math.abs(p.pos.z) > 8 && Math.abs(gx - p.pos.x) < 16) {
      const target = m.teams[p.team].find(
        (q) => q !== p && !q.isKeeper && Math.abs(gx - q.pos.x) < PITCH.boxDepth && Math.abs(q.pos.z) < 5,
      );
      if (target && this.match.random.next() < 0.35) {
        tmp.copy(target.pos).sub(p.pos).setY(0).normalize();
        m.pass(p, tmp, 'lob', 0.55);
        return;
      }
    }

    // 2) 압박받으면 패스
    if (pressure < 2.6) {
      const mate = this.bestPassTarget(p);
      if (mate && this.match.random.next() < 0.55) {
        tmp.copy(mate.pos).sub(p.pos).setY(0).normalize();
        m.pass(p, tmp);
        return;
      }
    }

    // 3) 앞에 있는 열린 동료에게 전진 패스. 공격수가 수비 뒷공간으로 뛰고 있으면 스루 패스
    const forward = this.bestPassTarget(p, true);
    if (forward && this.match.random.next() < 0.08 + 0.12 * n(p.profile.stats.vision)) {
      tmp.copy(forward.pos).sub(p.pos).setY(0).normalize();
      const running = forward.vel.x * a > 3 && forward.role === 'FWD';
      m.pass(p, tmp, running ? 'through' : 'short', 0.5);
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

  /** 공에서 골대 중앙까지 상대 필드 플레이어가 막고 있지 않은지 */
  private shotLaneClear(p: Player, gx: number): boolean {
    const m = this.match;
    const ax = p.pos.x, az = p.pos.z;
    const bx = gx - ax, bz = -az;
    const len2 = bx * bx + bz * bz;
    for (const o of m.teams[1 - p.team]) {
      if (o.isKeeper) continue;
      const t = ((o.pos.x - ax) * bx + (o.pos.z - az) * bz) / len2;
      if (t < 0.05 || t > 1) continue;
      const px = ax + bx * t - o.pos.x, pz = az + bz * t - o.pos.z;
      if (px * px + pz * pz < 1.2 * 1.2) return false;
    }
    return true;
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
    // 공중볼이면 머리 높이로 내려오는 지점, 땅볼이면 굴러올 지점으로 간다
    const d = Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z);
    const land = bp.y > 1.3 ? this.match.predictBallAt(1.7) : null;
    if (land) {
      intent.target.set(land.x, 0, land.z);
    } else if (Math.hypot(bv.x, bv.z) > 2) {
      intent.target.copy(this.match.interceptPoint(p));
    } else {
      intent.target.set(bp.x, 0, bp.z);
    }
    intent.sprint = d > 3;
  }

  private maybeTackle(p: Player, carrier: Player): void {
    if (p.tackleCooldown > 0 || p.busy) return;
    const d = carrier.pos.distanceTo(p.pos);
    if (d > 1.5) return;
    const chance = 1 - Math.exp(-AI.tackleChancePerSec * AI.reaction);
    if (this.match.random.next() < chance) {
      const bp = this.match.ball.position;
      tmp.set(bp.x - p.pos.x, 0, bp.z - p.pos.z).normalize();
      // 가까우면 주로 스탠딩 태클, 가끔 슬라이딩
      p.startTackle(tmp, d < 1.15 && this.match.random.next() < 0.7 ? 'stand' : 'slide');
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
