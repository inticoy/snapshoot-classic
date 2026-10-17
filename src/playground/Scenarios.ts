import * as THREE from 'three';
import { BALL, PITCH, PLAYGROUND } from '../config';
import type { Player } from '../entities/Player';
import type { Match, PracticeOpponent } from '../gameplay/Match';
import type { PlaygroundScenario } from '../data/Playground';

/** 새 경기 객체를 만들지 않아 Game의 카메라·물리·터치와 같은 선수를 계속 사용한다. */
export class PlaygroundScenarios {
  private readonly roster: Player[];
  current: PlaygroundScenario = 'free';
  opponent: PracticeOpponent = 'press';

  constructor(private readonly match: Match) {
    this.roster = [...match.players];
  }

  reset(id: PlaygroundScenario = this.current, seed = PLAYGROUND.seed, opponent: PracticeOpponent = this.opponent, control: 'user' | 'opponent' = 'user'): void {
    this.current = id;
    const m = this.match;
    const attacker = this.roster.find((p) => p.team === 0 && p.slot.label === 'ST')!;
    const defender = this.roster.find((p) => p.team === 0 && p.role === 'DEF')!;
    const opponents = this.roster.filter((p) => p.team === 1 && p.role === 'DEF').slice(0, 3);
    const mate = this.roster.find((p) => p.team === 0 && p.slot.label === 'CM')!;
    const runner = this.roster.find((p) => p.team === 1 && p.slot.label === 'ST')!;
    const keeper = this.roster.find((p) => p.team === 1 && p.isKeeper)!;
    const user = id === 'slide' ? defender : attacker;
    const active = id === 'passing' ? [user, mate]
      : id === 'commands' ? [user, mate, opponents[0]]
      : id === 'cross' ? [user, mate, opponents[0]]
      : id === 'contact' || id === 'clearance' ? [user, opponents[0]]
      : id === 'free' ? [user]
      : id === 'duel' ? [user, opponents[0]]
      : id === 'pressure' ? [user, ...opponents]
      : id === 'receive' ? [user, mate]
      : id === 'slide' ? [user, runner] : [user, keeper];
    m.startPractice(active, user, seed);
    this.opponent = opponent;
    m.practiceOpponent = opponent;
    if (control === 'opponent') {
      const target = active.find((p) => p.team === 1 && !p.isKeeper);
      if (!target) throw new Error('조작할 상대 필드 선수가 없습니다');
      m.controlled = target;
      m.practiceControlLocked = true;
    }
    m.duration = PLAYGROUND.duration;
    user.pos.set(-20, 0, 0);
    user.facing.set(1, 0, 0);
    if (id === 'duel') opponents[0].pos.set(-16, 0, 0);
    if (id === 'pressure') {
      opponents[0].pos.set(-17, 0, 0);
      opponents[1].pos.set(-21, 0, 2.8);
      opponents[2].pos.set(-21, 0, -2.8);
    }
    if (id === 'keeper') {
      user.pos.set(PITCH.halfL - 22, 0, 0);
      keeper.pos.set(PITCH.halfL - 0.8, 0, 0);
    }
    for (const p of active) if (p.team === 1) p.facing.set(-1, 0, 0);
    let owner = user;
    if (id === 'commands' || id === 'passing') {
      mate.pos.set(-5, 0, 0); mate.facing.set(1, 0, 0);
      opponents[0].pos.set(-16, 0, 0.65);
      mate.actionLock = 0.65;
    }
    if (id === 'cross') {
      user.pos.set(35, 0, 24); user.facing.set(0, 0, -1);
      mate.pos.set(40, 0, 0); mate.actionLock = 0.65;
      opponents[0].pos.set(50, 0, 12);
    }
    if (id === 'contact' || id === 'clearance') {
      user.pos.set(-19.6, 0, 1);
      opponents[0].pos.set(-20, 0, 0); opponents[0].facing.set(1, 0, 0);
      owner = opponents[0];
    }
    if (id === 'slide') {
      user.pos.set(-2, 0, -1);
      runner.pos.set(5, 0, 0.5);
      runner.vel.set(-4, 0, 0);
      owner = runner;
    }
    if (id === 'receive') {
      mate.pos.copy(user.pos).add(new THREE.Vector3(-PLAYGROUND.passDistance, 0, 0));
      mate.facing.set(1, 0, 0);
      owner = mate;
    }
    m.ball.reset(owner.pos.x + owner.facing.x * 0.4, owner.pos.z + owner.facing.z * 0.4);
    m.ball.body.position.y = BALL.radius;
    m.ball.owner = m.ball.lastTouch = owner;
    if (id === 'clearance') m.ball.owner = null;
    // 초기 위치를 정한 뒤 AI 목표도 같은 위치로 초기화해야 첫 프레임에 예전 목표로 달리지 않는다.
    m.ai.reset();
    if (id === 'receive') {
      m.pass(mate, new THREE.Vector3(1, 0, 0), 'short', 0.5);
      mate.actionLock = PLAYGROUND.duration;
    }
    for (const p of m.players) p.syncVisual(0, 0);
  }
}
