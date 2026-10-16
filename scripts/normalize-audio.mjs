import { readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { spawnSync } from 'node:child_process';

// 원본은 작업 디렉터리에 보관하고, 배포 파일만 모노 MP3로 변환한다.
const [sourceDir, outputDir] = process.argv.slice(2);
if (!sourceDir || !outputDir) {
  console.error('Usage: node scripts/normalize-audio.mjs <source-dir> <output-dir>');
  process.exit(1);
}
const run = (args) => {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stderr;
};
const temp = mkdtempSync(join(tmpdir(), 'snapshoot-audio-'));
mkdirSync(outputDir, { recursive: true });
try {
  for (const file of readdirSync(sourceDir).filter((f) => /\.(ogg|wav|mp3)$/i.test(f))) {
    const name = parse(file).name;
    const crowd = ['chant', 'cheer', 'goal'].includes(name);
    const trimmed = join(temp, `${name}.wav`);
    const input = join(sourceDir, file);
    // 단발 소리의 앞쪽 무음을 지워 터치 시점과 소리의 시작을 맞춘다.
    run(['-y', '-i', input, '-af', crowd ? 'anull' : 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.005', '-ac', '1', '-ar', '44100', trimmed]);
    const output = join(outputDir, `${name}.mp3`);
    if (crowd) {
      run(['-y', '-i', trimmed, '-af', 'loudnorm=I=-23:TP=-3:LRA=11', '-ac', '1', '-ar', '44100', '-b:a', '128k', output]);
    } else {
      const data = run(['-i', trimmed, '-af', 'volumedetect', '-f', 'null', '-']);
      const peak = Number(data.match(/max_volume:\s*([-\d.]+) dB/)?.[1]);
      if (!Number.isFinite(peak)) throw new Error(`Could not measure peak: ${file}`);
      run(['-y', '-i', trimmed, '-af', `volume=${-3 - peak}dB`, '-ac', '1', '-ar', '44100', '-b:a', '128k', output]);
    }
    console.log(`${file} -> ${name}.mp3 (${crowd ? '-23 LUFS' : '-3 dBFS peak'})`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
