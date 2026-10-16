/**
 * 선수 외형 (피부·머리 색, 헤어스타일, 수염). 이름으로 정해지므로 매 경기 같은 얼굴이 나온다.
 * 실존 인물을 닮게 하려는 게 아니라 원거리 중계 화면에서 서로 구분되는 정도가 목표다.
 */
export const SKIN_TONES = [0xf1c7a5, 0xe8b894, 0xd9a47e, 0xb07a52, 0x8d5c3b, 0x6a4128];
export const HAIR_TONES = [0x111111, 0x1d1510, 0x3a2516, 0x6b4a2a, 0xa8743f, 0xc9a25a];

/** 0 짧은 머리, 1 아주 짧게(버즈컷), 2 긴 머리, 3 민머리 */
export type HairStyle = 0 | 1 | 2 | 3;

export interface Appearance {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  beard: boolean;
}

/** 문자열 해시 (FNV-1a) */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function appearance(name: string): Appearance {
  const h = hash(name);
  const pick = (shift: number, n: number) => (h >>> shift) % n;
  const hairStyle = [0, 0, 1, 2, 0, 1, 3, 2][pick(8, 8)] as HairStyle;
  return {
    skin: SKIN_TONES[pick(0, SKIN_TONES.length)],
    hair: HAIR_TONES[pick(4, HAIR_TONES.length)],
    hairStyle,
    beard: pick(12, 4) === 0,
  };
}

/** 등에 새기는 이름: 'J. SON' → 'SON' */
export function backName(short: string): string {
  const i = short.lastIndexOf('. ');
  return (i >= 0 ? short.slice(i + 2) : short).toUpperCase();
}
