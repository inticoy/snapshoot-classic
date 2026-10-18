import * as THREE from 'three';
import { GRAPHICS, STADIUM } from '../config';

/** 하늘과 태양을 같은 낮 시간 색온도로 맞추고, 그림자 예산을 화면 주변에 집중한다. */
export class Lighting {
  readonly sun = new THREE.DirectionalLight(STADIUM.sunColor, STADIUM.sunIntensity);
  private readonly direction = new THREE.Vector3(...STADIUM.sunDirection);
  private readonly right = new THREE.Vector3().crossVectors(this.direction, new THREE.Vector3(0, 1, 0)).normalize();
  private readonly up = new THREE.Vector3().crossVectors(this.right, this.direction).normalize();
  private readonly center = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly sky: THREE.CanvasTexture;
  private environment: THREE.WebGLRenderTarget | null = null;
  private profile = GRAPHICS.high;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.sky = makeSky();
    scene.background = this.sky;
    scene.fog = new THREE.Fog(STADIUM.hazeColor, STADIUM.fogNear, STADIUM.fogFar);
    scene.add(new THREE.HemisphereLight(0xd9edff, 0x63734b, 1.5));
    const fill = new THREE.DirectionalLight(0xc8dfff, 0.45);
    fill.position.set(25, 18, -35);
    scene.add(fill);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00012;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 200;
    scene.add(this.sun, this.sun.target);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = STADIUM.exposure;
  }

  setQuality(quality: 'high' | 'low'): void {
    this.profile = GRAPHICS[quality];
    const shadow = this.sun.shadow;
    if (shadow.mapSize.x !== this.profile.shadowSize) {
      shadow.mapSize.setScalar(this.profile.shadowSize);
      shadow.map?.dispose();
      shadow.map = null;
    }
    // 환경 반사는 high에서 한 번만 굽는다. low는 추가 큐브맵 샘플 없이 반구광을 쓴다.
    if (quality === 'high' && !this.environment) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.environment = pmrem.fromEquirectangular(this.sky);
      pmrem.dispose();
    }
    this.scene.environment = quality === 'high' ? this.environment!.texture : null;
    this.scene.environmentIntensity = 0.25;
  }

  update(camera: THREE.PerspectiveCamera): void {
    camera.getWorldDirection(this.view);
    // 시선의 지면 교점을 쓰므로 득점 클로즈업·선수 뒤 카메라도 별도 게임 상태 없이 따라간다.
    const distance = this.view.y < -0.05 ? -camera.position.y / this.view.y : 35;
    this.center.copy(camera.position).addScaledVector(this.view, distance).setY(0);
    const close = camera.position.y < STADIUM.closeShadowHeight;
    const extent = close ? this.profile.closeShadowExtent : this.profile.shadowExtent;
    // 광원 좌표에서 텍셀 단위로만 이동시켜 카메라 이동 중 그림자 가장자리의 떨림을 막는다.
    const texel = 2 * extent / this.profile.shadowSize;
    this.center.addScaledVector(this.right, Math.round(this.center.dot(this.right) / texel) * texel - this.center.dot(this.right));
    this.center.addScaledVector(this.up, Math.round(this.center.dot(this.up) / texel) * texel - this.center.dot(this.up));
    this.sun.target.position.copy(this.center);
    this.sun.position.copy(this.center).add(this.direction);
    const s = this.sun.shadow.camera;
    if (s.right !== extent) {
      s.left = s.bottom = -extent;
      s.right = s.top = extent;
      s.updateProjectionMatrix();
    }
  }
}

function makeSky(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = STADIUM.skySize;
  c.height = STADIUM.skySize / 2;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#4b83b4');
  sky.addColorStop(0.42, '#b7d6e8');
  sky.addColorStop(0.53, '#e1e9e6');
  sky.addColorStop(1, '#657c58');
  g.fillStyle = sky;
  g.fillRect(0, 0, c.width, c.height);
  // 얇은 구름은 캔버스에 구워 매 프레임 입체 구름을 계산하지 않는다.
  for (let i = 0; i < 26; i++) {
    const x = ((i * 173) % c.width), y = 70 + (i * 37) % 135;
    const cloud = g.createRadialGradient(x, y, 1, x, y, 65);
    cloud.addColorStop(0, 'rgba(255,255,250,0.10)');
    cloud.addColorStop(1, 'rgba(255,255,250,0)');
    g.save();
    g.translate(x, y);
    g.scale(2.6, 0.35);
    g.translate(-x, -y);
    g.fillStyle = cloud;
    g.fillRect(x - 66, y - 66, 132, 132);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
