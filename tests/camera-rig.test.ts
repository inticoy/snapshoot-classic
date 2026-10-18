import * as THREE from 'three';
import { expect, it } from 'vitest';
import { CameraRig } from '../src/camera/CameraRig';

it('근접 카메라의 화면 이동은 실제 카메라의 지면 방향과 일치한다', () => {
  const rig = new CameraRig(2);
  for (const angle of [0, Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
    rig.setCloseUp({ angle, facing: new THREE.Vector3(1, 0, 0) }, true);
    rig.update(1 / 60, { x: 1, y: 0, z: 0 }, new THREE.Vector3(), null);
    const forward = rig.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    expect(rig.forward(new THREE.Vector3()).distanceTo(forward)).toBeLessThan(1e-10);
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    expect(rig.right(new THREE.Vector3()).distanceTo(right)).toBeLessThan(1e-10);
  }
});
