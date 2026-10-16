import * as THREE from 'three';
import { PITCH, RULES } from '../config';
import { n } from '../data/Stats';
import type { Player } from '../entities/Player';
import type { Match } from './Match';

export type Card = 'yellow' | 'red';

export interface Foul {
  by: Player;
  on: Player;
  spot: THREE.Vector3;
  card: Card | null;
  /** 반칙한 팀의 페널티 박스 안 → PK */
  penalty: boolean;
}

/**
 * 심판 판정: 파울·카드·어드밴티지, 오프사이드, 키퍼 백패스, 추가 시간.
 * 판정만 하고 재개(프리킥·PK 배치)는 SetPieces가 맡는다.
 */
export class Rules {
  readonly fouls: [number, number] = [0, 0];
  readonly offsides: [number, number] = [0, 0];
  readonly yellows: [number, number] = [0, 0];
  readonly reds: [number, number] = [0, 0];
  /** 파울을 당한 팀이 공을 계속 갖고 있으면 그대로 진행 */
  advantage: { foul: Foul; timer: number } | null = null;
  /** 동료가 발로 일부러 준 공 → 키퍼가 손으로 잡을 수 없다 */
  backPassTeam: 0 | 1 | null = null;
  /** 다음 킥은 오프사이드 판정이 없다 (스로인·코너킥·골킥) */
  exemptNext = false;
  /** 이번 하프의 추가 시간 요인 (분) */
  private added = 0;
  /** 마지막 패스/슛 순간 오프사이드 위치였던 선수 */
  private readonly offsideSet = new Set<Player>();
  private offsideTeam: 0 | 1 | null = null;

  constructor(private readonly m: Match) {}

  reset(): void {
    this.fouls.fill(0);
    this.offsides.fill(0);
    this.yellows.fill(0);
    this.reds.fill(0);
    this.added = 0;
    this.clearPlay();
  }

  /** 경기가 멈출 때(아웃·킥오프·세트피스) 진행 중 판정을 비운다 */
  clearPlay(): void {
    this.advantage = null;
    this.backPassTeam = null;
    this.exemptNext = false;
    this.offsideSet.clear();
    this.offsideTeam = null;
  }

  // ---------------------------------------------------------------- 추가 시간

  /** 경기를 멈추게 한 일마다 추가 시간을 쌓는다 (분) */
  addStoppage(minutes: number): void {
    this.added += minutes;
  }

  /** 하프 종료 시 보여 줄 추가 시간 (분). 후반이 더 길다 */
  stoppageMinutes(half: 1 | 2): number {
    const max = RULES.stoppageMax[half - 1];
    return THREE.MathUtils.clamp(Math.round(RULES.stoppageMin + this.added), RULES.stoppageMin, max);
  }

  newHalf(): void {
    this.added = 0;
    this.clearPlay();
  }

  // ---------------------------------------------------------------- 파울

  /**
   * 태클 판정 직후 호출. 반칙이면 Foul을 돌려준다.
   *  - 뒤에서 들어간 태클은 공을 건드려도 반칙 (사람을 먼저 친다)
   *  - 공을 못 건드린 태클은 슬라이딩일수록, 태클 능력이 낮을수록 반칙이 되기 쉽다
   * facing = 공 가진 선수가 바라보는 방향과 태클 방향의 내적 (1 = 등 뒤에서 같은 방향으로)
   */
  judgeTackle(t: Player, carrier: Player, wonBall: boolean, facing: number): Foul | null {
    if (t.isKeeper || carrier.team === t.team) return null;
    const slide = t.tackleKind === 'slide';
    const st = t.profile.stats;
    const skill = n(slide ? st.slidingTackle : st.standingTackle) * 0.6 + n(st.defAwareness) * 0.4;
    const behind = facing > 0.5;
    const chance = behind ? 1 : !wonBall ? (slide ? 0.32 : 0.1) * (1.4 - 0.8 * skill) : slide ? 0.04 : 0;
    if (this.m.random.next() >= chance) return null;

    const spot = carrier.pos.clone().setY(0);
    spot.x = THREE.MathUtils.clamp(spot.x, -PITCH.halfL + 0.5, PITCH.halfL - 0.5);
    spot.z = THREE.MathUtils.clamp(spot.z, -PITCH.halfW + 0.5, PITCH.halfW - 0.5);
    const penalty = this.m.inOwnBox(t, spot.x, spot.z);
    // 명백한 득점 기회 저지: 골문까지 수비수가 없는데 넘어뜨렸다 (박스 안에서 공을 노린 태클은 경고로 낮춘다)
    const dogso = this.denyingGoal(carrier, t);
    const r = this.m.random.next();
    let card: Card | null = null;
    if (dogso && (behind || !penalty)) card = 'red';
    else if (dogso) card = 'yellow';
    else if (slide && behind) card = r < 0.1 ? 'red' : r < 0.6 ? 'yellow' : null;
    else if (behind) card = r < 0.3 ? 'yellow' : null;
    else if (slide) card = r < 0.2 ? 'yellow' : null;
    else card = r < 0.04 ? 'yellow' : null;
    return { by: t, on: carrier, spot, card, penalty };
  }

