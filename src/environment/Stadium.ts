import * as THREE from 'three';
import { PITCH } from '../config';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

const AREA_L = PITCH.length + PITCH.runoffEnd * 2;
const AREA_W = PITCH.width + PITCH.runoffSide * 2;

export class Stadium {
  readonly group = new THREE.Group();
  private crowd!: THREE.InstancedMesh;
  private crowdBase: { pos: THREE.Vector3; phase: number; rotY: number }[] = [];
  private excitement = 0;
  private time = 0;

  constructor(physics: PhysicsWorld) {
    this.buildPitch();
    this.buildBoards(physics);
    this.buildStands();
    this.buildFloodlights();
  }

  private buildPitch(): void {
    const ppm = 32;
    const c = document.createElement('canvas');
    c.width = Math.round(AREA_L * ppm);
    c.height = Math.round(AREA_W * ppm);
    const g = c.getContext('2d')!;
    const X = (x: number) => (x + AREA_L / 2) * ppm;
    const Z = (z: number) => (z + AREA_W / 2) * ppm;

    // 잔디 줄무늬
    g.fillStyle = '#3f8f3a';
    g.fillRect(0, 0, c.width, c.height);
    const stripe = 5;
    for (let i = 0; i * stripe < AREA_L; i++) {
      g.fillStyle = i % 2 ? '#3a8636' : '#459a3f';
      g.fillRect(i * stripe * ppm, 0, stripe * ppm + 1, c.height);
    }
    // 잔디 노이즈
    const img = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n;
      img.data[i + 1] += n * 1.2;
      img.data[i + 2] += n * 0.6;
    }
    g.putImageData(img, 0, 0);

    // 라인
    const hl = PITCH.halfL, hw = PITCH.halfW;
    g.strokeStyle = 'rgba(255,255,255,0.92)';
    g.lineWidth = 0.12 * ppm;
    const rect = (x0: number, z0: number, x1: number, z1: number) =>
      g.strokeRect(X(Math.min(x0, x1)), Z(Math.min(z0, z1)), Math.abs(x1 - x0) * ppm, Math.abs(z1 - z0) * ppm);
    rect(-hl, -hw, hl, hw);
    g.beginPath();
    g.moveTo(X(0), Z(-hw));
    g.lineTo(X(0), Z(hw));
    g.stroke();
    g.beginPath();
    g.arc(X(0), Z(0), PITCH.centerCircle * ppm, 0, Math.PI * 2);
    g.stroke();
    for (const s of [-1, 1]) {
      const bx = s * (hl - PITCH.boxDepth);
      rect(s * hl, -PITCH.boxWidth / 2, bx, PITCH.boxWidth / 2);
      rect(s * hl, -4.5, s * (hl - 3), 4.5);
      // 페널티 아크
      g.beginPath();
      const spot = s * (hl - 6.5);
      const start = s === 1 ? Math.PI * 0.68 : -Math.PI * 0.32;
      g.arc(X(spot), Z(0), 5 * ppm, start, start + Math.PI * 0.64);
      g.stroke();
      // 코너 아크
      for (const t of [-1, 1]) {
        g.beginPath();
        g.arc(X(s * hl), Z(t * hw), 1 * ppm, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (const x of [0, -(hl - 6.5), hl - 6.5]) {
      g.beginPath();
      g.arc(X(x), Z(0), 0.15 * ppm, 0, Math.PI * 2);
      g.fill();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(AREA_L, AREA_W),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.group.add(grass);

    // 경기장 바깥 트랙
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(AREA_L + 40, AREA_W + 40),
      new THREE.MeshStandardMaterial({ color: 0x2c4a2a, roughness: 1 }),
    );
    track.rotation.x = -Math.PI / 2;
    track.position.y = -0.01;
    track.receiveShadow = true;
    this.group.add(track);
  }

  private buildBoards(physics: PhysicsWorld): void {
    const h = 0.9;
    const t = 0.15;
    const ex = AREA_L / 2;
    const ez = AREA_W / 2;
    const tex = makeAdTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 });
    const backMat = new THREE.MeshStandardMaterial({ color: 0x20242c });
    const addBoard = (len: number, x: number, z: number, rotY: number) => {
      const geo = new THREE.BoxGeometry(len, h, t);
      const m = new THREE.Mesh(geo, [backMat, backMat, backMat, backMat, mat, backMat]);
      m.position.set(x, h / 2, z);
      m.rotation.y = rotY;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      // 텍스처 반복 (길이에 비례)
      const repeat = len / 16;
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 16; i < 20; i++) uv.setX(i, uv.getX(i) * repeat);
      tex.wrapS = THREE.RepeatWrapping;
    };
    addBoard(AREA_L, 0, -ez - t / 2, 0);
    addBoard(AREA_L, 0, ez + t / 2, Math.PI);
    addBoard(AREA_W, -ex - t / 2, 0, Math.PI / 2);
    addBoard(AREA_W, ex + t / 2, 0, -Math.PI / 2);

