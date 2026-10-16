import * as CANNON from 'cannon-es';
import { PHYSICS } from '../config';

export interface Materials {
  ground: CANNON.Material;
  ball: CANNON.Material;
  post: CANNON.Material;
  net: CANNON.Material;
  board: CANNON.Material;
}

export class PhysicsWorld {
  readonly world: CANNON.World;
  readonly materials: Materials;
  readonly ground: CANNON.Body;

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYSICS.gravity, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    (this.world.solver as CANNON.GSSolver).iterations = 12;
    this.world.allowSleep = false;

    this.materials = {
      ground: new CANNON.Material('ground'),
      ball: new CANNON.Material('ball'),
      post: new CANNON.Material('post'),
      net: new CANNON.Material('net'),
      board: new CANNON.Material('board'),
    };

    const { ball, ground, post, net, board } = this.materials;
    this.world.addContactMaterial(new CANNON.ContactMaterial(ball, ground, { restitution: 0.62, friction: 0.45 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(ball, post, { restitution: 0.75, friction: 0.1 }));
    // 골망: 공을 흡수하도록 낮은 반발, 높은 마찰
    this.world.addContactMaterial(new CANNON.ContactMaterial(ball, net, { restitution: 0.05, friction: 0.9 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(ball, board, { restitution: 0.55, friction: 0.2 }));

    this.ground = new CANNON.Body({ mass: 0, material: ground, shape: new CANNON.Plane() });
    this.ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(this.ground);
  }

  addStaticBox(
    halfExtents: [number, number, number],
    position: [number, number, number],
    material: CANNON.Material,
  ): CANNON.Body {
    const body = new CANNON.Body({
      mass: 0,
      material,
      shape: new CANNON.Box(new CANNON.Vec3(...halfExtents)),
      position: new CANNON.Vec3(...position),
    });
    this.world.addBody(body);
    return body;
  }

  step(dt: number): void {
    const sub = dt / PHYSICS.subSteps;
    for (let i = 0; i < PHYSICS.subSteps; i++) this.world.step(sub);
  }
}
