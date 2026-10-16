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

interface SettingsData {
  passAssist: AssistLevel;
  shotAssist: AssistLevel;
}

const KEY = 'football-game:settings';

function load(): SettingsData {
  const fallback: SettingsData = { passAssist: 'assisted', shotAssist: 'assisted' };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SettingsData>;
    return {
      passAssist: ORDER.includes(parsed.passAssist!) ? parsed.passAssist! : fallback.passAssist,
      shotAssist: ORDER.includes(parsed.shotAssist!) ? parsed.shotAssist! : fallback.shotAssist,
    };
  } catch {
    return fallback;
  }
}

export const settings: SettingsData = load();

export function cycleAssist(key: keyof SettingsData, dir: 1 | -1): void {
  const i = ORDER.indexOf(settings[key]);
  settings[key] = ORDER[(i + dir + ORDER.length) % ORDER.length];
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 저장이 막혀 있어도 이번 세션에서는 동작한다
  }
}