    // 물리 벽: 광고판 + 보이지 않는 높은 벽
    const wallH = 30;
    const m = physics.materials.board;
    physics.addStaticBox([AREA_L / 2 + 1, wallH / 2, 0.5], [0, wallH / 2, -ez - 0.5], m);
    physics.addStaticBox([AREA_L / 2 + 1, wallH / 2, 0.5], [0, wallH / 2, ez + 0.5], m);
    physics.addStaticBox([0.5, wallH / 2, AREA_W / 2 + 1], [-ex - 0.5, wallH / 2, 0], m);
    physics.addStaticBox([0.5, wallH / 2, AREA_W / 2 + 1], [ex + 0.5, wallH / 2, 0], m);
  }

  private buildStands(): void {
    const concrete = new THREE.MeshStandardMaterial({ color: 0x5b6170, roughness: 0.9 });
    const rows = 14;
    const rowDepth = 0.85;
    const rowRise = 0.5;
    const gap = 2.5;

    const people: { pos: THREE.Vector3; rotY: number }[] = [];
    const addStand = (len: number, cx: number, cz: number, rotY: number, roof = true) => {
      const stand = new THREE.Group();
      stand.position.set(cx, 0, cz);
      stand.rotation.y = rotY;
      for (let r = 0; r < rows; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2 + r * rowRise, rowDepth), concrete);
        step.position.set(0, (1.2 + r * rowRise) / 2, -(gap + r * rowDepth));
        step.receiveShadow = true;
        stand.add(step);
        for (let x = -len / 2 + 0.4; x < len / 2 - 0.4; x += 0.62) {
          if (Math.random() < 0.12) continue; // 빈 좌석
          const local = new THREE.Vector3(x + (Math.random() - 0.5) * 0.15, 1.2 + r * rowRise + 0.42, -(gap + r * rowDepth));
          stand.updateMatrixWorld(true);
          people.push({ pos: local.applyMatrix4(stand.matrixWorld), rotY });
        }
      }
      // 지붕 (중계 카메라 쪽 관중석은 시야를 가리므로 생략)
      if (roof) addRoof(stand, len);
      this.group.add(stand);
    };
    const addRoof = (stand: THREE.Group, len: number) => {
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(len, 0.3, rows * rowDepth + 3),
        new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.6 }),
      );
      roof.position.set(0, 1.2 + rows * rowRise + 4.5, -(gap + (rows * rowDepth) / 2));
      stand.add(roof);
    };
    const ex = AREA_L / 2;
    const ez = AREA_W / 2;
    addStand(AREA_L + 4, 0, -ez, 0);
    addStand(AREA_L + 4, 0, ez, Math.PI, false);
    addStand(AREA_W, -ex, 0, Math.PI / 2);
    addStand(AREA_W, ex, 0, -Math.PI / 2);

    // 관중: InstancedMesh 하나로 수천 명을 그린다
    const geo = new THREE.BoxGeometry(0.42, 0.8, 0.32);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    this.crowd = new THREE.InstancedMesh(geo, mat, people.length);
    const palette = [0xd8323f, 0xd8323f, 0xb3202c, 0xf4f4f0, 0x1d2a5b, 0x2a2f3a, 0x8a8f99, 0xe9c46a, 0x3a6ea5];
    const color = new THREE.Color();
    const dummy = new THREE.Object3D();
    people.forEach((p, i) => {
      dummy.position.copy(p.pos);
      dummy.rotation.y = p.rotY;
      dummy.updateMatrix();
      this.crowd.setMatrixAt(i, dummy.matrix);
      color.setHex(palette[Math.floor(Math.random() * palette.length)]);
      color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
      this.crowd.setColorAt(i, color);
      this.crowdBase.push({ pos: p.pos.clone(), phase: Math.random() * Math.PI * 2, rotY: p.rotY });
    });
    this.group.add(this.crowd);
  }

  private buildFloodlights(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8b919c, metalness: 0.6, roughness: 0.4 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6dd, emissiveIntensity: 2 });
    const ex = AREA_L / 2 + 9;
    const ez = AREA_W / 2 + 12;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 30, 8), poleMat);
        pole.position.set(sx * ex, 15, sz * ez);
        this.group.add(pole);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.4), lampMat);
        lamp.position.set(sx * ex, 30, sz * ez);
        lamp.lookAt(0, 0, 0);
        this.group.add(lamp);
      }
    }
  }

  /** 골이 들어가면 관중이 들썩인다 */
  cheer(amount = 1): void {
    this.excitement = Math.max(this.excitement, amount);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.excitement < 0.01) return;
    this.excitement *= Math.exp(-0.45 * dt);
    const dummy = new THREE.Object3D();
    this.crowdBase.forEach((p, i) => {
      dummy.position.copy(p.pos);
      dummy.position.y += Math.max(0, Math.sin(this.time * 11 + p.phase)) * 0.35 * this.excitement;
      dummy.rotation.y = p.rotY;
      dummy.updateMatrix();
      this.crowd.setMatrixAt(i, dummy.matrix);
    });
    this.crowd.instanceMatrix.needsUpdate = true;
  }
}

function makeAdTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d')!;
  const ads = [
    { bg: '#11151d', fg: '#ffffff', text: 'FOOTBALL GAME' },
    { bg: '#d8323f', fg: '#ffffff', text: 'SNAPSHOOT' },
    { bg: '#f2c230', fg: '#11151d', text: 'INTICOY' },
    { bg: '#1d2a5b', fg: '#ffffff', text: 'THREE.JS' },
  ];
  const w = c.width / ads.length;
  ads.forEach((ad, i) => {
    g.fillStyle = ad.bg;
    g.fillRect(i * w, 0, w, c.height);
    g.fillStyle = ad.fg;
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ad.text, i * w + w / 2, c.height / 2 + 2);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
