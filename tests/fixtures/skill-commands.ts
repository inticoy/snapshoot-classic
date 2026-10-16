import type { Dir } from '../../src/gameplay/Skills';
import type { PlaygroundScript } from '../../src/playground/Script';

// 구현 정의에서 유도하지 않는 명시적 조작 표: 잘못 적은 커맨드끼리 함께 통과하는 것을 막는다.
export const COMMANDS: { id: string; dirs: Dir[]; modifier?: string; fake?: string; hold?: boolean }[] = [
  { id: 'fake_shot', dirs: [], fake: 'KeyD' },
  { id: 'fake_pass', dirs: [], fake: 'KeyA' },
  { id: 'drag_back', dirs: ['B'], modifier: 'KeyZ' },
  { id: 'feint_r', dirs: ['R'] }, { id: 'feint_l', dirs: ['L'] },
  { id: 'step_over_r', dirs: ['F', 'FR', 'R'] }, { id: 'step_over_l', dirs: ['F', 'FL', 'L'] },
  { id: 'reverse_step_over_r', dirs: ['R', 'FR', 'F'] }, { id: 'reverse_step_over_l', dirs: ['L', 'FL', 'F'] },
  { id: 'side_step_r', dirs: ['R'], hold: true }, { id: 'side_step_l', dirs: ['L'], hold: true },
  { id: 'heel_flick', dirs: ['F', 'B'] }, { id: 'ball_lift', dirs: ['F', 'F', 'F'] },
  { id: 'roulette_r', dirs: ['B', 'BL', 'L', 'FL', 'F', 'FR', 'R'] },
  { id: 'roulette_l', dirs: ['B', 'BR', 'R', 'FR', 'F', 'FL', 'L'] },
  { id: 'feint_exit_r', dirs: ['L', 'BL', 'B', 'BR', 'R'] },
  { id: 'feint_exit_l', dirs: ['R', 'BR', 'B', 'BL', 'L'] },
];
const KEYS: Record<Dir, string[]> = {
  F: ['ArrowUp'], FR: ['ArrowUp', 'ArrowRight'], R: ['ArrowRight'], BR: ['ArrowDown', 'ArrowRight'],
  B: ['ArrowDown'], BL: ['ArrowDown', 'ArrowLeft'], L: ['ArrowLeft'], FL: ['ArrowUp', 'ArrowLeft'],
};
export function skillScript(c: typeof COMMANDS[number], hold = 1.8): PlaygroundScript {
  const modifier = c.modifier ?? 'ShiftLeft';
  const inputs: PlaygroundScript['inputs'] = [{ t: 0, keys: [] }, { t: 0.5, keys: [modifier] }];
  let t = 0.55;
  if (c.fake) {
    inputs.push({ t, keys: [c.fake] }, { t: t + 0.1, keys: [c.fake, 'KeyS'] }, { t: t + 0.15, keys: [] });
  } else {
    for (const [i, dir] of c.dirs.entries()) {
      if (i && c.dirs[i - 1] === dir) { inputs.push({ t, keys: [modifier] }); t += 0.05; }
      inputs.push({ t, keys: [modifier, ...KEYS[dir]] }); t += c.hold ? hold : 0.06;
    }
    inputs.push({ t, keys: [] });
  }
  return { scenario: 'free', seed: 5, duration: 3.3, sampleHz: 120, inputs };
}
