import { DRIBBLE } from '../config';
import { MOTION_SELECT } from '../anim/MotionLibrary';
import { PLAYGROUND_PARAMETERS } from '../data/Playground';

type ParameterKey = typeof PLAYGROUND_PARAMETERS[number]['key'];
export function parameterSnapshot() {
  return { DRIBBLE: { ...DRIBBLE }, MOTION_SELECT: { ...MOTION_SELECT } };
}

/** 두 회전 한계의 순서를 보존해 슬라이더로 음의 보간 구간을 만들지 않는다. */
export function setParameter(key: ParameterKey, value: number): void {
  if (!Number.isFinite(value)) return;
  const range = PLAYGROUND_PARAMETERS.find((p) => p.key === key)!;
  const v = Math.max(range.min, Math.min(range.max, value));
  if (key === 'windup') MOTION_SELECT.windup = v;
  else {
    DRIBBLE[key] = v;
    if (key === 'turnMin') DRIBBLE.turnMax = Math.max(v, DRIBBLE.turnMax);
    if (key === 'turnMax') DRIBBLE.turnMin = Math.min(v, DRIBBLE.turnMin);
  }
}
