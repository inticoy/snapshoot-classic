import { afterEach, expect, it, vi } from 'vitest';
import { Sound } from '../src/audio/Sound';

afterEach(() => vi.unstubAllGlobals());

it('새 오디오는 fetch 완료 전에 resume하고 중복 unlock도 샘플 로드를 기다린다', async () => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  const node = () => ({ gain: { value: 0 }, connect: () => ({ connect() {} }) });
  const source = { buffer: null, loop: false, connect: (target: unknown) => target, start: vi.fn() };
  const context = {
    state: 'suspended', destination: {}, resume: vi.fn(async () => { context.state = 'running'; }),
    createGain: node,
    createDynamicsCompressor: () => ({ threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} }),
    decodeAudioData: vi.fn(async () => ({})), createBufferSource: () => source,
  };
  vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  const fetch = vi.fn(async () => { await ready; return { arrayBuffer: async () => new ArrayBuffer(0) }; });
  vi.stubGlobal('fetch', fetch);
  const sound = new Sound();
  const first = sound.unlock();
  expect(context.resume).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalled();
  let loaded = false;
  const second = sound.unlock().then(() => { loaded = true; });
  await Promise.resolve();
  expect(loaded).toBe(false);
  release();
  await Promise.all([first, second]);
  sound.startAmbience();
  expect(source.start).toHaveBeenCalledOnce();
  context.state = 'suspended';
  await sound.unlock();
  expect(context.resume).toHaveBeenCalledTimes(2);
});
