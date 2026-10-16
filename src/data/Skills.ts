import { SKILL_CONTACTS } from './SkillContacts';
import { mirror, type Dir, type SkillDef } from '../gameplay/Skills';

export function makeSkillDefs(): SkillDef[] {
  /** 페이크 슛 (D 게이지 중 S): 슛 동작을 공 직전에 멈추고 발바닥으로 공을 세운다. 누른 방향이 있으면 그쪽으로 접는다 */
  const FAKE_SHOT: SkillDef = {
    id: 'fake_shot', name: '페이크 슛', stars: 1,
    trigger: { kind: 'fake', from: 'shoot' },
    duration: 0.62, carry: 0.25,
    body: [{ t: 0, x: 0, z: 0 }, { t: 0.3, x: 0, z: 0.12 }, { t: 0.62, x: 0, z: 0.2 }],
    ball: [{ t: 0, x: 0.12, z: 0.5 }, { t: 0.3, x: 0.1, z: 0.55 }, { t: 0.62, x: 0.08, z: 0.58 }],
    contacts: [{ t: 0.5, foot: 'R' }],
    motion: { id: 'grf_shot_idle_020', kind: 'shot', angle: 0, toKey: 0.85 },
    exit: { dir: 0, speed: 1.2, body: 1, input: true },
    bait: { t: 0.25, dir: 0, strength: 1 },
    shield: 0.85,
  };

  /** 드래그백 (Z + ↓): 발바닥으로 공을 뒤로 끌며 몸을 돌린다 */
  const DRAG_BACK: SkillDef = {
    id: 'drag_back', name: '드래그백', stars: 2,
    trigger: { kind: 'z', seq: [{ dir: 'B' }] },
    duration: 0.6, carry: 0,
    body: [{ t: 0, x: 0, z: 0, yaw: 0 }, { t: 0.2, x: 0, z: -0.08, yaw: 0.2 }, { t: 0.6, x: -0.05, z: -0.3, yaw: Math.PI }],
    ball: [{ t: 0, x: 0.1, z: 0.45 }, { t: 0.12, x: 0.1, z: 0.4 }, { t: 0.38, x: 0.04, z: -0.15 }, { t: 0.6, x: 0, z: -0.75 }],
    // 달리기에서 섞여 오는 발이 안정된 뒤 발바닥 접촉을 맞춘다.
    contacts: [{ t: 0.24, foot: 'R' }],
    motion: { id: 'grf_ballcontrol_idle_000', kind: 'control', angle: Math.PI },
    exit: { dir: Math.PI, speed: 2.4, body: 1.6, input: true },
    bait: { t: 0.1, dir: 0, strength: 0.6 },
    shield: 0.7,
  };

  /** 속임 동작 (Shift + → 짧게): 몸을 오른쪽으로 실었다가 그대로 앞으로 */
  const FEINT_RIGHT: SkillDef = {
    id: 'feint_r', name: '오른쪽 속임 동작', stars: 2,
    trigger: { kind: 'shift', seq: [{ dir: 'R', tap: true }] },
    duration: 0.45, carry: 0.7,
    body: [{ t: 0, x: 0, z: 0, yaw: 0 }, { t: 0.17, x: 0.12, z: 0, yaw: 0.45 }, { t: 0.45, x: 0.02, z: 0, yaw: 0 }],
    ball: [{ t: 0, x: 0, z: 0.5 }, { t: 0.45, x: 0, z: 0.55 }],
    contacts: [],
    motion: { id: 'grf_ballcontrol_idle_000', kind: 'control', angle: Math.PI / 4, toKey: 0.7 },
    exit: { dir: 0, speed: 2.2, body: 2.5 },
    bait: { t: 0.12, dir: Math.PI / 2, strength: 1 },
    shield: 0.8,
  };

  /** 스텝오버는 공 바깥으로 발을 돌리고 마지막에 전진 터치를 한다. */
  const STEP_OVER: SkillDef = {
    id: 'step_over_r', name: '오른쪽 스텝오버', stars: 2,
    trigger: { kind: 'shift', seq: [{ dir: 'F' }, { dir: 'FR' }, { dir: 'R' }] },
    duration: 0.6, carry: 0.3,
    body: [{ t: 0, x: 0, z: 0 }, { t: 0.3, x: 0.12, z: 0.12, yaw: 0.3 }, { t: 0.6, x: 0.06, z: 0.3 }],
    ball: [{ t: 0, x: 0.1, z: 0.4 }, { t: 0.3, x: 0.12, z: 0.42 }, { t: 0.6, x: 0.06, z: 0.78 }],
    contacts: [{ t: 0.42, foot: 'R' }],
    motion: { id: 'grf_ballcontrol_idle_045', kind: 'control', angle: Math.PI / 4 },
    exit: { dir: 0, speed: 2.4, body: 2.2 },
    bait: { t: 0.22, dir: Math.PI / 2, strength: 0.8 }, shield: 0.8,
  };
  const REVERSE_STEP: SkillDef = {
    ...STEP_OVER, id: 'reverse_step_over_r', name: '오른쪽 리버스 스텝오버',
    trigger: { kind: 'shift', seq: [{ dir: 'R' }, { dir: 'FR' }, { dir: 'F' }] },
    motion: { id: 'grf_ballcontrol_idle_045_accel', kind: 'control', angle: -Math.PI / 4 },
  };
  const SIDE_STEP: SkillDef = {
    id: 'side_step_r', name: '오른쪽 사이드 스텝', stars: 2,
    trigger: { kind: 'shift', seq: [{ dir: 'R', hold: true }] },
    duration: 0.6, carry: 0, sustained: true,
    body: [{ t: 0, x: 0, z: 0 }, { t: 0.3, x: 0.36, z: 0 }, { t: 0.6, x: 0.72, z: 0 }],
    ball: [{ t: 0, x: 0.1, z: 0.4 }, { t: 0.3, x: 0.46, z: 0.4 }, { t: 0.6, x: 0.82, z: 0.4 }],
    contacts: [{ t: 0.3, foot: 'R' }],
    motion: { id: 'grf_ballcontrol_idle_000', kind: 'control', angle: 0 },
    exit: { dir: 0, speed: 0, body: 0 }, shield: 0.7,
  };
  const HEEL_FLICK: SkillDef = {
    id: 'heel_flick', name: '힐 플릭', stars: 3,
    trigger: { kind: 'shift', seq: [{ dir: 'F', tap: true }, { dir: 'B', tap: true }] },
    duration: 0.65, carry: 0.35,
    body: [{ t: 0, x: 0, z: 0 }, { t: 0.25, x: 0, z: 0.08 }, { t: 0.65, x: 0, z: 0.6 }],
    ball: [{ t: 0, x: 0.1, z: 0.4 }, { t: 0.2, x: 0.08, z: 0.16 }, { t: 0.4, x: 0.05, z: 0.55, y: 0.35 }, { t: 0.65, x: 0, z: 1.1 }],
    contacts: [{ t: 0.2, foot: 'R' }],
    motion: { id: 'grf_ballcontrol_idle_000_accel', kind: 'control', angle: 0 },
    exit: { dir: 0, speed: 3, body: 2.8 }, shield: 0.75,
  };
  const BALL_LIFT: SkillDef = {
    id: 'ball_lift', name: '볼 리프트', stars: 3,
    trigger: { kind: 'shift', seq: [{ dir: 'F', tap: true }, { dir: 'F', tap: true }, { dir: 'F', tap: true }] },
    duration: 0.9, carry: 0,
    body: [{ t: 0, x: 0, z: 0 }, { t: 0.9, x: 0, z: 0.12 }],
    ball: [{ t: 0, x: 0.1, z: 0.4 }, { t: 0.25, x: 0.12, z: 0.36 }, { t: 0.5, x: 0.1, z: 0.45, y: 0.85 }, { t: 0.9, x: 0.08, z: 0.55 }],
    contacts: [{ t: 0.25, foot: 'R' }],
    motion: { id: 'grf_trap_idle_000_IB000', kind: 'trap', angle: 0 },
    exit: { dir: 0, speed: 0.8, body: 0.5 }, shield: 0.7,
  };
  const ROULETTE: SkillDef = {
    id: 'roulette_r', name: '오른쪽 룰렛', stars: 3,
    trigger: { kind: 'shift', seq: ['B', 'BL', 'L', 'FL', 'F', 'FR', 'R'].map((dir) => ({ dir: dir as Dir })) },
    duration: 1, carry: 0.15,
    body: [{ t: 0, x: 0, z: 0 }, { t: 0.25, x: 0.15, z: 0.08, yaw: Math.PI / 2 }, { t: 0.5, x: 0.35, z: 0.2, yaw: Math.PI }, { t: 0.75, x: 0.4, z: 0.5, yaw: Math.PI * 1.5 }, { t: 1, x: 0.4, z: 0.8, yaw: Math.PI * 2 }],
    ball: [{ t: 0, x: 0.1, z: 0.4 }, { t: 0.3, x: 0.5, z: 0.1 }, { t: 0.55, x: 0.25, z: -0.05 }, { t: 0.8, x: 0.1, z: 0.6 }, { t: 1, x: 0.4, z: 1.25 }],
    contacts: [{ t: 0.3, foot: 'R' }, { t: 0.55, foot: 'L' }],
    motion: { id: 'grf_movement_dribble_180_decel', kind: 'turn', angle: Math.PI },
    exit: { dir: 0, speed: 2.4, body: 2.2 },
    bait: { t: 0.2, dir: Math.PI / 2, strength: 0.9 }, shield: 0.65,
  };
  const FEINT_EXIT: SkillDef = {
    id: 'feint_exit_r', name: '왼쪽 페인트 후 오른쪽', stars: 3,
    trigger: { kind: 'shift', seq: ['L', 'BL', 'B', 'BR', 'R'].map((dir) => ({ dir: dir as Dir })) },
    duration: 0.75, carry: 0.1,
    body: [{ t: 0, x: 0, z: 0 }, { t: 0.25, x: -0.15, z: 0.02, yaw: -0.4 }, { t: 0.75, x: 0.65, z: 0.15, yaw: Math.PI / 2 }],
    ball: [{ t: 0, x: 0.1, z: 0.4 }, { t: 0.25, x: -0.18, z: 0.4 }, { t: 0.45, x: 0.2, z: 0.4 }, { t: 0.75, x: 1.05, z: 0.15 }],
    contacts: [{ t: 0.25, foot: 'R' }, { t: 0.45, foot: 'R' }],
    motion: { id: 'grf_ballcontrol_idle_045_accel', kind: 'control', angle: Math.PI / 2 },
    exit: { dir: Math.PI / 2, speed: 2.5, body: 2.2 },
    bait: { t: 0.2, dir: -Math.PI / 2, strength: 1 }, shield: 0.7,
  };
  const defs: SkillDef[] = [FAKE_SHOT,
    { ...FAKE_SHOT, id: 'fake_pass', name: '페이크 크로스', trigger: { kind: 'fake', from: 'lob' } },
    DRAG_BACK, FEINT_RIGHT, mirror(FEINT_RIGHT, 'feint_l', '왼쪽 속임 동작'),
    STEP_OVER, mirror(STEP_OVER, 'step_over_l', '왼쪽 스텝오버'),
    REVERSE_STEP, mirror(REVERSE_STEP, 'reverse_step_over_l', '왼쪽 리버스 스텝오버'),
    SIDE_STEP, mirror(SIDE_STEP, 'side_step_l', '왼쪽 사이드 스텝'), HEEL_FLICK, BALL_LIFT,
    ROULETTE, mirror(ROULETTE, 'roulette_l', '왼쪽 룰렛'),
    FEINT_EXIT, mirror(FEINT_EXIT, 'feint_exit_l', '오른쪽 페인트 후 왼쪽'),
  ];
  // 좌우 반전한 클립도 GLB 골격의 미세한 비대칭을 반영해 접촉 키를 따로 굽는다.
  return defs.map((def) => {
    const contacts = SKILL_CONTACTS[def.id] ?? [];
    return { ...def, ball: [...def.ball.filter((key) => !contacts.some((c) => Math.abs(c.t - key.t) < 1e-6)), ...contacts].sort((a, b) => a.t - b.t) };
  });
}
