// Mixamo에서 축구 동작을 한꺼번에 받는다 (개발용, 본인 계정 토큰 필요: mocap-local/mixamo/.token)
// node scripts/dev/mixamo-fetch.mjs <검색어> <앞에서 몇 개> [캐릭터 id]
// 60fps로 받고(나중에 줄여 써도 된다), 좌우 비대칭 동작을 위해 거울 버전(_mirror)도 받는다
import fs from 'node:fs';
import path from 'node:path';
const dir = 'mocap-local/mixamo';
const token = fs.readFileSync(path.join(dir, '.token'), 'utf8').trim();
const [query = 'soccer', count = '64', charArg] = process.argv.slice(2);
const H = { Authorization: `Bearer ${token}`, 'X-Api-Key': 'mixamo2', Accept: 'application/json', 'Content-Type': 'application/json' };
const api = async (p, init = {}) => {
  const r = await fetch(`https://www.mixamo.com/api/v1/${p}`, { ...init, headers: H });
  if (!r.ok) throw new Error(`${p} ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const primary = await api('characters/primary');
const cid = charArg ?? primary.primary_character_id;
const cname = charArg ? (await api(`products/${cid}`)).name : primary.primary_character_name;
console.log('character', cname);

async function exportAndSave(body, file) {
  if (fs.existsSync(file)) return console.log('skip', file);
  await api('animations/export', { method: 'POST', body: JSON.stringify(body) });
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const m = await api(`characters/${cid}/monitor`);
    if (m.status === 'completed') {
      const bin = await fetch(m.job_result);
      fs.writeFileSync(file, Buffer.from(await bin.arrayBuffer()));
      return console.log('saved', file);
    }
    if (m.status === 'failed') throw new Error(`failed ${file} ${JSON.stringify(m).slice(0, 200)}`);
  }
  throw new Error(`timeout ${file}`);
}

const list = (await api(`products?page=1&limit=96&order=&type=Motion%2CMotionPack&query=${encodeURIComponent(query)}`)).results.slice(0, Number(count));
const anims = path.join(dir, 'anims');
fs.mkdirSync(anims, { recursive: true });
for (const [i, item] of list.entries()) {
  try {
    const d = await api(`products/${item.id}?similar=0&character_id=${cid}`);
    const base = `${String(i).padStart(2, '0')}_${item.name.replace(/[^A-Za-z0-9]+/g, '_')}_${item.id.slice(0, 8)}`;
    for (const mirror of item.type === 'MotionPack' ? [false] : [false, true]) {
      const hashes = (d.details.gms_hash ? [d.details.gms_hash] : d.details.motions?.map((m) => m.gms_hash) ?? []).map((g) => ({
        ...g, inplace: g.inplace !== undefined ? true : g.inplace, mirror,
        params: (g.params ?? []).map((p) => p[1]).join(','),
      }));
      await exportAndSave({
        character_id: cid, gms_hash: hashes, product_name: item.name, type: item.type,
        preferences: { format: 'fbx7_2019', skin: 'false', fps: '60', reducekf: '0' },
      }, path.join(anims, `${base}${mirror ? '_mirror' : ''}${item.type === 'MotionPack' ? '.zip' : '.fbx'}`));
    }
  } catch (e) { console.log('ERR', item.name, e.message); }
}
// 캐릭터 (스킨 포함, T자세)
try {
  await exportAndSave({ character_id: cid, product_name: cname, type: 'Character', preferences: { format: 'fbx7_2019', mesh: 't-pose' }, gms_hash: null }, path.join(dir, `character_${cname}.fbx`));
} catch (e) { console.log('ERR character', e.message); }
