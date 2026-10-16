import * as THREE from 'three';
import type { Appearance } from '../data/Appearance';

/**
 * 선수별 데칼 아틀라스 (512×256 캔버스 하나).
 *   [0..256]   등: 이름(위) + 큰 등번호
 *   [256..384] 얼굴: 눈썹·눈·코·입·수염 (피부색 위에 덧칠)
 *   [384..512] 위쪽 절반: 가슴 번호
 * 셰이더가 바인드 포즈 좌표를 이 영역으로 투영한다 (SkinnedPlayerModel의 DECAL_* 상수와 짝).
 */
export interface DecalSpec {
  number: number;
  name: string;
  ink: string;
  inkEdge: string;
  look: Appearance;
}

const W = 512, H = 256;
const NUM_FONT = "'Barlow Condensed', 'Arial Narrow', sans-serif";

const css = (hex: number, alpha = 1) =>
  `rgba(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}, ${alpha})`;

export function makeDecalTexture(spec: DecalSpec): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  draw(canvas, spec);
  // 웹폰트가 늦게 오면 숫자 글꼴이 바뀌므로 다시 그린다
  document.fonts?.ready.then(() => {
    draw(canvas, spec);
    tex.needsUpdate = true;
  });
  return tex;
}

function draw(canvas: HTMLCanvasElement, spec: DecalSpec): void {
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  drawBack(g, spec);
  drawFace(g, spec.look);
  drawChest(g, spec);
}

function outlined(g: CanvasRenderingContext2D, text: string, x: number, y: number, ink: string, edge: string, line: number): void {
  g.lineJoin = 'round';
  g.lineWidth = line;
  g.strokeStyle = edge;
  g.strokeText(text, x, y);
  g.fillStyle = ink;
  g.fillText(text, x, y);
}

function drawBack(g: CanvasRenderingContext2D, spec: DecalSpec): void {
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  // 이름: 등 위쪽, 폭에 맞춰 글자 크기를 줄인다
  let size = 44;
  g.font = `700 ${size}px ${NUM_FONT}`;
  const max = 216;
  const width = g.measureText(spec.name).width;
  if (width > max) {
    size = Math.floor(size * (max / width));
    g.font = `700 ${size}px ${NUM_FONT}`;
  }
  outlined(g, spec.name, 128, 50, spec.ink, spec.inkEdge, 5);
  // 등번호
  g.font = `800 176px ${NUM_FONT}`;
  outlined(g, String(spec.number), 128, 236, spec.ink, spec.inkEdge, 10);
}

function drawChest(g: CanvasRenderingContext2D, spec: DecalSpec): void {
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = `800 104px ${NUM_FONT}`;
  outlined(g, String(spec.number), 448, 112, spec.ink, spec.inkEdge, 7);
}

/** 얼굴 영역: 가로 128px = 머리 폭 0.18m, 세로 256px = 높이 1.56~1.80m */
function drawFace(g: CanvasRenderingContext2D, look: Appearance): void {
  const cx = 320;
  const dark = css(look.hair);
  const skinShade = css(darken(look.skin, 0.72));
  g.save();
  g.beginPath();
  g.rect(256, 0, 128, 256);
  g.clip();
  // 수염: 턱선을 따라 머리색
  if (look.beard) {
    g.fillStyle = css(look.hair, 0.85);
    g.beginPath();
    g.ellipse(cx, 214, 46, 46, 0, 0, Math.PI);
    g.fill();
    g.fillRect(cx - 46, 178, 92, 38);
  }
  // 눈썹
  g.fillStyle = dark;
  for (const s of [-1, 1]) {
    g.save();
    g.translate(cx + s * 26, 82);
    g.rotate(s * 0.06);
    g.fillRect(-15, -4, 30, 8);
    g.restore();
  }
  // 눈: 흰자 + 눈동자
  for (const s of [-1, 1]) {
    g.fillStyle = '#f4f1ec';
    g.beginPath();
    g.ellipse(cx + s * 26, 106, 12, 7, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b130d';
    g.beginPath();
    g.arc(cx + s * 26, 106, 5.5, 0, Math.PI * 2);
    g.fill();
  }
  // 코 그림자
  g.fillStyle = skinShade;
  g.beginPath();
  g.moveTo(cx - 3, 116);
  g.lineTo(cx - 10, 156);
  g.lineTo(cx + 8, 158);
  g.closePath();
  g.fill();
  // 입
  g.fillStyle = look.beard ? css(darken(look.hair, 0.5)) : '#7a3b34';
  g.beginPath();
  g.ellipse(cx, 194, 18, 5, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function darken(hex: number, k: number): number {
  const r = Math.round(((hex >> 16) & 255) * k), gg = Math.round(((hex >> 8) & 255) * k), b = Math.round((hex & 255) * k);
  return (r << 16) | (gg << 8) | b;
}
