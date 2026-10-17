import * as THREE from 'three';
import type { AnimState, CharacterModel } from '../entities/PlayerModel';

/** 화면 없는 선수 모델 (서버·재생·검증·플레이그라운드 스크립트) */
export class HeadlessModel implements CharacterModel {
  readonly root = new THREE.Group();
  current: AnimState = 'idle';
  play(state: AnimState): void { this.current = state; }
  setLocomotion(): void {}
  update(): void {}
}
