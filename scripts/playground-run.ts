import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { runScript } from '../src/playground/Script';

async function expand(pattern: string): Promise<string[]> {
  if (!pattern.includes('*') && !pattern.includes('?')) return [resolve(pattern)];
  const absolute = resolve(pattern);
  const wild = absolute.search(/[?*]/);
  const root = absolute.slice(0, wild).replace(/\/[^/]*$/, '') || '/';
  const expression = new RegExp(`^${absolute.split(/([*?])/).map((part) => part === '*' ? '[^/]*' : part === '?' ? '[^/]' : part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('')}$`);
  const found: string[] = [];
  async function walk(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (expression.test(child)) found.push(child);
    }
  }
  await walk(root);
  return found.sort();
}

const args = process.argv.slice(2);
if (!args.length) throw new Error('사용법: npx vite-node scripts/playground-run.ts <script.json|glob>... [out.json|output-dir]');
const output = args.length >= 2 && !existsSync(args.at(-1)!) && (args.at(-1)!.endsWith('.json') || args.at(-1)!.endsWith('/')) ? args.pop() : undefined;
const files = (await Promise.all(args.map(expand))).flat();
if (!files.length) throw new Error('일치하는 스크립트가 없습니다');
if (files.length > 1 && output?.endsWith('.json')) throw new Error('여러 입력에는 출력 디렉터리를 지정하세요');
for (const file of files) {
  const result = runScript(JSON.parse(await readFile(file, 'utf8')));
  if (output) {
    const destination = files.length === 1 && output.endsWith('.json') ? output : join(output, `${basename(file, '.json')}.result.json`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(result, null, 2) + '\n');
  }
  console.log(JSON.stringify({ file, summary: result.summary }));
}
