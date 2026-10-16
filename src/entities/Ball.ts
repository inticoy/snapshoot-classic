import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BALL } from '../config';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Player } from './Player';

const tmpV = new CANNON.Vec3();
const tmpQ = new THREE.Quaternion();

export class Ball {
  readonly body: CANNON.Body;
  readonly object = new THREE.Group();
  readonly shadow: THREE.Mesh;

  owner: Player | null = null;
  lastTouch: Player | null = null;
  /** 현재 진행 중인 슛 (키퍼 선방 판정용) */
  shot: { id: number; by: Player; saveRolled: boolean } | null = null;
  private shotCounter = 0;

  constructor(physics: PhysicsWorld) {
    this.body = new CANNON.Body({
      mass: BALL.mass,
      shape: new CANNON.Sphere(BALL.radius),
      material: physics.materials.ball,
      linearDamping: 0,
      angularDamping: 0.05,
    });
    this.body.position.set(0, BALL.radius, 0);
    physics.world.addBody(this.body);

    physics.world.addEventListener('preStep', () => this.applyAerodynamics());

    // 로딩 전 임시 메시
    const fallback = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
    );
    fallback.castShadow = true;
    this.object.add(fallback);

    // 공 그림자 블롭 (높이 감각을 위해)
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL.radius * 1.3, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
  }

  async load(url: string): Promise<void> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      const pivot = new THREE.Group();
      pivot.add(model);
      pivot.scale.setScalar((BALL.radius * 2) / Math.max(size.x, size.y, size.z));
      model.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) c.castShadow = true;
      });
      this.object.clear();
      this.object.add(pivot);
    } catch (e) {
      console.warn('ball model load failed, using fallback', e);
    }
  }

  get position(): CANNON.Vec3 {
    return this.body.position;
  }

  get velocity(): CANNON.Vec3 {
    return this.body.velocity;
  }

  get isGrounded(): boolean {
    return this.body.position.y < BALL.radius + 0.03;
  }

  speed(): number {
    return this.body.velocity.length();
  }

  newShot(by: Player): void {
    this.shot = { id: ++this.shotCounter, by, saveRolled: false };
  }

  /** 소유자 발 앞으로 공을 끌고 다닌다 (드리블) */
  carry(target: CANNON.Vec3, carrierVel: CANNON.Vec3, dt: number, height = BALL.radius): void {
    const p = this.body.position;
    const k = 1 - Math.exp(-18 * dt);
    const nx = p.x + (target.x - p.x) * k + carrierVel.x * dt;
    const nz = p.z + (target.z - p.z) * k + carrierVel.z * dt;
    const ny = p.y + (height - p.y) * k;
    // 위치는 물리 엔진이 적분하도록 속도만 지정한다
    this.body.velocity.set((nx - p.x) / dt, (ny - p.y) / dt, (nz - p.z) / dt);
    // 굴러가는 회전
    const v = this.body.velocity;
    this.body.angularVelocity.set(v.z / BALL.radius, 0, -v.x / BALL.radius);
  }

  kick(velocity: CANNON.Vec3, spin: CANNON.Vec3, by: Player): void {
    this.owner = null;
    this.lastTouch = by;
    this.body.velocity.copy(velocity);
    // 사이드스핀만 준다 (굴림 회전은 지면 마찰이 만들어 준다)
    this.body.angularVelocity.copy(spin);
    this.body.wakeUp();
  }

  reset(x = 0, z = 0): void {
    this.owner = null;
    this.shot = null;
    this.lastTouch = null;
    this.body.position.set(x, BALL.radius, z);
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
  }

  private applyAerodynamics(): void {
    if (this.owner) return;
    const v = this.body.velocity;
    const speed = v.length();
    if (speed < 0.01) return;

    // 공기 저항
    this.body.force.x -= BALL.drag * speed * v.x;
    this.body.force.y -= BALL.drag * speed * v.y;
    this.body.force.z -= BALL.drag * speed * v.z;

    if (!this.isGrounded) {
      // 마그누스 효과: 회전하는 공이 휘어진다 (감아차기)
      this.body.angularVelocity.cross(v, tmpV);
      this.body.force.x += BALL.magnus * tmpV.x;
      this.body.force.y += BALL.magnus * tmpV.y;
      this.body.force.z += BALL.magnus * tmpV.z;
    } else {
      // 잔디 구름 저항
      const h = Math.hypot(v.x, v.z);
      if (h > 0.01) {
        const decel = BALL.rollingDecel + BALL.rollingDamping * h;
        const f = (Math.min(decel, h * 60) * BALL.mass) / h;
        this.body.force.x -= v.x * f;
        this.body.force.z -= v.z * f;
      }
      // 땅에서는 사이드스핀이 빨리 죽는다
      this.body.angularVelocity.y *= 0.97;
    }
  }

  syncVisual(): void {
    const p = this.body.position;
    this.object.position.set(p.x, p.y, p.z);
    const q = this.body.quaternion;
    tmpQ.set(q.x, q.y, q.z, q.w);
    this.object.quaternion.copy(tmpQ);
    this.shadow.position.set(p.x, 0.012, p.z);
    const h = Math.max(0, p.y - BALL.radius);
    const s = 1 + h * 0.25;
    this.shadow.scale.setScalar(s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.35 / (1 + h * 0.6);
  }
}
