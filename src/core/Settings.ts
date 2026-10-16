import { setActivePhysics, type PresetName } from '../physics/presets';

/**
 * 조작 보조 설정 (FC 시리즈의 패스/슛 어시스트 옵션).
 *  보조: 방향과 세기를 게임이 맞춰 준다 (패스는 동료에게, 슛은 골문 안으로)
 *  세미: 방향은 가까운 동료/골문 쪽으로 살짝 보정, 세기는 게이지 그대로
 *  수동: 입력한 방향과 게이지 그대로
 */
export type AssistLevel = 'assisted' | 'semi' | 'manual';

export const ASSIST_LABEL: Record<AssistLevel, string> = {
  assisted: '보조',
  semi: '세미',
  manual: '수동',
};

const ORDER: AssistLevel[] = ['assisted', 'semi', 'manual'];

/**
 * 자동 전환 이동 보조 (FC: Auto Switching Move Assistance).
 * 패스로 받는 선수가 바뀐 직후 얼마 동안 AI가 받으러 가는 움직임을 유지할지.
 */
export type MoveAssist = 'none' | 'low' | 'high';
export const MOVE_ASSIST_LABEL: Record<MoveAssist, string> = { none: '없음', low: '낮음', high: '높음' };
export const MOVE_ASSIST_TIME: Record<MoveAssist, number> = { none: 0, low: 0.25, high: 0.55 };
const MOVE_ORDER: MoveAssist[] = ['none', 'low', 'high'];

interface SettingsData {
  passAssist: AssistLevel;
  shotAssist: AssistLevel;
  moveAssist: MoveAssist;
  physicsPreset: PresetName;
}

const KEY = 'snapshoot-classic:settings';

function load(): SettingsData {
  const fallback: SettingsData = { passAssist: 'assisted', shotAssist: 'assisted', moveAssist: 'high', physicsPreset: 'arcade' };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SettingsData>;
    return {
      passAssist: ORDER.includes(parsed.passAssist!) ? parsed.passAssist! : fallback.passAssist,
      shotAssist: ORDER.includes(parsed.shotAssist!) ? parsed.shotAssist! : fallback.shotAssist,
      moveAssist: MOVE_ORDER.includes(parsed.moveAssist!) ? parsed.moveAssist! : fallback.moveAssist,
      physicsPreset: parsed.physicsPreset === 'real' ? 'real' : 'arcade',
    };
  } catch {
    return fallback;
  }
}

export const settings: SettingsData = load();
setActivePhysics(settings.physicsPreset);

export function togglePhysicsPreset(): PresetName {
  settings.physicsPreset = settings.physicsPreset === 'arcade' ? 'real' : 'arcade';
  setActivePhysics(settings.physicsPreset);
  save();
  return settings.physicsPreset;
}

export function cycleAssist(key: 'passAssist' | 'shotAssist', dir: 1 | -1): void {
  const i = ORDER.indexOf(settings[key]);
  settings[key] = ORDER[(i + dir + ORDER.length) % ORDER.length];
  save();
}

export function cycleMoveAssist(dir: 1 | -1): void {
  const i = MOVE_ORDER.indexOf(settings.moveAssist);
  settings.moveAssist = MOVE_ORDER[(i + dir + MOVE_ORDER.length) % MOVE_ORDER.length];
  save();
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 저장이 막혀 있어도 이번 세션에서는 동작한다
  }
}
