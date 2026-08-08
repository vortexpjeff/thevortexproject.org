import {createHash} from 'node:crypto';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {resolveBuildMode} from '../build-context.js';

const root = new URL('../_site/', import.meta.url);
const rootPath = root.pathname;
async function files(path) {
  const result = [];
  for (const entry of await readdir(path, {withFileTypes: true})) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await files(child));
    else if (entry.name !== 'build-manifest.json') result.push(child);
  }
  return result;
}
const records = [];
for (const path of (await files(rootPath)).sort()) {
  const data = await readFile(path);
  records.push({path: relative(rootPath, path), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex')});
}
const manifest = {schema_version: 1, build_mode: resolveBuildMode(), files: records};
await writeFile(new URL('build-manifest.json', root), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest ${records.length} files`);
