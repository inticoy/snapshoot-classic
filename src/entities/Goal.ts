import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GOAL, PITCH, STADIUM } from '../config';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { visualRandom } from '../core/Random';

interface NetPanel {
  geometry: THREE.BufferGeometry;
  rest: Float32Array;
  normal: THREE.Vector3;
  object: THREE.Object3D;
  detailed: boolean;
}

const NET_TOP_DEPTH = 1.0;
const NET_CELL = 0.16;

/**
 * 골대 하나. side = +1 이면 +X 끝(홈팀이 공격하는 골대).
 * 그물 출렁임 아이디어는 snapshoot의 GoalNetAnimator에서 가져와 단순화했다.
 */
export class Goal {
  readonly group = new THREE.Group();
  readonly postBodies: CANNON.Body[] = [];
  readonly netBodies: CANNON.Body[] = [];
  private readonly panels: NetPanel[] = [];
  private readonly impact = new THREE.Vector3();
  private rippleAmp = 0;
  private rippleT = 0;
  private time = visualRandom.next() * 10;
  /** 그물이 제자리에 멈춰 있어 다시 계산할 필요가 없는가 */
  private settled = false;

  constructor(
    readonly side: 1 | -1,
    physics: PhysicsWorld,
    visuals = true,
  ) {
    const x0 = side * PITCH.halfL;
    const hw = GOAL.width / 2 + GOAL.postRadius;
    const h = GOAL.height + GOAL.postRadius;
    const r = GOAL.postRadius;
    const out = side; // 그물이 뻗어나가는 방향

    // --- 골대 기둥/크로스바 ---
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.1 });
    const postGeo = new THREE.CylinderGeometry(r, r, h, STADIUM.postSegments);
    for (const z of [-hw, hw]) {
      const m = new THREE.Mesh(postGeo, postMat);
      m.position.set(x0 + out * r, h / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);

      const body = new CANNON.Body({
        mass: 0,
        material: physics.materials.post,
        shape: new CANNON.Cylinder(r, r, h, 12),
        position: new CANNON.Vec3(x0 + out * r, h / 2, z),
      });
      physics.world.addBody(body);
      this.postBodies.push(body);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GOAL.width + r * 4, STADIUM.postSegments), postMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(x0 + out * r, h, 0);
    bar.castShadow = true;
    this.group.add(bar);
    const barBody = new CANNON.Body({ mass: 0, material: physics.materials.post });
    const barShape = new CANNON.Cylinder(r, r, GOAL.width + r * 4, 12);
    const barQ = new CANNON.Quaternion();
    barQ.setFromEuler(Math.PI / 2, 0, 0);
    barBody.addShape(barShape, new CANNON.Vec3(0, 0, 0), barQ);
    barBody.position.set(x0 + out * r, h, 0);
    physics.world.addBody(barBody);
    this.postBodies.push(barBody);

    // 뒤쪽 지지대 (얇은 회색 프레임)
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.5 });
    const xTop = x0 + out * NET_TOP_DEPTH;
    const xBottom = x0 + out * GOAL.depth;
    for (const z of [-hw, hw]) {
      const a = new THREE.Vector3(xTop, h, z);
      const b = new THREE.Vector3(xBottom, 0, z);
      this.group.add(tube(a, b, 0.025, frameMat));
      this.group.add(tube(new THREE.Vector3(x0, h, z), a, 0.025, frameMat));
      this.group.add(tube(new THREE.Vector3(x0, 0.02, z), b.clone().setY(0.02), 0.025, frameMat));
    }
    this.group.add(tube(new THREE.Vector3(xTop, h, -hw), new THREE.Vector3(xTop, h, hw), 0.025, frameMat));
    this.group.add(tube(new THREE.Vector3(xBottom, 0.02, -hw), new THREE.Vector3(xBottom, 0.02, hw), 0.025, frameMat));

    // 이음부와 바닥 소켓은 시각 전용이며 충돌 규격은 기존 실린더 그대로 둔다.
    for (const z of [-hw, hw]) {
      const socket = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.045, STADIUM.postSegments), frameMat);
      socket.position.set(x0 + out * r, 0.0225, z);
      this.group.add(socket);
    }

    // --- 그물 (시각) ---
    if (visuals) {
      const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
      const pTL = P(x0, h, -hw), pTR = P(x0, h, hw);
      const pRL = P(xTop, h, -hw), pRR = P(xTop, h, hw);
      const pBL = P(xBottom, 0, -hw), pBR = P(xBottom, 0, hw);
      const pGL = P(x0, 0, -hw), pGR = P(x0, 0, hw);
      this.addPanel(pTL, pTR, pRR, pRL, P(0, 1, 0)); // 지붕
      this.addPanel(pRL, pRR, pBR, pBL, P(out * h, GOAL.depth - NET_TOP_DEPTH, 0)); // 뒷면
      this.addSidePanel(pGL, pTL, pRL, pBL, P(0, 0, -1));
      this.addSidePanel(pGR, pTR, pRR, pBR, P(0, 0, 1));
    }

    // --- 그물 (물리) ---
    const netMat = physics.materials.net;
    const t = 0.05;
    // 지붕
    this.netBodies.push(
      physics.addStaticBox([NET_TOP_DEPTH / 2, t, hw], [x0 + out * (NET_TOP_DEPTH / 2), h + t, 0], netMat),
    );
    // 뒷면 (기울어진 판)
    const dx = GOAL.depth - NET_TOP_DEPTH;
    const backLen = Math.hypot(dx, h);
    const back = new CANNON.Body({ mass: 0, material: netMat });
    back.addShape(new CANNON.Box(new CANNON.Vec3(t, backLen / 2, hw)));
    back.position.set(x0 + out * (NET_TOP_DEPTH + dx / 2 + t), h / 2, 0);
    back.quaternion.setFromEuler(0, 0, out * Math.atan2(dx, h));
    physics.world.addBody(back);
    this.netBodies.push(back);
    // 옆면
    for (const z of [-hw - t, hw + t]) {
      this.netBodies.push(
        physics.addStaticBox([GOAL.depth / 2, h / 2, t], [x0 + out * (GOAL.depth / 2), h / 2, z], netMat),
      );
    }
  }

  private addPanel(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, normal: THREE.Vector3): void {
    // a-b-c-d 사각형을 격자로 나눈다
    const nu = Math.max(2, Math.round(a.distanceTo(b) / NET_CELL));
    const nv = Math.max(2, Math.round(a.distanceTo(d) / NET_CELL));
    const grid: THREE.Vector3[][] = [];
    for (let i = 0; i <= nv; i++) {
      const row: THREE.Vector3[] = [];
      const left = a.clone().lerp(d, i / nv);
      const right = b.clone().lerp(c, i / nv);
      for (let j = 0; j <= nu; j++) row.push(left.clone().lerp(right, j / nu));
      grid.push(row);
    }
    this.buildLines(grid, normal);
  }

  private addSidePanel(g: THREE.Vector3, t: THREE.Vector3, rt: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3): void {
    // 사다리꼴: 골라인(g-t)에서 뒤쪽(b-rt)까지
    const nu = Math.max(2, Math.round(GOAL.depth / NET_CELL));
    const nv = Math.max(2, Math.round(GOAL.height / NET_CELL));
    const grid: THREE.Vector3[][] = [];
    for (let i = 0; i <= nv; i++) {
      const v = i / nv;
      const front = g.clone().lerp(t, v);
      const rear = b.clone().lerp(rt, v);
      const row: THREE.Vector3[] = [];
      for (let j = 0; j <= nu; j++) row.push(front.clone().lerp(rear, j / nu));
      grid.push(row);
    }
    this.buildLines(grid, normal);
  }

  private buildLines(grid: THREE.Vector3[][], normal: THREE.Vector3): void {
    // 프레임 경계는 고정하고 가운데만 처지게 하여 팽팽한 평면 느낌을 줄인다.
    const n = normal.clone().normalize();
    for (let i = 0; i < grid.length; i++) for (let j = 0; j < grid[i].length; j++) {
      const sag = Math.sin(Math.PI * i / (grid.length - 1)) * Math.sin(Math.PI * j / (grid[i].length - 1));
      grid[i][j].addScaledVector(n, STADIUM.netSag * sag * (n.y === 1 ? -1 : 1));
      if (n.y !== 1) grid[i][j].y -= STADIUM.netSag * sag * 0.35;
    }
    const pts: number[] = [];
    const push = (p: THREE.Vector3, q: THREE.Vector3) => pts.push(p.x, p.y, p.z, q.x, q.y, q.z);
    for (let i = 0; i < grid.length; i++) {
      for (let j = 0; j < grid[i].length; j++) {
        if (j + 1 < grid[i].length) push(grid[i][j], grid[i][j + 1]);
        if (i + 1 < grid.length) push(grid[i][j], grid[i + 1][j]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    const arr = new Float32Array(pts);
    geometry.setAttribute('position', new THREE.BufferAttribute(arr.slice(), 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xf2f4f8, transparent: true, opacity: 0.75 }),
    );
    this.group.add(lines);
    this.panels.push({ geometry, rest: arr, normal: n, object: lines, detailed: false });

    // high는 세계 좌표 폭을 가진 실 리본으로 태양·환경광을 받는다. low는 기존 선분 비용을 유지한다.
    const ribbon: number[] = [], indices: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), offset = new THREE.Vector3();
    for (let i = 0; i < pts.length; i += 6) {
      a.fromArray(pts, i); b.fromArray(pts, i + 3);
      offset.subVectors(b, a).cross(n).normalize().multiplyScalar(STADIUM.netThreadRadius);
      const start = ribbon.length / 3;
      for (const [point, sign] of [[a, -1], [a, 1], [b, -1], [b, 1]] as const) {
        ribbon.push(point.x + offset.x * sign, point.y + offset.y * sign, point.z + offset.z * sign);
      }
      indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
    }
    const detailGeo = new THREE.BufferGeometry();
    const rest = new Float32Array(ribbon);
    detailGeo.setAttribute('position', new THREE.BufferAttribute(rest.slice(), 3));
    detailGeo.setIndex(indices);
    detailGeo.computeVertexNormals();
    detailGeo.computeBoundingSphere();
    detailGeo.boundingSphere!.radius += 0.5;
    geometry.computeBoundingSphere();
    geometry.boundingSphere!.radius += 0.5;
    const mesh = new THREE.Mesh(detailGeo, new THREE.MeshStandardMaterial({ color: 0xe1e6da, roughness: 0.95, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.panels.push({ geometry: detailGeo, rest, normal: n, object: mesh, detailed: true });
    lines.visible = false;
  }

  setVisualQuality(quality: 'high' | 'low'): void {
    for (const panel of this.panels) panel.object.visible = panel.detailed === (quality === 'high');
  }

  /** 공이 그물에 닿았을 때 출렁임 시작 */
  hitNet(point: THREE.Vector3, strength: number): void {
    this.impact.copy(point);
    this.rippleAmp = Math.min(0.45, Math.max(this.rippleAmp, strength * 0.02));
    this.rippleT = 0;
  }

  update(dt: number): void {
    this.time += dt;
    this.rippleT += dt;
    this.rippleAmp *= Math.exp(-2.2 * dt);
    // 그물 정점 수천 개를 매 물리 스텝마다 다시 계산하면 느린 기기에서 프레임이 크게 떨어진다.
    // 공에 맞아 출렁이는 동안만 계산하고, 멎으면 한 번 제자리로 돌려놓은 뒤 멈춘다 (가만히 흔들리는 효과는 뺐다)
    const moving = this.rippleAmp > 0.002;
    if (!moving && this.settled) return;
    this.settled = !moving;
    const halfL = PITCH.halfL;
    for (const panel of this.panels) {
      if (!panel.object.visible) continue;
      const pos = panel.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const rest = panel.rest;
      const n = panel.normal;
      for (let i = 0; i < rest.length; i += 3) {
        const x = rest[i], y = rest[i + 1], z = rest[i + 2];
        // 지면/골대 프레임에 붙은 점은 덜 움직이게
        const edge = Math.max(0, GOAL.width / 2 + GOAL.postRadius - Math.abs(z));
        if (!moving) { arr[i] = x; arr[i + 1] = y; arr[i + 2] = z; continue; }
        const rearBar = Math.hypot(Math.abs(x) - halfL - NET_TOP_DEPTH, y - GOAL.height - GOAL.postRadius);
        const pin = Math.min(1, y / 0.4) * Math.min(1, Math.abs(Math.abs(x) - halfL) / 0.4)
          * Math.min(1, edge / 0.25) * Math.min(1, rearBar / 0.15);
        let d = 0;
        {
          const dx = x - this.impact.x, dy = y - this.impact.y, dz = z - this.impact.z;
          const dist2 = dx * dx + dy * dy + dz * dz;
          d += this.rippleAmp * Math.exp(-dist2 / 0.7) * Math.cos(this.rippleT * 14 - Math.sqrt(dist2) * 5);
        }
        d *= pin;
        arr[i] = x + n.x * d;
        arr[i + 1] = y + n.y * d;
        arr[i + 2] = z + n.z * d;
      }
      pos.needsUpdate = true;
    }
  }
}

function tube(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
