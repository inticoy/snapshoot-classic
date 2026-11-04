import { GOAL, PITCH } from '../config';
import type { Match } from '../gameplay/Match';

/**
 * 관중 분위기 (0..1): 경기 상황으로 함성 크기를 정한다 (화면·소리 전용, 경기 계산에 영향 없음).
 *  - 공을 가진 팀이 상대 골문에 다가갈수록 커진다 (상대 진영 35m부터, 박스 안이면 최고). 홈팀(0) 공격이 조금 더 크다
 *  - 슛이 날아가는 동안 확 올라간다
 *  - 골이면 몇 초간 최고조, 아깝게 빗나가면 '오~' (ooh)
 * 올라갈 때는 빠르게(0.35초), 내려갈 때는 천천히(1.8초) 따라간다.
 */
export const CROWD = {
  /** 이 거리(m, 상대 골라인까지)부터 들썩이기 시작 */
  dangerFrom: 35,
  /** 이 거리 안이면 최고 */
  dangerFull: 12,
  away: 0.75,
  shot: 0.9,
  rise: 0.35,
  fall: 1.8,
  goalHold: 4,
  /** 골문 옆·위로 이만큼(m) 안쪽으로 나가면 아까운 슛 */
  nearMiss: 3.5,
};

export function crowdTarget(m: Match): number {
  if (m.phase === 'goal') return 1;
  if (m.phase !== 'playing') return 0;
  let level = 0;
  const owner = m.ball.owner, bp = m.ball.position;
  // 공을 가진 팀(없으면 마지막으로 찬 팀) 기준
  const team = owner?.team ?? m.ball.lastTouch?.team;
  if (team !== undefined) {
    const toGoal = Math.abs(m.oppGoalX(team) - bp.x) + Math.max(0, Math.abs(bp.z) - PITCH.boxWidth / 2) * 0.5;
    const danger = Math.min(1, Math.max(0, (CROWD.dangerFrom - toGoal) / (CROWD.dangerFrom - CROWD.dangerFull)));
    level = danger * (team === 0 ? 1 : CROWD.away);
  }
  if (m.ball.shot) level = Math.max(level, CROWD.shot);
  return level;
}

export class CrowdMood {
  level = 0;
  private hold = 0;
  private shotWasFlying = false;

  /** 매 화면 프레임. 아깝게 빗나간 순간이면 true (탄성 소리) */
  update(dt: number, m: Match): boolean {
    let target = crowdTarget(m);
    if (m.phase === 'goal') this.hold = CROWD.goalHold;
    if (this.hold > 0) { this.hold -= dt; target = 1; }
    const tau = target > this.level ? CROWD.rise : CROWD.fall;
    this.level += (target - this.level) * (1 - Math.exp(-dt / tau));
    // 날아가던 슛이 골이 아닌 채로 골라인 밖, 골문 가까이 나갔다
    const flying = !!m.ball.shot;
    let ooh = false;
    if (this.shotWasFlying && m.phase === 'out') {
      const bp = m.ball.position;
      ooh = Math.abs(bp.x) > PITCH.halfL && Math.abs(bp.z) < GOAL.width / 2 + CROWD.nearMiss && bp.y < GOAL.height + CROWD.nearMiss;
    }
    this.shotWasFlying = flying && m.phase === 'playing';
    return ooh;
  }
}
