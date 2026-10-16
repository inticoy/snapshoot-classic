import { AUDIO_MIX } from '../config';

export type SoundCategory = 'ball' | 'body' | 'crowd' | 'whistle';

export function categoryVolume(category: SoundCategory, intensity = 1): number {
  const amount = AUDIO_MIX[category];
  return Math.max(0, Math.min(amount, amount * Math.max(0, intensity)));
}

export interface TouchSoundDecision {
  volume: number;
  nextTime: number;
}

/** 선수별 터치 간격과 공의 움직임, 카메라 거리를 함께 판단한다. */
export function decideTouchSound(speed: number, distance: number, now: number, lastTime = -Infinity): TouchSoundDecision {
  if (!Number.isFinite(speed) || !Number.isFinite(distance) || !Number.isFinite(now) ||
      now - lastTime + 1e-9 < AUDIO_MIX.touchGap || speed < AUDIO_MIX.quietTouchSpeed || distance >= AUDIO_MIX.touchMaxDistance) {
    return { volume: 0, nextTime: lastTime };
  }
  const motion = Math.min(1, (speed - AUDIO_MIX.quietTouchSpeed) / 6);
  const falloff = distance <= 8 ? 1 : Math.max(0, (AUDIO_MIX.touchMaxDistance - distance) / 17);
  return { volume: categoryVolume('ball', (0.15 + motion * 0.45) * falloff), nextTime: now };
}
