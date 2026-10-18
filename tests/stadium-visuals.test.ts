import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GRAPHICS, PITCH } from '../src/config';
import { Lighting } from '../src/environment/Lighting';
import { Stadium } from '../src/environment/Stadium';
import { Goal } from '../src/entities/Goal';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

// GPU가 없는 테스트에서도 실제 생성 메시·카메라·충돌체를 검사한다. 캔버스 그리기만 대체한다.
function canvasDocument(): void {
  const gradient = { addColorStop: vi.fn() };
  const context = new Proxy({
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    measureText: () => ({ width: 100 }),
  }, { get: (object, key) => key in object ? object[key as keyof typeof object] : () => {} });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
}

afterEach(() => vi.unstubAllGlobals());

describe('경기장 시각 전용 품질', () => {
  it('근접 그림자는 시선 교점을 따라가고 텍셀보다 작은 이동에는 흔들리지 않는다', () => {
    canvasDocument();
    const scene = new THREE.Scene();
    const lighting = new Lighting(scene, {} as THREE.WebGLRenderer);
    lighting.setQuality('low');
    const camera = new THREE.PerspectiveCamera(40, 1.8, 0.1, 500);
    camera.position.set(20, 3, 7);
    camera.lookAt(20, 0, 0);
    lighting.update(camera);
    const before = lighting.sun.position.clone();
    expect(lighting.sun.target.position.distanceTo(new THREE.Vector3(20, 0, 0))).toBeLessThan(0.04);
    expect(lighting.sun.shadow.camera.right).toBe(GRAPHICS.low.closeShadowExtent);
    camera.position.x += 0.000001;
    camera.lookAt(20.000001, 0, 0);
    lighting.update(camera);
    expect(lighting.sun.position.distanceTo(before)).toBeLessThan(0.00001);
    camera.position.set(-40, 24, -20);
    camera.lookAt(-40, 0, -30);
    lighting.update(camera);
    expect(lighting.sun.target.position.distanceTo(new THREE.Vector3(-40, 0, -30))).toBeLessThan(0.1);
    expect(lighting.sun.shadow.camera.right).toBe(GRAPHICS.low.shadowExtent);
    expect(scene.environment).toBeNull();
  });

  it('low 전환은 잔디·구조물 비용을 줄이며 광고판 충돌체는 바꾸지 않는다', () => {
    canvasDocument();
    const physics = new PhysicsWorld();
    const stadium = new Stadium(physics);
    const bodies = [...physics.world.bodies];
    const signature = () => physics.world.bodies.map((body) => [body.id, body.position.toArray(), body.shapes.length]);
    const initial = signature();
    const meshes = () => {
      let meshes = 0, triangles = 0, drawCalls = 0;
      stadium.group.traverseVisible((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes++;
        drawCalls += Array.isArray(object.material) ? object.geometry.groups.length : 1;
        const count = object instanceof THREE.InstancedMesh ? object.count : 1;
        triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3 * count;
      });
      return { meshes, triangles, drawCalls };
    };
    stadium.setQuality('high');
    const high = meshes();
    stadium.setQuality('low');
    stadium.setCrowdDensity(GRAPHICS.low.crowdDensity);
    const low = meshes();
    console.info('경기장 메시 예산 (그림자 패스·골대·선수 제외)', { high, low });
    expect(low.triangles).toBeLessThan(high.triangles / 2);
    expect(high.meshes).toBeLessThan(45);
    expect(low.meshes).toBeLessThan(40);
    expect(signature()).toEqual(initial);
    expect(physics.world.bodies).toEqual(bodies);
    // 누락되거나 퇴화한 합성 메시를 검출한다.
    stadium.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.computeBoundingSphere();
      expect(Number.isFinite(object.geometry.boundingSphere!.radius)).toBe(true);
    });
  });

  it('그물 품질 전환·출렁임은 충돌체와 시뮬레이션에 영향을 주지 않는다', () => {
    const physics = new PhysicsWorld();
    const goal = new Goal(1, physics);
    const bodies = physics.world.bodies.map((body) => ({ position: body.position.toArray(), shapes: body.shapes.map((shape) => shape.type) }));
    const objects: THREE.Object3D[] = [];
    goal.group.traverse((object) => { if (object instanceof THREE.LineSegments) objects.push(object); });
    expect(objects).toHaveLength(4);
    goal.setVisualQuality('low');
    expect(objects.every((object) => object.visible)).toBe(true);
    goal.hitNet(new THREE.Vector3(PITCH.halfL + 1, 1, 0), 25);
    goal.update(0.1);
    goal.setVisualQuality('high');
    expect(objects.every((object) => !object.visible)).toBe(true);
    goal.update(0.1);
    expect(physics.world.bodies.map((body) => ({ position: body.position.toArray(), shapes: body.shapes.map((shape) => shape.type) }))).toEqual(bodies);
  });
});
