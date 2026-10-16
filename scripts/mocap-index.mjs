import { readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

// mocap-local/ 안의 원본 동작 목록을 만든다 (모션 테스트 페이지가 읽는다). 원본은 git에 올리지 않는다.
const root = 'mocap-local';
async function walk(dir, ext) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, ext)));
    else if (e.name.endsWith(ext)) out.push(relative(root, p));
  }
  return out.sort();
}
const index = { rohr: await walk(join(root, 'rohr'), '.fbx').catch(() => []), grf: await walk(join(root, 'grf'), '.anim').catch(() => []) };
await writeFile(join(root, 'index.json'), JSON.stringify(index, null, 1));
console.log(`rohr ${index.rohr.length}, grf ${index.grf.length}`);
