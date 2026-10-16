import * as THREE from 'three';
import { PITCH } from '../src/config';
import { Random } from '../src/core/Random';
import { Match, type MatchOptions, type UserCommand } from '../src/gameplay/Match';
import type { CharacterModel, AnimState } from '../src/entities/PlayerModel';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

// 캔버스나 GLTF를 흉내 내지 않고 시각 인터페이스만 주입한다.
class SimulationModel implements CharacterModel {
  readonly root = new THREE.Group();
  current: AnimState = 'idle';
  play(state: AnimState): void { this.current = state; }
  setLocomotion(): void {}
  update(): void {}
}

export function simulation(seed = 0, options: MatchOptions = {}) {
  const physics = new PhysicsWorld();
  const match = new Match(physics, {
    random: new Random(seed),
    createPlayerModel: () => new SimulationModel(),
    goalVisuals: false,
    ...options,
  });
  return { physics, match };
}

export function command(): UserCommand {
  const button = () => ({ held: false, pressed: false, released: false });
  return {
    move: new THREE.Vector3(), sprint: false,
    shoot: button(), pass: button(), through: button(), lob: button(),
    modifier: button(), finesse: button(), contain: button(), tackle: button(),
  };
}

export function parkPlayers(match: Match): void {
  match.phase = 'playing';
  match.phaseTimer = 0;
  match.ball.reset();
  match.players.forEach((p, i) => {
    p.pos.set(-PITCH.halfL + 2 + i * 2, 0, PITCH.halfW - 2);
    p.vel.set(0, 0, 0);
    p.actionLock = 60;
  });
}
