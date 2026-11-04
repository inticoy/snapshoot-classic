import { MATCH } from '../config';
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

/**
 * 상대 AI 난이도 (FC 시리즈: 아마추어 ~ 얼티밋). 사람이 조작하지 않는 상대 팀에만 적용한다.
 *  reaction: 판단 주기 배수 (클수록 늦게 반응) · tackle: 태클 시도 배수 · skill: 개인기 시도 배수 · error: 패스·슛 오차 배수
 * 월드 클래스 = 기본 AI 그대로.
 */
export type Difficulty = 'amateur' | 'semipro' | 'professional' | 'worldclass' | 'legendary' | 'ultimate';
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  amateur: '아마추어', semipro: '세미프로', professional: '프로', worldclass: '월드 클래스', legendary: '레전드', ultimate: '얼티밋',
};
export const DIFFICULTY: Record<Difficulty, { reaction: number; tackle: number; skill: number; error: number }> = {
  amateur: { reaction: 2, tackle: 0.35, skill: 0.3, error: 1.8 },
  semipro: { reaction: 1.6, tackle: 0.55, skill: 0.5, error: 1.45 },
  professional: { reaction: 1.3, tackle: 0.75, skill: 0.75, error: 1.2 },
  worldclass: { reaction: 1, tackle: 1, skill: 1, error: 1 },
  legendary: { reaction: 0.8, tackle: 1.25, skill: 1.2, error: 0.85 },
  ultimate: { reaction: 0.65, tackle: 1.45, skill: 1.35, error: 0.72 },
};
const DIFFICULTY_ORDER = Object.keys(DIFFICULTY) as Difficulty[];

export type GraphicsQuality = 'auto' | 'low' | 'high';
export const GRAPHICS_LABEL: Record<GraphicsQuality, string> = { auto: '자동', low: '낮음', high: '높음' };
const GRAPHICS_ORDER: GraphicsQuality[] = ['auto', 'low', 'high'];

interface SettingsData {
  duration: number;
  passAssist: AssistLevel;
  shotAssist: AssistLevel;
  moveAssist: MoveAssist;
  physicsPreset: PresetName;
  graphicsQuality: GraphicsQuality;
  /** 무승부면 승부차기 */
  shootout: boolean;
  difficulty: Difficulty;
}

const KEY = 'snapshoot-classic:settings';

function load(): SettingsData {
  const fallback: SettingsData = { duration: MATCH.durationSeconds, passAssist: 'assisted', shotAssist: 'assisted', moveAssist: 'high', physicsPreset: 'arcade', graphicsQuality: 'auto', shootout: false, difficulty: 'worldclass' };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SettingsData>;
    return {
      duration: MATCH.durations.includes(parsed.duration!) ? parsed.duration! : fallback.duration,
      passAssist: ORDER.includes(parsed.passAssist!) ? parsed.passAssist! : fallback.passAssist,
      shotAssist: ORDER.includes(parsed.shotAssist!) ? parsed.shotAssist! : fallback.shotAssist,
      moveAssist: MOVE_ORDER.includes(parsed.moveAssist!) ? parsed.moveAssist! : fallback.moveAssist,
      physicsPreset: parsed.physicsPreset === 'real' ? 'real' : 'arcade',
      graphicsQuality: GRAPHICS_ORDER.includes(parsed.graphicsQuality!) ? parsed.graphicsQuality! : 'auto',
      shootout: parsed.shootout === true,
      difficulty: DIFFICULTY_ORDER.includes(parsed.difficulty!) ? parsed.difficulty! : fallback.difficulty,
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

export function cycleGraphics(dir: 1 | -1): void {
  const i = GRAPHICS_ORDER.indexOf(settings.graphicsQuality);
  settings.graphicsQuality = GRAPHICS_ORDER[(i + dir + GRAPHICS_ORDER.length) % GRAPHICS_ORDER.length];
  save();
}

/** 터치 또는 적은 CPU 코어는 자동 품질에서 렌더링 비용을 줄인다. */
export function graphicsQuality(touch: boolean, cores: number): 'low' | 'high' {
  return settings.graphicsQuality === 'auto' ? (touch || cores <= 4 ? 'low' : 'high') : settings.graphicsQuality;
}

export function cycleDifficulty(dir: 1 | -1): void {
  const i = DIFFICULTY_ORDER.indexOf(settings.difficulty);
  settings.difficulty = DIFFICULTY_ORDER[Math.min(DIFFICULTY_ORDER.length - 1, Math.max(0, i + dir))];
  save();
}

export function toggleShootout(): void {
  settings.shootout = !settings.shootout;
  save();
}

export function setDuration(duration: number): void {
  if (!MATCH.durations.includes(duration)) return;
  settings.duration = duration;
  save();
}
