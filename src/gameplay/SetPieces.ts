import * as THREE from 'three';
import { BALL, GOAL, PASS, PITCH, RULES } from '../config';
import { diveKeeper, keeperGuess, penaltyAim, penaltySpot, shotLineZ, sideFromInput } from './Penalty';
import { CORNER_RUN_SPOTS } from '../data/SetPiecePositions';
import type { Player } from '../entities/Player';
import type { Match, UserCommand, KickKind } from './Match';

export type RestartKind = 'throwin' | 'corner' | 'goalkick' | 'freekick' | 'indirect' | 'penalty';

export const RESTART_LABEL: Record<RestartKind, string> = {
  throwin: '스로인',
  corner: '코너킥',
  goalkick: '골킥',
  freekick: '프리킥',
  indirect: '간접 프리킥',
  penalty: '페널티킥',
};

/** 오프사이드 판정이 없는 재개 */
const NO_OFFSIDE: RestartKind[] = ['throwin', 'corner', 'goalkick'];

export interface SetPiece {
  kind: RestartKind;
  team: 0 | 1;
  spot: THREE.Vector3;
  taker: Player;
  /** 준비 후 경과 시간 */
  timer: number;
  ready: boolean;
  /** 직접 프리킥으로 골문을 노릴 수 있는 거리·각도 */
  shooting: boolean;
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
  /** 상대 PK 때 사용자가 누르고 있는 다이빙 방향 (z 축) */
  private userDive = 0;

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
      // 이 골라인 쪽으로 공격하는 팀의 상대가 지킨다 (후반에는 진영이 바뀐다)
      const defending = (this.m.teams[0][0].attackDir === end ? 1 : 0) as 0 | 1;
      const side = Math.sign(bp.z) || 1;
      if (last && last.team === defending) {
        const attacking = (1 - defending) as 0 | 1;
        this.begin('corner', attacking, new THREE.Vector3(end * (PITCH.halfL - 0.25), 0, side * (PITCH.halfW - 0.25)));
      } else {
        this.begin('goalkick', defending, new THREE.Vector3(end * (PITCH.halfL - PITCH.goalAreaDepth), 0, side * 2.5));
      }
      return true;
    }
    return false;
  }

  /** 반칙·오프사이드 휘슬 뒤 재개 (Rules가 호출) */
  award(kind: 'freekick' | 'indirect' | 'penalty', team: 0 | 1, spot: THREE.Vector3): void {
    const a = this.m.teams[team][0].attackDir;
    if (kind === 'penalty') penaltySpot(a, spot);
    this.begin(kind, team, spot);
  }

  private begin(kind: RestartKind, team: 0 | 1, spot: THREE.Vector3): void {
    const m = this.m;
    m.phase = 'out';
    m.rules.clearPlay();
    m.cancelWindups();
    this.outTimer = OUT_DELAY;
    m.charge = null;
    m.passTarget = null;
    m.ball.owner = null;
    m.ball.shot = null;
    const taker = this.pickTaker(kind, team, spot);
    const toGoal = Math.hypot(m.oppGoalX(team) - spot.x, spot.z);
    const shooting = kind === 'freekick' && toGoal < RULES.freeKickShotRange && Math.abs(spot.z) < toGoal * 0.8;
    this.current = { kind, team, spot, taker, timer: 0, ready: false, shooting };
    m.events.push({ type: 'out', kind, team });
  }

  private pickTaker(kind: RestartKind, team: 0 | 1, spot: THREE.Vector3): Player {
    const m = this.m;
    const squad = m.teams[team];
    if (kind === 'goalkick') return squad[0];
    const field = squad.filter((p) => !p.isKeeper);
    const top = (score: (p: Player) => number) => field.sort((a, b) => score(b) - score(a))[0];
    if (kind === 'penalty') return top((p) => p.profile.stats.finishing + p.profile.stats.composure);
    if (kind === 'freekick' || kind === 'indirect') {
      // 자기 박스 근처 프리킥은 키퍼가 길게 차고, 슛 거리면 감아차기가 좋은 선수
      if (m.inOwnBox(squad[0], spot.x, spot.z)) return squad[0];
      const toGoal = Math.hypot(m.oppGoalX(team) - spot.x, spot.z);
      if (kind === 'freekick' && toGoal < RULES.freeKickShotRange) return top((p) => p.profile.stats.curve + p.profile.stats.longShots);
    }
    // 코너킥은 미드필더(킥이 좋은 선수), 스로인은 가장 가까운 필드 플레이어
    if (kind === 'corner') {
      const mid = squad.filter((p) => p.role === 'MID').sort((a, b) =>
        b.profile.stats.longPassing + b.profile.stats.curve - a.profile.stats.longPassing - a.profile.stats.curve,
      )[0];
      if (mid) return mid;
    }
    let best = squad.find((p) => !p.isKeeper)!;
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
    if (sp.kind === 'penalty' && sp.team !== 0) this.userDive = cmd.move.z;

    if (userTakes) {
      // 방향키로 조준 (제자리에서 몸만 돌린다). PK는 뗄 때 누른 방향으로 바로 찬다
      if (cmd.move.lengthSq() > 0.01 && sp.kind !== 'penalty') {
        const target = Math.atan2(cmd.move.x, cmd.move.z);
        const cur = Math.atan2(t.facing.x, t.facing.z);
        let d = target - cur;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const a = cur + THREE.MathUtils.clamp(d, -4 * dt, 4 * dt);
        t.facing.set(Math.sin(a), 0, Math.cos(a));
      }
      if (sp.timer < 0.4) return; // 준비 직후 오입력 방지
      const kinds: KickKind[] = sp.kind === 'penalty' ? ['shoot'] : sp.kind === 'freekick' ? ['shoot', 'pass', 'lob', 'through'] : ['pass', 'lob', 'through', 'shoot'];
      if (!m.charge) {
        for (const kind of kinds) {
          if (cmd[kind].pressed) {
            m.charge = { kind, value: 0, finesse: cmd.finesse.held, chip: false };
            break;
          }
        }
      }
      if (m.charge) {
        const btn = cmd[m.charge.kind];
        const shot = m.charge.kind === 'shoot' && (sp.kind === 'freekick' || sp.kind === 'penalty');
        m.charge.value = Math.min(1, m.charge.value + dt / (shot ? 1.0 : PASS.chargeTime));
        if (cmd.finesse.held) m.charge.finesse = true;
        if (btn.released || !btn.held) {
          const { kind, value, finesse } = m.charge;
          m.charge = null;
          if (sp.kind === 'penalty') this.take('shot', value, penaltyAim(sp.spot, t.attackDir, cmd.move.z));
          else if (shot) this.take('shot', value, t.facing.clone(), finesse);
          else this.take(kind === 'pass' ? 'short' : 'long', value, t.facing.clone());
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
    if (kind === 'freekick' || kind === 'indirect' || kind === 'penalty') {
      inward.set(m.oppGoalX(team) - spot.x, 0, -spot.z).normalize();
      if (!sp.shooting && kind !== 'penalty') inward.set(a, 0, 0);
    }
    taker.pos.copy(spot).addScaledVector(inward, kind === 'throwin' ? -0.25 : kind === 'penalty' ? -1.6 : -0.6);
    taker.facing.copy(inward);

    if (kind === 'penalty') {
      this.setupPenalty(sp);
    } else if (kind === 'freekick' || kind === 'indirect') {
      this.setupFreeKick(sp);
    } else if (kind === 'corner') {
      // 공격: 박스 안 지정 위치 / 수비: 가까운 상대를 마크, 남는 선수는 니어 포스트
      const end = Math.sign(spot.x);
      const side = Math.sign(spot.z);
      const others = att.filter((p) => p !== taker && !p.isKeeper);
      others.forEach((p, i) => {
        const [d, z] = CORNER_RUN_SPOTS[i];
        p.pos.set(end * (PITCH.halfL - d), 0, z * side);
      });
      att[0].pos.set(m.ownGoalX(team) + a * 1, 0, 0);
      const markers = def.filter((p) => !p.isKeeper);
      const free = [...others];
      for (const d of markers) {
        const target = free.shift();
        if (target) d.pos.set(target.pos.x + end * 0.9, 0, target.pos.z + 0.5);
        else d.pos.set(end * (PITCH.halfL - 1.5), 0, side * 2.6); // 니어 포스트
      }
      def[0].pos.set(end * (PITCH.halfL - 0.6), 0, side * 0.8);
    } else if (kind === 'goalkick') {
      // 차는 팀은 자기 진영에 넓게, 상대는 페널티 박스 밖에서 대기
      for (const p of att) {
        if (p === taker) continue;
        p.pos.set(a * (p.slot.fx + 5), 0, p.slot.z * a);
      }
      for (const p of def) {
        if (p.isKeeper) {
          p.pos.set(m.ownGoalX(p.team) - a * 0.8, 0, 0);
          continue;
        }
        const fx = Math.max(p.slot.fx + 20, -PITCH.halfL + PITCH.boxDepth + 2);
        p.pos.set(a * fx, 0, p.slot.z * -a);
      }
    } else {
      // 스로인: 동료 한 명은 가까이 받으러, 상대는 2m 이상 떨어져서 마크
      const side = Math.sign(spot.z);
      const mates = att.filter((p) => p !== taker && !p.isKeeper).sort((x, y) => x.pos.distanceTo(spot) - y.pos.distanceTo(spot));
      const mate = mates[0];
      mate.pos.set(THREE.MathUtils.clamp(spot.x + a * 5, -PITCH.halfL + 2, PITCH.halfL - 2), 0, spot.z - side * 6);
      if (mates[1]) mates[1].pos.set(THREE.MathUtils.clamp(spot.x - a * 4, -PITCH.halfL + 2, PITCH.halfL - 2), 0, spot.z - side * 8);
      def.filter((p) => !p.isKeeper).forEach((d, i) => {
        if (d.pos.distanceTo(spot) < 3) {
          d.pos.set(THREE.MathUtils.clamp(spot.x + (i - 4.5) * 1.5, -PITCH.halfL + 1, PITCH.halfL - 1), 0, spot.z - side * 4);
        }
      });
      const marker = def.filter((p) => !p.isKeeper).sort((x, y) => x.pos.distanceTo(mate.pos) - y.pos.distanceTo(mate.pos))[0];
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

  /** PK: 키커와 키퍼만 박스 안, 나머지는 박스 밖 아크 뒤로 */
  private setupPenalty(sp: SetPiece): void {
    const m = this.m;
    const a = m.teams[sp.team][0].attackDir;
    const gx = m.oppGoalX(sp.team);
    const keeper = m.teams[1 - sp.team][0];
    keeper.pos.set(gx - a * 0.3, 0, 0);
    keeper.faceTowards(sp.spot.x, sp.spot.z);
    const others = m.players.filter((p) => p !== sp.taker && p !== keeper && !p.isKeeper);
    const edge = gx - a * (PITCH.boxDepth + 1.5);
    // 박스 밖 + 아크 밖에서 두 줄로 선다
    others.forEach((p, i) => {
      const z = (i - (others.length - 1) / 2) * 2.1;
      p.pos.set(edge - a * (i % 2) * 1.5 - a * (Math.abs(z) < 7 ? 2 : 0), 0, z);
    });
    const ownKeeper = m.teams[sp.team][0];
    ownKeeper.pos.set(m.ownGoalX(sp.team) + a * 6, 0, 0);
  }

  /** 프리킥: 상대는 9.15m 밖. 슛 거리면 니어 포스트 쪽에 벽을 세운다 */
  private setupFreeKick(sp: SetPiece): void {
    const m = this.m;
    const { spot, team, taker } = sp;
    const def = m.teams[1 - team];
    const att = m.teams[team];
    const gx = m.oppGoalX(team);
    const toGoal = Math.hypot(gx - spot.x, spot.z);
    const wall: Player[] = [];
    if (sp.shooting) {
      const count = toGoal < 20 ? 5 : toGoal < 25 ? 4 : 3;
      const field = def.filter((p) => !p.isKeeper).sort((x, y) => x.pos.distanceTo(spot) - y.pos.distanceTo(spot));
      wall.push(...field.slice(0, count));
      // 공과 니어 포스트 안쪽을 잇는 선 위 9.15m
      const nearZ = (Math.sign(spot.z) || 1) * GOAL.width / 4;
      const line = new THREE.Vector3(gx - spot.x, 0, nearZ - spot.z).normalize();
      const side = new THREE.Vector3(-line.z, 0, line.x);
      const centre = spot.clone().addScaledVector(line, RULES.wallDistance);
      wall.forEach((p, i) => {
        p.pos.copy(centre).addScaledVector(side, (i - (count - 1) / 2) * 0.6);
        p.faceTowards(spot.x, spot.z);
      });
      const keeper = def[0];
      keeper.pos.set(gx - (att[0].attackDir) * 0.6, 0, -(Math.sign(spot.z) || 1) * 0.9);
    }
    // 나머지 상대는 공에서 9.15m 밖으로
    for (const p of def) {
      if (p.isKeeper || wall.includes(p)) continue;
      tmp.copy(p.pos).sub(spot).setY(0);
      const d = tmp.length();
      const min = RULES.wallDistance + 0.5;
      if (d >= min) continue;
      if (d < 0.1) tmp.set(-att[0].attackDir, 0, 0);
      p.pos.copy(spot).addScaledVector(tmp.normalize(), min);
      p.pos.x = THREE.MathUtils.clamp(p.pos.x, -PITCH.halfL + 0.5, PITCH.halfL - 0.5);
      p.pos.z = THREE.MathUtils.clamp(p.pos.z, -PITCH.halfW + 0.5, PITCH.halfW - 0.5);
    }
    // 같은 팀이 공 위에 겹쳐 서지 않게
    for (const p of att) {
      if (p === taker || p.isKeeper || p.pos.distanceTo(spot) > 2) continue;
      p.pos.addScaledVector(tmp.set(p.pos.x - spot.x, 0, p.pos.z - spot.z).normalize(), 3);
    }
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
    const rand = () => m.random.next();
    if (sp.kind === 'penalty') {
      // 구석을 노리되 침착성이 낮으면 가운데로 몰린다
      const side = rand() < 0.5 ? -1 : 1;
      const aim = side * (0.35 + 0.65 * Math.sqrt(rand()) * (0.6 + 0.4 * (t.profile.stats.composure / 99)));
      this.take('shot', 0.45 + rand() * 0.3, penaltyAim(sp.spot, t.attackDir, aim));
      return;
    }
    if (sp.shooting) {
      // 직접 프리킥: 벽을 넘겨 먼 쪽 구석으로 감아 찬다
      const far = -(Math.sign(sp.spot.z) || (rand() < 0.5 ? 1 : -1)) * (GOAL.width / 2 - 0.7);
      const dir = tmp.set(m.oppGoalX(sp.team) - t.pos.x, 0, far - t.pos.z).normalize().clone();
      t.facing.copy(dir);
      this.take('shot', 0.55 + rand() * 0.2, dir, true);
      return;
    }
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

  private take(style: 'short' | 'long' | 'shot', charge: number, dir: THREE.Vector3, finesse = false): void {
    const m = this.m;
    const sp = this.current!;
    const t = sp.taker;
    t.basePose = null;
    m.phase = 'playing';
    m.rules.exemptNext = NO_OFFSIDE.includes(sp.kind);
    if (style === 'shot') {
      // PK는 키퍼가 차는 순간 방향을 고르므로 동작만 맞추고 바로 찬다
      m.shoot(t, charge, finesse, dir, sp.kind === 'penalty');
      if (sp.kind === 'penalty') {
        // 키퍼는 차는 순간 한쪽을 골라 몸을 던진다 (사용자 키퍼면 누르고 있던 방향)
        const keeper = m.teams[1 - sp.team][0];
        const z = shotLineZ(sp.spot, m.ball.velocity, t.attackDir);
        const side = sp.team === 1 && m.userControl ? sideFromInput(this.userDive) : keeperGuess(() => m.random.next(), keeper, z);
        diveKeeper(keeper, side);
      }
    } else if (sp.kind === 'throwin') {
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
