import * as THREE from 'three';
import { GRAPHICS, PITCH, STADIUM } from '../config';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pitchMarkings } from '../data/PitchMarkings';
import { STADIUM_ADS } from '../data/StadiumAds';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { visualRandom } from '../core/Random';

const AREA_L = PITCH.length + PITCH.runoffEnd * 2;
const AREA_W = PITCH.width + PITCH.runoffSide * 2;

export class Stadium {
  readonly group = new THREE.Group();
  private crowd!: THREE.InstancedMesh;
  private readonly details = new THREE.Group();
  private readonly simpleSeats = new THREE.Group();
  private grassMaterial!: THREE.MeshStandardMaterial;
  private grassDetail: THREE.CanvasTexture | null = null;
  private crowdBase: { pos: THREE.Vector3; phase: number; rotY: number; color: THREE.Color }[] = [];
  private density = 1;
  private excitement = 0;
  private time = 0;

  constructor(physics: PhysicsWorld) {
    this.buildPitch();
    this.buildCornerFlags();
    this.buildBoards(physics);
    this.buildStands();
    this.buildFloodlights();
    this.buildBenches();
    // 고정 구조물은 재질별로 합쳐 좌석·계단 수가 드로콜 수로 늘지 않게 한다.
    batchStatic(this.group);
    batchStatic(this.details);
    batchStatic(this.simpleSeats);
    this.group.add(this.details, this.simpleSeats);
  }

