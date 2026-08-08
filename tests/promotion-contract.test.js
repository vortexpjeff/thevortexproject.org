import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {publicationRevisionHash} from '../publication-contract.js';

const catalogUrl = new URL('../institute-src/_data/editorial.json', import.meta.url);
const scriptPath = new URL('../scripts/promote-publication.sh', import.meta.url);
const zeroHash = '0'.repeat(64);

test('approval requires a recorded review assessment', async () => {
  const before = await readFile(catalogUrl);
  const record = JSON.parse(before).publications.find(item => item.id === 'dispatch-2026-08-08-frognet-field-probe');
  const result = spawnSync('bash', [
    scriptPath.pathname,
    '--id=dispatch-2026-08-08-frognet-field-probe',
    '--to=approved',
    '--editor=Test editor',
    `--expected-sha256=${publicationRevisionHash(record)}`,
    '--approved-at=2026-08-08T00:00:00Z',
  ], {encoding: 'utf8'});
  const after = await readFile(catalogUrl);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /passed review assessment/i);
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
