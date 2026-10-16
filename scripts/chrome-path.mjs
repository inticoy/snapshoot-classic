import { readdir, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

// 저장소 지침대로 Playwright 캐시의 Chrome for Testing을 우선 사용한다.
export async function chromePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (process.platform !== 'darwin') return chromium.executablePath();
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const versions = (await readdir(cache)).filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const version of versions) {
    for (const arch of ['arm64', 'x64']) {
      const path = join(cache, version, `chrome-mac-${arch}`, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      try { await access(path); return path; } catch { /* 다른 캐시 버전을 확인한다. */ }
    }
  }
  throw new Error('Chrome for Testing 경로를 CHROMIUM_PATH로 지정하세요.');
}

