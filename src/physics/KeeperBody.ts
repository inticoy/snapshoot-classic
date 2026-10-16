import * as CANNON from 'cannon-es';
import { KEEPER } from '../config';
import type { Player } from '../entities/Player';
import { KEEPER_BODY } from './presets';
import type { PhysicsWorld } from './PhysicsWorld';

/** 선수 이동은 기존 로직을 쓰고 공에 주는 충격만 Cannon 접촉 방정식으로 푼다. */
export class KeeperBody {
  readonly body: CANNON.Body;
  private roll = 0;
  private height: number = KEEPER_BODY.standingHeight;
  private readonly yaw = new CANNON.Quaternion();
  private readonly tilt = new CANNON.Quaternion();

  constructor(readonly player: Player, physics: PhysicsWorld) {
    this.body = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      mass: 0,
      material: physics.materials.keeper,
      collisionFilterGroup: 2,
      collisionFilterMask: 0,
    });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(...KEEPER_BODY.torso)), new CANNON.Vec3(0, 0.23, 0));
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(...KEEPER_BODY.legs)), new CANNON.Vec3(0, -0.38, 0));
    this.body.addShape(new CANNON.Sphere(KEEPER_BODY.headRadius), new CANNON.Vec3(0, 0.66, 0));
    physics.world.addBody(this.body);
  }

  sync(dt: number, active: boolean): void {
    const k = this.player;
    const diving = k.diveTimer > 0;
    const duration = k.diveKind === 'smother' ? KEEPER.smotherDuration : KEEPER.diveDuration;
    const progress = diving ? Math.min(1, (duration - k.diveTimer) / KEEPER_BODY.poseTime) : 0;
    const targetRoll = diving ? k.diveSide * KEEPER_BODY.roll * progress : 0;
    // 일어나는 동안에도 누워 있는 몸통이 갑자기 수직 벽으로 바뀌지 않게 한다.
    const blend = diving ? 1 : 1 - Math.exp(-dt / KEEPER_BODY.poseTime);
    this.roll += (targetRoll - this.roll) * blend;
    const targetHeight = KEEPER_BODY.standingHeight + (KEEPER_BODY.lyingHeight - KEEPER_BODY.standingHeight) * Math.min(1, Math.abs(this.roll) / KEEPER_BODY.roll);
    this.height = targetHeight;
    this.yaw.setFromEuler(0, Math.atan2(k.facing.x, k.facing.z), 0);
    this.tilt.setFromEuler(0, 0, this.roll);
    this.yaw.mult(this.tilt, this.body.quaternion);
    // Player.update가 이미 한 스텝 이동했다. 서브스텝 적분이 끝나면 같은 위치에 도달한다.
    this.body.position.set(k.pos.x - k.vel.x * dt, this.height, k.pos.z - k.vel.z * dt);
    this.body.velocity.set(k.vel.x, 0, k.vel.z);
    this.body.angularVelocity.setZero();
    this.body.collisionFilterMask = active ? 1 : 0;
    this.body.aabbNeedsUpdate = true;
  }

  reset(): void {
    this.roll = 0;
    this.height = KEEPER_BODY.standingHeight;
    this.sync(0, false);
  }
}
