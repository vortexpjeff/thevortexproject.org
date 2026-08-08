import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const catalogUrl = new URL('../institute-src/_data/editorial.json', import.meta.url);
const scriptPath = new URL('../scripts/promote-publication.sh', import.meta.url);
const zeroHash = '0'.repeat(64);

test('promotion cannot manufacture privacy or rights clearance', async () => {
  const before = await readFile(catalogUrl);
  const result = spawnSync('bash', [
    scriptPath.pathname,
    '--id=dispatch-2026-08-08-frognet-field-probe',
    '--to=approved',
    '--editor=Test editor',
    `--expected-sha256=${zeroHash}`,
  ], {encoding: 'utf8'});
  const after = await readFile(catalogUrl);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /independent privacy and rights clearance/i);
  assert.deepEqual(after, before);
});

test('release cannot skip the approved state', async () => {
  const result = spawnSync('bash', [
    scriptPath.pathname,
    '--id=dispatch-2026-08-08-frognet-field-probe',
    '--to=released',
    '--editor=Test editor',
    `--expected-sha256=${zeroHash}`,
    '--published-at=2026-08-08T00:00:00Z',
  ], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be approved before promotion/i);
});
