export type SoundKey = 'kick' | 'bounce' | 'goal' | 'net' | 'post' | 'cheer' | 'chant' | 'save';

const FILES: Record<SoundKey, string> = {
  kick: 'assets/audio/kick.mp3',
  bounce: 'assets/audio/bounce.mp3',
  goal: 'assets/audio/goal.mp3',
  net: 'assets/audio/net.mp3',
  post: 'assets/audio/post.mp3',
  cheer: 'assets/audio/cheer.mp3',
  chant: 'assets/audio/chant.mp3',
  save: 'assets/audio/save.mp3',
};

/** WebAudio 기반 효과음. 사용자 입력 이후 unlock() 해야 소리가 난다 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
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
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
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
    this.ambienceGain.gain.value = 0.18;
    this.ambience.connect(this.ambienceGain).connect(this.master);
    this.ambience.start();
  }

  setAmbienceLevel(level: number): void {
    if (!this.ctx || !this.ambienceGain) return;
    this.ambienceGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
  }

  /** 심판 휘슬 (합성음) */
  whistle(pattern: number[] = [0.35]): void {
    if (!this.ctx || !this.master || this.muted) return;
    let t = this.ctx.currentTime + 0.02;
    for (const len of pattern) {
      const osc = this.ctx.createOscillator();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      const g = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 2650;
      lfo.frequency.value = 28; // 휘슬 특유의 떨림
      lfoGain.gain.value = 180;
      lfo.connect(lfoGain).connect(osc.frequency);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.02);
      g.gain.setValueAtTime(0.07, t + len - 0.04);
      g.gain.linearRampToValueAtTime(0, t + len);
      osc.connect(g).connect(this.master);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + len);
      lfo.stop(t + len);
      t += len + 0.12;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.8;
    return this.muted;
  }
}