  private denyingGoal(carrier: Player, t: Player): boolean {
    const a = carrier.attackDir;
    const gx = this.m.oppGoalX(carrier.team);
    const toGoal = Math.hypot(gx - carrier.pos.x, carrier.pos.z);
    if (toGoal > 28 || Math.abs(carrier.pos.z) > PITCH.boxWidth / 2 + 4) return false;
    // 반칙한 선수 말고 공보다 골문 쪽에 있는 수비 필드 플레이어가 없으면
    return !this.m.teams[t.team].some((d) => d !== t && !d.isKeeper && d.pos.x * a > carrier.pos.x * a - 0.5);
  }

  /** 반칙 선언. 공을 계속 가진 쪽에 유리하면 어드밴티지 */
  call(foul: Foul, carrierKeepsBall: boolean): void {
    const m = this.m;
    this.fouls[foul.by.team]++;
    this.addStoppage(0.2);
    m.events.push({ type: 'foul', by: foul.by, on: foul.on, penalty: foul.penalty });
    if (foul.card) this.book(foul.by, foul.card);
    // 상대 진영에서 공을 지킨 채 넘어지지 않았으면 경기를 잇는다. PK는 어드밴티지 없이 바로 준다
    if (!foul.penalty && carrierKeepsBall && foul.on.pos.x * foul.on.attackDir > -10) {
      this.advantage = { foul, timer: RULES.advantageTime };
      m.events.push({ type: 'advantage', team: foul.on.team });
      return;
    }
    this.award(foul);
  }

  private award(foul: Foul): void {
    this.advantage = null;
    this.m.setPieces.award(foul.penalty ? 'penalty' : 'freekick', foul.on.team, foul.spot);
  }

  /** 어드밴티지 진행: 공을 잃으면 원래 지점 프리킥, 시간이 지나면 진행 확정 */
  update(dt: number): void {
    const adv = this.advantage;
    if (!adv) return;
    adv.timer -= dt;
    const owner = this.m.ball.owner;
    if (owner && owner.team !== adv.foul.on.team) this.award(adv.foul);
    else if (adv.timer <= 0) this.advantage = null;
  }

  // ---------------------------------------------------------------- 카드

  book(p: Player, card: Card): void {
    const m = this.m;
    if (p.sentOff || p.isKeeper) return;
    let second = false;
    if (card === 'yellow') {
      p.yellows++;
      this.yellows[p.team]++;
      if (p.yellows >= 2) {
        card = 'red';
        second = true;
      }
    }
    this.addStoppage(0.3);
    m.events.push({ type: 'card', player: p, card, second });
    if (card === 'red') {
      this.reds[p.team]++;
      m.sendOff(p);
    }
  }

  // ---------------------------------------------------------------- 오프사이드

  /** 상대 진영에서 공과 뒤에서 두 번째 수비수보다 앞선 동료를 기록한다 (패스·슛 순간) */
  recordKick(kicker: Player): void {
    this.offsideSet.clear();
    this.offsideTeam = null;
    if (this.exemptNext) {
      this.exemptNext = false;
      return;
    }
    const a = kicker.attackDir;
    const ball = this.m.ball.position.x * a;
    const line = this.offsideLine(kicker.team);
    for (const mate of this.m.teams[kicker.team]) {
      if (mate === kicker || mate.isKeeper) continue;
      const x = mate.pos.x * a;
      if (x > 0 && x > ball + RULES.offsideMargin && x > line + RULES.offsideMargin) this.offsideSet.add(mate);
    }
    if (this.offsideSet.size) this.offsideTeam = kicker.team;
  }

  /** 공격 방향 기준 좌표로 본 오프사이드 라인 (뒤에서 두 번째 상대) */
  offsideLine(team: 0 | 1): number {
    const a = this.m.teams[team][0].attackDir;
    const xs = this.m.teams[1 - team].map((o) => o.pos.x * a).sort((x, y) => y - x);
    return xs[1] ?? xs[0] ?? 0;
  }

  isOffsidePosition(p: Player): boolean {
    return this.offsideSet.has(p);
  }

  /**
   * 선수가 공을 건드릴 때 호출. 오프사이드면 간접 프리킥을 주고 true.
   * 키퍼가 손으로 잡는 것 말고는 백패스 상태도 여기서 풀린다.
   */
  touch(p: Player): boolean {
    this.backPassTeam = null;
    if (this.offsideTeam === null) return false;
    if (this.offsideSet.has(p)) {
      const team = (1 - p.team) as 0 | 1;
      this.offsides[p.team]++;
      this.addStoppage(0.1);
      this.offsideSet.clear();
      this.offsideTeam = null;
      this.m.events.push({ type: 'offside', player: p });
      this.m.setPieces.award('indirect', team, p.pos.clone().setY(0));
      return true;
    }
    // 다른 선수가 공을 플레이하면 그 전 패스의 오프사이드 위치는 무효
    this.offsideSet.clear();
    this.offsideTeam = null;
    return false;
  }

  // ---------------------------------------------------------------- 백패스

  /** 발로 하는 패스·스로인이 나갈 때 */
  recordPass(p: Player): void {
    this.backPassTeam = p.isKeeper ? null : p.team;
  }

  keeperMayHandle(k: Player): boolean {
    return this.backPassTeam !== k.team;
  }
}
