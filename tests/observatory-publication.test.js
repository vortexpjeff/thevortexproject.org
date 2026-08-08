import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';

const publisher = new URL('../scripts/publish-observatory.sh', import.meta.url).pathname;
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();

test('locked Observatory transaction commits and pushes only its payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vortex-observatory-'));
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote]);
  await mkdir(work);
  git(work, 'init', '-b', 'main');
  git(work, 'config', 'user.name', 'Vortex Test');
  git(work, 'config', 'user.email', 'test@example.invalid');
  git(work, 'remote', 'add', 'origin', remote);
  await mkdir(join(work, 'scripts'));
  await mkdir(join(work, 'data'));
  await writeFile(join(work, 'README.md'), 'fixture\n');
  await writeFile(join(work, 'data/observatory.json'), '{"version":1}\n');
  await writeFile(join(work, 'scripts/generate_observatory_json.py'), "from pathlib import Path\nPath('data/observatory.json').write_text('{\\\"version\\\":2}\\n')\n");
  git(work, 'add', '.');
  git(work, 'commit', '-m', 'baseline');
  git(work, 'push', '-u', 'origin', 'main');

  const result = spawnSync('bash', [publisher], {
    env: {...process.env, VORTEX_SITE_REPO: work, VORTEX_SITE_LOCK: join(root, 'site.lock')},
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(work, 'log', '-1', '--format=%s'), 'Vortex Observatory');
  assert.equal(git(work, 'show', '--pretty=', '--name-only', 'HEAD'), 'data/observatory.json');
  assert.equal(git(work, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'));
  assert.equal(await readFile(join(work, 'data/observatory.json'), 'utf8'), '{"version":2}\n');

  const head = git(work, 'rev-parse', 'HEAD');
  const unchanged = spawnSync('bash', [publisher], {
    env: {...process.env, VORTEX_SITE_REPO: work, VORTEX_SITE_LOCK: join(root, 'site.lock')},
    encoding: 'utf8',
  });
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.equal(git(work, 'rev-parse', 'HEAD'), head);

  await writeFile(join(work, 'README.md'), 'dirty\n');
  const dirty = spawnSync('bash', [publisher], {
    env: {...process.env, VORTEX_SITE_REPO: work, VORTEX_SITE_LOCK: join(root, 'site.lock')},
    encoding: 'utf8',
  });
  assert.equal(dirty.status, 71);
  assert.match(dirty.stderr, /tracked working tree is not clean/i);
});
