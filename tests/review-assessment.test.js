import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const wrapper = new URL('../scripts/record-publication-assessment.sh', import.meta.url).pathname;
const mutator = new URL('../scripts/record-publication-assessment.mjs', import.meta.url).pathname;
const timestamp = '2026-08-08T23:30:00Z';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'vortex-review-assessment-'));
  const repo = join(root, 'repo');
  await mkdir(join(repo, 'institute-src', '_data'), {recursive: true});
  const record = {
    id: 'dispatch-assessment', revision: 1, editorial_state: 'review', title: 'Assessment',
    summary: 'Review assessment fixture', content_type: 'Science Watch', stream: 'Science Watch',
    generated_at: timestamp, slug: 'assessment', url: 'https://www.thevortexproject.org/dispatches/assessment/',
    privacy_state: 'review', rights_state: 'review', evidence_state: 'external source review', correction_state: 'none',
    accountable_editor: null,
    sources: [{kind: 'primary', title: 'Primary', url: 'https://example.gov/source', retrieved_at: '2026-08-08'}],
  };
  await writeFile(join(repo, 'institute-src', '_data', 'editorial.json'), `${JSON.stringify({schema_version: 1, publications: [record]}, null, 2)}\n`);
  const input = join(root, 'assessment.json');
  await writeFile(input, `${JSON.stringify({
    checked_by: ['Hermes Athena'],
    claims_basis: 'Primary-source comparison passed.',
    privacy_basis: 'No private boundary material found.',
    rights_basis: 'Original summary with attributed public source.',
    sources: ['https://example.gov/source'],
  }, null, 2)}\n`);
  return {root, repo, input};
}

test('assessment recording requires the lock wrapper and records checks without approval', async () => {
  const {root, repo, input} = await fixture();
  const args = ['--id=dispatch-assessment', `--input=${input}`, `--checked-at=${timestamp}`];
  const direct = spawnSync(process.execPath, [mutator, ...args], {encoding: 'utf8', env: {...process.env, VORTEX_SITE_REPO: repo}});
  assert.notEqual(direct.status, 0);
  assert.match(direct.stderr, /shared-lock wrapper/i);

  const recorded = spawnSync('bash', [wrapper, ...args], {
    encoding: 'utf8',
    env: {...process.env, VORTEX_SITE_REPO: repo, VORTEX_SITE_LOCK: join(root, 'site.lock')},
  });
  assert.equal(recorded.status, 0, recorded.stderr);
  const catalog = JSON.parse(await readFile(join(repo, 'institute-src', '_data', 'editorial.json'), 'utf8'));
  const record = catalog.publications[0];
  assert.equal(record.editorial_state, 'review');
  assert.equal(record.privacy_state, 'review');
  assert.equal(record.rights_state, 'review');
  assert.equal(record.accountable_editor, null);
  assert.equal(record.review_assessment.state, 'checks-passed');
  assert.equal(record.publication_approval, undefined);

  const repeated = spawnSync('bash', [wrapper, ...args], {
    encoding: 'utf8',
    env: {...process.env, VORTEX_SITE_REPO: repo, VORTEX_SITE_LOCK: join(root, 'site.lock')},
  });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /already recorded/i);

  const changedInput = join(root, 'changed-assessment.json');
  await writeFile(changedInput, `${JSON.stringify({
    checked_by: ['Hermes Athena'],
    claims_basis: 'Changed claim assessment.',
    privacy_basis: 'No private boundary material found.',
    rights_basis: 'Original summary with attributed public source.',
    sources: ['https://example.gov/source'],
  })}\n`);
  const replacement = spawnSync('bash', [wrapper, '--id=dispatch-assessment', `--input=${changedInput}`, `--checked-at=${timestamp}`], {
    encoding: 'utf8',
    env: {...process.env, VORTEX_SITE_REPO: repo, VORTEX_SITE_LOCK: join(root, 'site.lock')},
  });
  assert.notEqual(replacement.status, 0);
  assert.match(replacement.stderr, /refusing silent replacement/i);
});
