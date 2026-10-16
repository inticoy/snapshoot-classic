import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SkinnedPlayerModel } from '../src/entities/SkinnedPlayerModel';

// 에셋 없이 동작 가중치·믹서만 붙인 모델 (update()의 동작 부분과 같은 순서로 돌린다)
function fakeModel() {
  const track = new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1]);
  const clip = new THREE.AnimationClip('celebrate', 1, [track]);
  const mixer = new THREE.AnimationMixer(new THREE.Object3D());
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.play();
  const model = Object.create(SkinnedPlayerModel.prototype) as SkinnedPlayerModel;
  Object.assign(model, { mixer, motion: { action, w: 1, loop: true, fadeOut: 0.18 } });
  const step = (dt: number) => {
    (model as unknown as { updateMotionWeight(dt: number): void }).updateMotionWeight(dt);
    mixer.update(dt);
  };
  return { model, step };
}

describe('세리머니 종료', () => {
  it('반복 세리머니를 멈추면 되감기지 않고 끝나 이동 클립으로 돌아간다', () => {
    const { model, step } = fakeModel();
    for (let i = 0; i < 90; i++) step(1 / 60); // 세리머니 반복 중
    expect(model.motionPlaying).toBe(true);
    model.stopMotion(); // 킥오프에서 basePose가 풀린 경우
    for (let i = 0; i < 60; i++) step(1 / 60);
    expect(model.motionPlaying).toBe(false);
  });
});
