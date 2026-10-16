import { AUDIO_MIX } from '../config';
export type SoundKey = 'kick' | 'bounce' | 'goal' | 'net' | 'post' | 'cheer' | 'chant' | 'save' | 'kick-light' | 'touch-1' | 'touch-2' | 'touch-3' | 'touch-4' | 'whistle-short' | 'whistle-long';

const FILES: Record<SoundKey, string> = {
  kick: 'assets/audio/kick.mp3',
  bounce: 'assets/audio/bounce.mp3',
  goal: 'assets/audio/goal.mp3',
  net: 'assets/audio/net.mp3',
  post: 'assets/audio/post.mp3',
  cheer: 'assets/audio/cheer.mp3',
  chant: 'assets/audio/chant.mp3',
  save: 'assets/audio/save.mp3',
  'kick-light': 'assets/audio/kick-light.mp3',
  'touch-1': 'assets/audio/touch-1.mp3',
  'touch-2': 'assets/audio/touch-2.mp3',
  'touch-3': 'assets/audio/touch-3.mp3',
  'touch-4': 'assets/audio/touch-4.mp3',
  'whistle-short': 'assets/audio/whistle-short.mp3',
  'whistle-long': 'assets/audio/whistle-long.mp3',
};

/** WebAudio 기반 효과음. 사용자 입력 이후 unlock() 해야 소리가 난다 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private readonly buffers = new Map<SoundKey, AudioBuffer>();
  private ambience: AudioBufferSourceNode | null = null;
  private ambienceGain: GainNode | null = null;
  private readonly lastPlayed = new Map<SoundKey, number>();
  muted = false;

  async unlock(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = AUDIO_MIX.master;
    // 동시 발생한 충격음과 관중음의 합이 순간적으로 튀는 것을 완화한다.
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.2;
    this.master.connect(this.compressor).connect(this.ctx.destination);
    await Promise.all(
      (Object.keys(FILES) as SoundKey[]).map(async (k) => {
        try {
          const res = await fetch(FILES[k]);
          const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(k, buf);
        } catch (e) {
          console.warn('sound load failed', k, e);
        }
      }),
    );
  }

  play(key: SoundKey, volume = 1, rate = 1): void {
    if (!this.ctx || !this.master || this.muted) return;
    // 비정상 값 하나로 AudioParam이 예외를 던지면 그 프레임의 HUD 갱신까지 멈춘다
    if (!Number.isFinite(volume) || !Number.isFinite(rate)) {
      if (import.meta.env.DEV) console.warn('[sound] 비정상 값', key, volume, rate);
      return;
    }
    const buf = this.buffers.get(key);
    if (!buf) return;
    // 같은 소리가 너무 촘촘히 겹치지 않게
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed.get(key) ?? -1) < 0.06) return;
    this.lastPlayed.set(key, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    src.start();
  }

  startAmbience(): void {
    if (!this.ctx || !this.master || this.ambience) return;
    const buf = this.buffers.get('chant');
    if (!buf) return;
    this.ambience = this.ctx.createBufferSource();
    this.ambience.buffer = buf;
    this.ambience.loop = true;
    this.ambienceGain = this.ctx.createGain();
    this.ambienceGain.gain.value = 0.12;
    this.ambience.connect(this.ambienceGain).connect(this.master);
    this.ambience.start();
  }

  setAmbienceLevel(level: number): void {
    if (!this.ctx || !this.ambienceGain) return;
    this.ambienceGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
  }

  /** 짧은/긴 CC0 휘슬 샘플을 재개 사유에 맞춰 순서대로 낸다. */
  /**
   * 심판 휘슬 (합성): 구슬 휘슬처럼 약 3.1kHz 두 음 + 구슬 떨림(45Hz 진폭·주파수 흔들림) + 숨소리 잡음.
   * pattern: 각 소리 길이(초). 킥오프 1번, 전반 종료 2번, 경기 종료 짧게 2번 + 길게 1번
   */
  whistle(pattern: number[] = [0.35]): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    let t = ctx.currentTime + 0.02;
    const out = ctx.createGain();
    out.gain.value = AUDIO_MIX.whistle * 0.35;
    out.connect(this.master);
    for (const len of pattern) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.015);
      env.gain.setValueAtTime(1, t + len - 0.04);
      env.gain.linearRampToValueAtTime(0, t + len);
      env.connect(out);
      // 구슬 떨림: 진폭과 주파수를 같이 흔든다
      const rattle = ctx.createOscillator();
      rattle.frequency.value = 42 + Math.random() * 8;
      const rattleAmp = ctx.createGain();
      rattleAmp.gain.value = 0.45;
      const trem = ctx.createGain();
      trem.gain.value = 0.55;
      rattle.connect(rattleAmp).connect(trem.gain);
      trem.connect(env);
      for (const [f, g] of [[3100, 0.5], [3180, 0.35]] as const) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const wob = ctx.createGain();
        wob.gain.value = 60;
        rattle.connect(wob).connect(o.frequency);
        const og = ctx.createGain();
        og.gain.value = g;
        o.connect(og).connect(trem);
        o.start(t);
        o.stop(t + len + 0.02);
      }
      // 숨소리: 대역 통과 잡음
      const noise = ctx.createBufferSource();
      const nb = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * (len + 0.05)), ctx.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noise.buffer = nb;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3100;
      bp.Q.value = 2;
      const ng = ctx.createGain();
      ng.gain.value = 0.12;
      noise.connect(bp).connect(ng).connect(env);
      noise.start(t);
      noise.stop(t + len + 0.02);
      rattle.start(t);
      rattle.stop(t + len + 0.02);
      t += len + 0.14;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : AUDIO_MIX.master;
    return this.muted;
  }
}
