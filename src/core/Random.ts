/** 경기마다 난수원을 소유해 화면 효과나 다른 경기의 호출 순서에 영향을 받지 않는다. */
export class Random {
  private state: number | undefined;

  constructor(seed?: number) {
    this.state = seed === undefined ? undefined : seed >>> 0;
  }

  next(): number {
    // 일반 플레이는 기존 분포를 유지하고, 시드가 주어진 시뮬레이션만 Mulberry32를 쓴다.
    if (this.state === undefined) return Math.random();
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  gauss(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

// 관중·애니메이션·사운드는 경기 시드를 소비하면 안 된다.
export const visualRandom = new Random();
