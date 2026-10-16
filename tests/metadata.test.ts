import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const publicFile = (name: string) => new URL(`../public/${name}`, import.meta.url);
const pngSize = (name: string) => {
  const bytes = readFileSync(publicFile(name));
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

it('공유용 실제 경기 스크린샷은 1200×630 PNG다', () => {
  expect(pngSize('og-image.png')).toEqual([1200, 630]);
});

it('홈 화면 아이콘과 매니페스트는 하위 경로 배포에서도 같은 앱을 연다', () => {
  const manifest = JSON.parse(readFileSync(publicFile('manifest.webmanifest'), 'utf8'));
  const base = 'https://inticoy.github.io/snapshoot-classic/';
  expect(new URL(manifest.start_url, base).href).toBe(base);
  expect(new URL(manifest.scope, base).href).toBe(base);
  expect(manifest.lang).toBe('ko');
  expect(manifest.description).toMatch(/[가-힣]/);
  expect(manifest.icons).toHaveLength(2);
  for (const icon of manifest.icons) {
    const size = Number(icon.sizes.split('x')[0]);
    expect(pngSize(icon.src)).toEqual([size, size]);
    expect(new URL(icon.src, base).pathname).toContain('/snapshoot-classic/');
  }
  expect(pngSize('apple-touch-icon.png')).toEqual([180, 180]);
});

it('HTML이 한국어 공유 설명과 실제 배포 경로의 이미지·아이콘을 연결한다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const content = (key: string) => html.match(new RegExp(`(?:name|property)="${key}" content="([^"]+)"`))?.[1];
  for (const key of ['description', 'og:description', 'twitter:description']) expect(content(key)).toMatch(/[가-힣]/);
  expect(content('og:title')).toContain('SnapShoot Classic');
  expect(content('twitter:card')).toBe('summary_large_image');
  expect(content('theme-color')).toMatch(/^#[0-9a-f]{6}$/i);
  const image = new URL(content('og:image')!);
  expect(image.origin + image.pathname).toBe('https://inticoy.github.io/snapshoot-classic/og-image.png');
  expect(content('twitter:image')).toBe(image.href);
  for (const name of ['favicon.svg', 'apple-touch-icon.png', 'manifest.webmanifest']) {
    expect(html).toContain(`href="./${name}"`);
    expect(readFileSync(publicFile(name)).length).toBeGreaterThan(0);
  }
});
