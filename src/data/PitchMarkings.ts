import { PITCH } from '../config';

export type PitchMarking =
  | { kind: 'rect'; name: string; x: number; z: number; width: number; height: number }
  | { kind: 'line'; name: string; x: number; z: number; endX: number; endZ: number }
  | { kind: 'arc'; name: string; x: number; z: number; radius: number; start: number; end: number }
  | { kind: 'spot'; name: string; x: number; z: number; radius: number };

/** 그리기와 검증에서 같은 좌표를 써 축소 경기장용 각도가 남는 것을 방지한다. */
export function pitchMarkings(): PitchMarking[] {
  const { halfL: hl, halfW: hw } = PITCH;
  const markings: PitchMarking[] = [
    { kind: 'rect', name: 'boundary', x: -hl, z: -hw, width: PITCH.length, height: PITCH.width },
    { kind: 'line', name: 'halfway', x: 0, z: -hw, endX: 0, endZ: hw },
    { kind: 'arc', name: 'center', x: 0, z: 0, radius: PITCH.centerCircle, start: 0, end: Math.PI * 2 },
    { kind: 'spot', name: 'centerSpot', x: 0, z: 0, radius: PITCH.lineWidth },
  ];
  // 박스 경계와 원의 교점으로 각도를 구해야 박스 안쪽에 호가 그려지지 않는다.
  const angle = Math.acos((PITCH.boxDepth - PITCH.penaltySpot) / PITCH.penaltyArc);
  for (const s of [-1, 1]) {
    for (const [name, depth, width] of [
      ['penaltyArea', PITCH.boxDepth, PITCH.boxWidth],
      ['goalArea', PITCH.goalAreaDepth, PITCH.goalAreaWidth],
    ] as const) {
      markings.push({ kind: 'rect', name, x: s < 0 ? -hl : hl - depth, z: -width / 2, width: depth, height: width });
    }
    const x = s * (hl - PITCH.penaltySpot);
    const direction = s < 0 ? 0 : Math.PI;
    markings.push({ kind: 'arc', name: 'penaltyArc', x, z: 0, radius: PITCH.penaltyArc, start: direction - angle, end: direction + angle });
    markings.push({ kind: 'spot', name: 'penaltySpot', x, z: 0, radius: PITCH.lineWidth });
    for (const t of [-1, 1]) {
      // 캔버스의 +Z는 아래쪽. 각 꼭짓점에서 경기장 안쪽 사분원만 선택한다.
      const start = s < 0 ? (t < 0 ? 0 : -Math.PI / 2) : (t < 0 ? Math.PI / 2 : Math.PI);
      markings.push({ kind: 'arc', name: 'cornerArc', x: s * hl, z: t * hw, radius: PITCH.cornerArc, start, end: start + Math.PI / 2 });
    }
  }
  return markings;
}