  private buildPitch(): void {
    const c = document.createElement('canvas');
    c.width = STADIUM.grassTextureSize;
    c.height = Math.round(c.width * AREA_W / AREA_L);
    const g = c.getContext('2d')!;
    const ppm = c.width / AREA_L;
    for (let i = 0; i * STADIUM.mowingWidth < AREA_L; i++) {
      g.fillStyle = i % 2 ? '#397c40' : '#458b46';
      g.fillRect(i * STADIUM.mowingWidth * ppm, 0, STADIUM.mowingWidth * ppm + 1, c.height);
    }
    const img = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (visualRandom.next() - 0.5) * 12;
      img.data[i] += n * 0.6;
      img.data[i + 1] += n;
      img.data[i + 2] += n * 0.45;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.grassMaterial = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.94 });
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(AREA_L, AREA_W), this.grassMaterial);
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.group.add(grass);

    // 마킹은 텍스처 해상도와 분리한 단일 메시라 근접에서도 폭과 경계가 선명하다.
    const pieces: THREE.BufferGeometry[] = [];
    const strip = (x: number, z: number, ex: number, ez: number) => {
      const geo = new THREE.PlaneGeometry(Math.hypot(ex - x, ez - z), PITCH.lineWidth);
      geo.rotateZ(Math.atan2(ez - z, ex - x));
      geo.translate((x + ex) / 2, (z + ez) / 2, 0);
      pieces.push(geo);
    };
    for (const m of pitchMarkings()) {
      if (m.kind === 'rect') {
        strip(m.x, m.z, m.x + m.width, m.z);
        strip(m.x, m.z + m.height, m.x + m.width, m.z + m.height);
        strip(m.x, m.z, m.x, m.z + m.height);
        strip(m.x + m.width, m.z, m.x + m.width, m.z + m.height);
      } else if (m.kind === 'line') strip(m.x, m.z, m.endX, m.endZ);
      else {
        const geo = m.kind === 'spot' ? new THREE.CircleGeometry(m.radius, 24)
          : new THREE.RingGeometry(m.radius - PITCH.lineWidth / 2, m.radius + PITCH.lineWidth / 2, 128, 1, m.start, m.end - m.start);
        geo.translate(m.x, m.z, 0);
        pieces.push(geo);
      }
    }
    const markings = new THREE.Mesh(mergeGeometries(pieces), new THREE.MeshStandardMaterial({ color: 0xf2f1dc, roughness: 1, side: THREE.DoubleSide }));
    // 캔버스 규격 좌표의 +Z를 그대로 옮겨 코너 호의 방향을 보존한다.
    markings.rotation.x = Math.PI / 2;
    markings.position.y = 0.008;
    markings.receiveShadow = true;
    this.group.add(markings);
    pieces.forEach((piece) => piece.dispose());

    // 경기장 바깥 트랙
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(AREA_L + 40, AREA_W + 40),
      new THREE.MeshStandardMaterial({ color: 0x626c63, roughness: 1 }),
    );
    track.rotation.x = -Math.PI / 2;
    track.position.y = -0.01;
    track.receiveShadow = true;
    this.group.add(track);
  }

  private buildCornerFlags(): void {
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f5ec });
    const flagMaterial = new THREE.MeshStandardMaterial({ color: 0xf3cd32, side: THREE.DoubleSide });
    for (const x of [-PITCH.halfL, PITCH.halfL]) {
      for (const z of [-PITCH.halfW, PITCH.halfW]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, PITCH.flagHeight, 8), poleMaterial);
        pole.position.set(x, PITCH.flagHeight / 2, z);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), poleMaterial);
        cap.position.set(x, PITCH.flagHeight, z);
        const flagGeo = new THREE.PlaneGeometry(0.45, 0.3, 10, 4);
        const vertices = flagGeo.getAttribute('position');
        for (let i = 0; i < vertices.count; i++) {
          const u = (vertices.getX(i) * Math.sign(x) + 0.225) / 0.45;
          vertices.setZ(i, Math.sin(u * Math.PI * 2.4) * 0.055 * u);
        }
        flagGeo.computeVertexNormals();
        const flag = new THREE.Mesh(flagGeo, flagMaterial);
        flag.position.set(x + Math.sign(x) * 0.225, PITCH.flagHeight - 0.18, z);
        this.group.add(pole, cap, flag);
      }
    }
  }

  private buildBoards(physics: PhysicsWorld): void {
    const h = 0.9;
    const t = 0.15;
    const ex = AREA_L / 2;
    const ez = AREA_W / 2;
    const tex = makeAdTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18 });
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
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8a969d, roughness: 0.96 });
    const rows = STADIUM.standRows;
    const rowDepth = STADIUM.rowDepth;
    const rowRise = STADIUM.rowRise;
    const gap = STADIUM.standGap;

    const seats: THREE.Matrix4[] = [];
    const seatColors: THREE.Color[] = [];
    const metal = new THREE.MeshStandardMaterial({ color: 0xb1c0c9, metalness: 0.55, roughness: 0.48 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x253743, roughness: 0.85 });
    const signMaterial = new THREE.MeshBasicMaterial({ map: makeSign('EXIT  ↑', '#bde1ce', '#244e43') });
    const people: { pos: THREE.Vector3; rotY: number }[] = [];
    const addStand = (len: number, cx: number, cz: number, rotY: number, roof = true) => {
      const stand = new THREE.Group();
      stand.position.set(cx, 0, cz);
      stand.rotation.y = rotY;
      stand.updateMatrixWorld(true);
      for (let r = 0; r < rows; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2 + r * rowRise, rowDepth), concrete);
        step.position.set(0, (1.2 + r * rowRise) / 2, -(gap + r * rowDepth));
        step.receiveShadow = true;
        stand.add(step);
        const fascia = new THREE.Mesh(new THREE.BoxGeometry(len, 0.32, 0.10), dark);
        fascia.position.set(0, 1.35 + r * rowRise, -(gap + r * rowDepth) - 0.2);
        fascia.updateMatrix();
        fascia.applyMatrix4(stand.matrixWorld);
        this.simpleSeats.add(fascia);
        for (let x = -len / 2 + 0.4; x < len / 2 - 0.4; x += STADIUM.seatSpacing) {
          if (Math.abs(x - Math.round(x / STADIUM.aisleSpacing) * STADIUM.aisleSpacing) < STADIUM.aisleWidth / 2) continue;
          const seat = new THREE.Object3D();
          seat.position.set(x, 1.2 + r * rowRise + 0.12, -(gap + r * rowDepth));
          seat.updateMatrix();
          seats.push(new THREE.Matrix4().multiplyMatrices(stand.matrixWorld, seat.matrix));
          seatColors.push(new THREE.Color(Math.floor((x + len / 2) / STADIUM.aisleSpacing) % 2 ? 0x456782 : 0x9e3e4c));
          if (visualRandom.next() < 0.12) continue; // 빈 좌석
          const local = new THREE.Vector3(x + (visualRandom.next() - 0.5) * 0.15, 1.2 + r * rowRise + 0.42, -(gap + r * rowDepth));
          stand.updateMatrixWorld(true);
          people.push({ pos: local.applyMatrix4(stand.matrixWorld), rotY });
        }
      }
      // 계단은 좌석 사이 통로에 반 단 높이로 놓고, 출입구는 뒤쪽 벽에만 뚫린 듯 표현한다.
      for (let x = -Math.floor(len / 2 / STADIUM.aisleSpacing) * STADIUM.aisleSpacing; x < len / 2; x += STADIUM.aisleSpacing) {
        for (let r = 0; r < rows * 2; r++) {
          box(stand, [STADIUM.aisleWidth, 0.12, rowDepth / 2], [x, 1.25 + r * rowRise / 2, -(gap + r * rowDepth / 2)], concrete);
        }
        box(stand, [2.5, 2.5, 0.25], [x, 8.7, -15], dark);
        box(stand, [2.8, 0.18, 0.3], [x, 10, -14.8], metal);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.42), signMaterial);
        sign.position.set(x, 9.65, -14.7);
        stand.add(sign);
        beam(stand, new THREE.Vector3(x + 0.65, 2, -3), new THREE.Vector3(x + 0.65, 8.6, -14), 0.035, metal);
      }
      box(stand, [len, 1.15, 0.25], [0, 0.65, -1.9], dark);
      box(stand, [len, 0.15, 0.45], [0, 1.3, -1.9], metal);
      box(stand, [len, 2.6, 0.3], [0, 8.4, -15.3], concrete);
      // 지붕 (중계 카메라 쪽 관중석은 시야를 가리므로 생략)
      if (roof) addRoof(stand, len);
      this.group.add(stand);
    };
    const addRoof = (stand: THREE.Group, len: number) => {
      const y = 1.2 + rows * rowRise + 4.5;
      box(stand, [len + 2, 0.22, rows * rowDepth + 4], [0, y, -8.6], metal, true);
      box(stand, [len + 2, 0.65, 0.25], [0, y - 0.15, -0.65], dark);
      for (let x = -len / 2 + 2; x <= len / 2; x += 9) {
        box(stand, [0.23, y, 0.23], [x, y / 2, -15], metal);
        beam(stand, new THREE.Vector3(x, y - 1.2, -15), new THREE.Vector3(x, y - 0.25, -1), 0.065, metal);
        // 보조 트러스는 high 전용 고정 메시로 묶는다.
        for (let z = -14; z < -1; z += 2) {
          const a = new THREE.Vector3(x, y - 0.2, z), b = new THREE.Vector3(x, y - 0.8, z + 1);
          a.applyMatrix4(stand.matrixWorld); b.applyMatrix4(stand.matrixWorld);
          beam(this.details, a, b, 0.035, metal);
        }
      }
    };
    const ex = AREA_L / 2;
    const ez = AREA_W / 2;
    addStand(AREA_L + 4, 0, -ez, 0);
    // 카메라 쪽(가까운) 관중석은 만들지 않는다: 실제 중계/FIFA처럼 카메라가 그 관중석 위에 있어 화면에 안 잡히고,
    // 공이 가까운 터치라인에 오면 화면 아래를 가리기 때문
    addStand(AREA_W, -ex, 0, Math.PI / 2);
    addStand(AREA_W, ex, 0, -Math.PI / 2);

    const seatGeo = mergeGeometries([
      new THREE.BoxGeometry(0.48, 0.12, 0.43),
      new THREE.BoxGeometry(0.48, 0.42, 0.10).translate(0, 0.21, -0.19),
    ]);
    const seatMesh = new THREE.InstancedMesh(seatGeo, new THREE.MeshStandardMaterial({ roughness: 0.72 }), seats.length);
    seats.forEach((matrix, i) => { seatMesh.setMatrixAt(i, matrix); seatMesh.setColorAt(i, seatColors[i]); });
    seatMesh.receiveShadow = true;
    this.details.add(seatMesh);

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
      color.setHex(palette[Math.floor(visualRandom.next() * palette.length)]);
      color.offsetHSL(0, 0, (visualRandom.next() - 0.5) * 0.1);
      this.crowd.setColorAt(i, color);
      this.crowdBase.push({ pos: p.pos.clone(), phase: visualRandom.next() * Math.PI * 2, rotY: p.rotY, color: color.clone() });
    });
    this.crowd.receiveShadow = true;
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
        const head = new THREE.Group();
        head.position.set(sx * ex, 30, sz * ez);
        head.lookAt(0, 10, 0);
        box(head, [5.4, 3.2, 0.35], [0, 0, 0], poleMat);
        for (let ix = 0; ix < 5; ix++) for (let iy = 0; iy < 3; iy++) {
          box(head, [0.75, 0.65, 0.12], [(ix - 2) * 1.02, (iy - 1) * 0.98, 0.24], lampMat);
        }
        this.group.add(head);
        for (const offset of [-0.4, 0.4]) {
          beam(this.details, new THREE.Vector3(sx * ex + offset, 1, sz * ez + 0.42), new THREE.Vector3(sx * ex + offset, 29, sz * ez + 0.42), 0.035, poleMat);
        }
        for (let y = 2; y < 29; y += 3) {
          box(this.details, [0.8, 0.06, 0.08], [sx * ex, y, sz * ez + 0.42], poleMat);
        }
      }
    }
  }

  private buildBenches(): void {
    const shell = new THREE.MeshStandardMaterial({ color: 0x294859, metalness: 0.3, roughness: 0.5 });
    const seat = new THREE.MeshStandardMaterial({ color: 0xae454c, roughness: 0.8 });
    for (const side of [-1, 1]) {
      const bench = new THREE.Group();
      bench.position.set(side * 15, 0, AREA_W / 2 + 2.6);
      box(bench, [10, 0.18, 2.4], [0, 0.12, 0], shell);
      box(bench, [10, 0.16, 2.7], [0, 2.3, 0.1], shell);
      box(bench, [10, 1.8, 0.12], [0, 1.2, 1.15], shell);
      for (const x of [-5, 5]) box(bench, [0.12, 2.2, 2.4], [x, 1.2, 0], shell);
      for (let x = -4.5; x <= 4.5; x += 0.8) {
        box(bench, [0.62, 0.15, 0.65], [x, 0.65, 0], seat);
        box(bench, [0.62, 0.7, 0.12], [x, 1, 0.3], seat);
      }
      this.group.add(bench);
    }
  }

  setQuality(quality: 'high' | 'low'): void {
    const profile = GRAPHICS[quality];
    this.details.visible = profile.structureDetail;
    this.simpleSeats.visible = !profile.structureDetail;
    if (profile.grassDetail && !this.grassDetail) this.grassDetail = makeGrassDetail();
    const bump = profile.grassDetail ? this.grassDetail : null;
    if (this.grassMaterial.bumpMap !== bump) {
      this.grassMaterial.bumpMap = bump;
      this.grassMaterial.bumpScale = STADIUM.grassBump;
      this.grassMaterial.needsUpdate = true;
    }
  }

  setCrowdDensity(density: number): void {
    if (this.density === density) return;
    this.density = density;
    this.crowd.count = Math.floor(this.crowdBase.length * density);
    this.updateCrowd();
    // 밀도가 바뀌어도 모든 관중석에 고르게 배치한다.
    for (let i = 0; i < this.crowd.count; i++) this.crowd.setColorAt(i, this.crowdBase[Math.floor(i / density)].color);
    this.crowd.instanceColor!.needsUpdate = true;
  }

  /** 골이 들어가면 관중이 들썩인다 */
  cheer(amount = 1): void {
    this.excitement = Math.max(this.excitement, amount);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.excitement < 0.01) return;
    this.excitement *= Math.exp(-0.45 * dt);
    this.updateCrowd();
  }

  private updateCrowd(): void {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.crowd.count; i++) {
      const p = this.crowdBase[Math.floor(i / this.density)];
      dummy.position.copy(p.pos);
      dummy.position.y += Math.max(0, Math.sin(this.time * 11 + p.phase)) * 0.35 * this.excitement;
      dummy.rotation.y = p.rotY;
      dummy.updateMatrix();
      this.crowd.setMatrixAt(i, dummy.matrix);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
  }
}

function makeAdTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d')!;
  const w = c.width / STADIUM_ADS.length;
  STADIUM_ADS.forEach((ad, i) => {
    g.fillStyle = ad.bg;
    g.fillRect(i * w, 0, w, c.height);
    g.fillStyle = ad.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // 칸 너비에 맞게 글자 크기를 줄인다
    let size = 34;
    g.font = `bold ${size}px system-ui, sans-serif`;
    while (g.measureText(ad.text).width > w - 24 && size > 14) {
      size -= 2;
      g.font = `bold ${size}px system-ui, sans-serif`;
    }
    g.fillText(ad.text, i * w + w / 2, c.height / 2 + 2);
    g.globalAlpha = 0.12;
    g.fillStyle = '#000000';
    for (let y = 0; y < c.height; y += 3) g.fillRect(i * w, y, w, 1);
    g.globalAlpha = 1;
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGrassDetail(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = STADIUM.grassDetailSize;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, c.width, c.height);
  // 짧은 잎을 반복하는 높이 맵으로 실제 잔디 메시 없이 표면의 법선 변화만 준다.
  for (let i = 0; i < 16000; i++) {
    const value = 50 + Math.floor(visualRandom.next() * 150);
    g.strokeStyle = `rgb(${value},${value},${value})`;
    const x = visualRandom.next() * c.width, y = visualRandom.next() * c.height;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.5, y + 2.5); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(STADIUM.grassDetailRepeat, STADIUM.grassDetailRepeat * AREA_W / AREA_L);
  tex.anisotropy = 4;
  return tex;
}

function makeSign(text: string, color: string, background: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = background; g.fillRect(0, 0, c.width, c.height);
  g.font = 'bold 36px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color; g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function box(group: THREE.Group, size: [number, number, number], position: [number, number, number], material: THREE.Material, castShadow = false): void {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  m.position.set(...position);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  group.add(m);
}

function beam(group: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): void {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 6), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  group.add(m);
}

function batchStatic(group: THREE.Group): void {
  const batches = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geometries: THREE.BufferGeometry[] }>();
  const meshes: THREE.Mesh[] = [];
  group.updateMatrixWorld(true);
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || Array.isArray(object.material)) return;
    const key = `${object.material.uuid}/${object.castShadow}/${object.receiveShadow}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = { material: object.material, cast: object.castShadow, receive: object.receiveShadow, geometries: [] };
      batches.set(key, batch);
    }
    batch.geometries.push(object.geometry.clone().applyMatrix4(object.matrixWorld));
    meshes.push(object);
  });
  for (const mesh of meshes) { mesh.removeFromParent(); mesh.geometry.dispose(); }
  for (const batch of batches.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(batch.geometries), batch.material);
    mesh.castShadow = batch.cast; mesh.receiveShadow = batch.receive;
    group.add(mesh);
    batch.geometries.forEach((geometry) => geometry.dispose());
  }
}
