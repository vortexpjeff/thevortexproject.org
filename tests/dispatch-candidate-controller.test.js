import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, stat, symlink, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp} from 'node:fs/promises';

const controller = new URL('../scripts/dispatch-candidate-controller.mjs', import.meta.url).pathname;
const importMutator = new URL('../scripts/import-dispatch-candidate.mjs', import.meta.url).pathname;
const importer = new URL('../scripts/import-dispatch-candidate.sh', import.meta.url).pathname;
const fixedNow = '2026-08-08T22:30:00Z';

function candidate(overrides = {}) {
  return {
    schema_version: 1,
    topic: 'Open field sensor design',
    title: 'A field sensor should expose its evidence boundary',
    summary: 'A source-grounded candidate about separating capture, inference, and reviewed observation.',
    content_type: 'Open Build',
    stream: 'Open Builds',
    related_program: 'Field systems',
    evidence_level: 'Official open-source documentation',
    evidence_state: 'software context; no field observation claim',
    slug: 'field-sensor-evidence-boundary',
    sections: [
      {heading: 'What the source provides', body: 'The upstream project publishes code and operating documentation.'},
      {heading: 'What remains separate', body: 'A model output is not represented as a confirmed field observation.'},
    ],
    sources: [
      {kind: 'primary', title: 'Canonical project repository', url: 'https://github.com/example/field-sensor', retrieved_at: '2026-08-08'},
    ],
    ai_assistance: ['Hermes Athena'],
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'vortex-dispatch-controller-'));
  const queue = join(root, 'queue');
  const repo = join(root, 'repo');
  await mkdir(join(repo, 'institute-src', '_data'), {recursive: true});
  await writeFile(join(repo, 'institute-src', '_data', 'editorial.json'), `${JSON.stringify({schema_version: 1, publications: []}, null, 2)}\n`);
  return {root, queue, repo};
}

function run(args, {queue, repo, lockHeld = false} = {}) {
  return spawnSync(process.execPath, [controller, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VORTEX_INSTITUTE_QUEUE: queue,
      VORTEX_SITE_REPO: repo,
      VORTEX_NOW: fixedNow,
      ...(lockHeld ? {VORTEX_SITE_LOCK_HELD: '1'} : {}),
    },
  });
}

async function writeInput(root, value, name = 'candidate.json') {
  const path = join(root, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

test('enqueue writes one private candidate and rejects a duplicate fingerprint', async () => {
  const {root, queue, repo} = await fixture();
  const input = await writeInput(root, candidate());
  const first = run(['enqueue', `--input=${input}`, '--origin=chat'], {queue, repo});
  assert.equal(first.status, 0, first.stderr);
  const created = JSON.parse(first.stdout);
  assert.match(created.id, /^candidate-20260808-field-sensor-evidence-boundary-[a-f0-9]{10}$/);
  assert.equal(created.status, 'queued');
  assert.equal(created.origin, 'chat');
  assert.equal(created.review_checks.privacy.state, 'pending');
  assert.equal(created.review_checks.rights.state, 'pending');

  const stored = JSON.parse(await readFile(join(queue, `${created.id}.json`), 'utf8'));
  assert.equal(stored.fingerprint_sha256.length, 64);
  assert.equal(stored.title, candidate().title);
  assert.equal((await stat(queue)).mode & 0o777, 0o700);
  assert.equal((await stat(join(queue, `${created.id}.json`))).mode & 0o777, 0o600);

  const rewordedInput = await writeInput(root, candidate({
    title: 'Reworded title for the same source record',
    slug: 'reworded-same-source',
    sources: [{kind: 'primary', title: 'Canonical project repository', url: 'https://github.com/example/field-sensor?utm_source=cron#readme', retrieved_at: '2026-08-08'}],
  }), 'reworded.json');
  const duplicate = run(['enqueue', `--input=${rewordedInput}`, '--origin=scheduled'], {queue, repo});
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /duplicate candidate/i);
});

test('enqueue fails closed for non-HTTPS sources and private boundary text', async () => {
  const {root, queue, repo} = await fixture();
  const insecure = await writeInput(root, candidate({sources: [{kind: 'primary', title: 'Bad', url: 'http://example.com/source', retrieved_at: '2026-08-08'}]}), 'insecure.json');
  const insecureResult = run(['enqueue', `--input=${insecure}`, '--origin=scheduled'], {queue, repo});
  assert.notEqual(insecureResult.status, 0);
  assert.match(insecureResult.stderr, /HTTPS primary source/i);

  const privateInput = await writeInput(root, candidate({summary: 'Internal evidence at /home/operator/private/audio.wav must stay private.'}), 'private.json');
  const privateResult = run(['enqueue', `--input=${privateInput}`, '--origin=chat'], {queue, repo});
  assert.notEqual(privateResult.status, 0);
  assert.match(privateResult.stderr, /private boundary/i);

  for (const [name, url] of [
    ['userinfo', 'https://user:secret@example.com/source'],
    ['loopback', 'https://127.0.0.1/source'],
    ['rfc1918', 'https://172.20.0.2/source'],
    ['link-local', 'https://169.254.1.2/source'],
    ['private-dns', 'https://sensor.local/source'],
    ['ipv6-loopback', 'https://[::1]/source'],
    ['query-token', 'https://example.com/source?token=secret'],
    ['signed-query', 'https://example.com/source?X-Amz-Signature=secret'],
  ]) {
    const unsafe = await writeInput(root, candidate({sources: [{kind: 'primary', title: 'Unsafe', url, retrieved_at: '2026-08-08'}]}), `${name}.json`);
    const unsafeResult = run(['enqueue', `--input=${unsafe}`, '--origin=scheduled'], {queue, repo});
    assert.notEqual(unsafeResult.status, 0, `${name} unexpectedly accepted`);
    assert.match(unsafeResult.stderr, /credentials|public host|secret-bearing query parameter/i);
  }
});

test('enqueue rejects a primary source already represented in the Institute catalog', async () => {
  const {root, queue, repo} = await fixture();
  const existing = candidate();
  await writeFile(join(repo, 'institute-src', '_data', 'editorial.json'), `${JSON.stringify({
    schema_version: 1,
    publications: [{id: 'dispatch-existing', sources: existing.sources}],
  }, null, 2)}\n`);
  const input = await writeInput(root, existing);
  const result = run(['enqueue', `--input=${input}`, '--origin=scheduled'], {queue, repo});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already represented in the Institute catalog/i);
});

test('enqueue refuses a queue rooted inside the public website checkout', async () => {
  const {root, repo} = await fixture();
  const input = await writeInput(root, candidate());
  const result = run(['enqueue', `--input=${input}`, '--origin=chat'], {queue: join(repo, 'private-looking-queue'), repo});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outside the website repository/i);
});

test('enqueue refuses a queue redirected into the checkout by a symlinked ancestor', async () => {
  const {root, repo} = await fixture();
  const redirectedRoot = join(repo, 'redirected-private-queue');
  await mkdir(redirectedRoot);
  const parentLink = join(root, 'queue-parent-link');
  await symlink(repo, parentLink, 'dir');
  const input = await writeInput(root, candidate());
  const result = run(['enqueue', `--input=${input}`, '--origin=chat'], {queue: join(parentLink, 'redirected-private-queue'), repo});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /physically outside the website repository/i);
  assert.deepEqual(await readdir(redirectedRoot), []);
});

test('list, show, and reject operate on the private queue', async () => {
  const {root, queue, repo} = await fixture();
  const input = await writeInput(root, candidate());
  const enqueued = JSON.parse(run(['enqueue', `--input=${input}`, '--origin=chat'], {queue, repo}).stdout);

  const listed = run(['list', '--json'], {queue, repo});
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).map(item => item.id), [enqueued.id]);

  const shown = run(['show', `--id=${enqueued.id}`], {queue, repo});
  assert.equal(JSON.parse(shown.stdout).id, enqueued.id);

  const rejected = run(['reject', `--id=${enqueued.id}`, '--reason=Outside current program scope'], {queue, repo});
  assert.equal(rejected.status, 0, rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).status, 'rejected');
  assert.equal(JSON.parse(rejected.stdout).decision.reason, 'Outside current program scope');
});

test('import-review requires the shared-lock wrapper and creates only a review record', async () => {
  const {root, queue, repo} = await fixture();
  const input = await writeInput(root, candidate());
  const enqueued = JSON.parse(run(['enqueue', `--input=${input}`, '--origin=chat'], {queue, repo}).stdout);

  const direct = spawnSync(process.execPath, [importMutator, '--internal-flock-worker', `--id=${enqueued.id}`], {
    encoding: 'utf8',
    env: {...process.env, VORTEX_INSTITUTE_QUEUE: queue, VORTEX_SITE_REPO: repo, VORTEX_NOW: fixedNow, VORTEX_SITE_LOCK: join(root, 'site.lock')},
  });
  assert.notEqual(direct.status, 0);
  assert.match(direct.stderr, /not owned by the configured shared flock/i);

  const imported = spawnSync('bash', [importer, `--id=${enqueued.id}`], {
    encoding: 'utf8',
    env: {...process.env, VORTEX_INSTITUTE_QUEUE: queue, VORTEX_SITE_REPO: repo, VORTEX_NOW: fixedNow, VORTEX_SITE_LOCK: join(root, 'site.lock')},
  });
  assert.equal(imported.status, 0, imported.stderr);
  const result = JSON.parse(imported.stdout);
  assert.equal(result.status, 'imported');

  const catalog = JSON.parse(await readFile(join(repo, 'institute-src', '_data', 'editorial.json'), 'utf8'));
  assert.equal(catalog.publications.length, 1);
  const record = catalog.publications[0];
  assert.equal(record.editorial_state, 'review');
  assert.equal(record.accountable_editor, null);
  assert.equal(record.privacy_state, 'review');
  assert.equal(record.rights_state, 'review');
  assert.equal(record.url, 'https://www.thevortexproject.org/dispatches/field-sensor-evidence-boundary/');
  assert.equal(record.approved_sha256, undefined);
});

test('import-review rejects an ID already present in the public catalog without changing queue state', async () => {
  const {root, queue, repo} = await fixture();
  const input = await writeInput(root, candidate());
  const enqueued = JSON.parse(run(['enqueue', `--input=${input}`, '--origin=chat'], {queue, repo}).stdout);
  const publicationId = enqueued.id.replace(/^candidate-/, 'dispatch-');
  await writeFile(join(repo, 'institute-src', '_data', 'editorial.json'), `${JSON.stringify({schema_version: 1, publications: [{
    id: publicationId,
    revision: 1,
    editorial_state: 'review',
    content_type: 'Open Build',
    stream: 'Open Builds',
    slug: 'existing',
    title: 'Existing',
    summary: 'Existing record',
    generated_at: fixedNow,
    url: 'https://www.thevortexproject.org/dispatches/existing/',
    sources: [],
  }]}, null, 2)}\n`);

  const result = spawnSync('bash', [importer, `--id=${enqueued.id}`], {
    encoding: 'utf8',
    env: {...process.env, VORTEX_INSTITUTE_QUEUE: queue, VORTEX_SITE_REPO: repo, VORTEX_NOW: fixedNow, VORTEX_SITE_LOCK: join(root, 'site.lock')},
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists/i);
  const queued = JSON.parse(await readFile(join(queue, `${enqueued.id}.json`), 'utf8'));
  assert.equal(queued.status, 'queued');
});

test('import-review recovers after catalog write without duplicating the publication', async () => {
  const {root, queue, repo} = await fixture();
  const input = await writeInput(root, candidate());
  const enqueued = JSON.parse(run(['enqueue', `--input=${input}`, '--origin=chat'], {queue, repo}).stdout);
  const environment = {...process.env, VORTEX_INSTITUTE_QUEUE: queue, VORTEX_SITE_REPO: repo, VORTEX_NOW: fixedNow, VORTEX_SITE_LOCK: join(root, 'site.lock')};

  const interrupted = spawnSync('bash', [importer, `--id=${enqueued.id}`], {
    encoding: 'utf8',
    env: {...environment, VORTEX_IMPORT_FAIL_AFTER_CATALOG: '1'},
  });
  assert.notEqual(interrupted.status, 0);
  assert.match(interrupted.stderr, /injected failure/i);
  assert.equal(JSON.parse(await readFile(join(queue, `${enqueued.id}.json`), 'utf8')).status, 'importing');
  assert.equal(JSON.parse(await readFile(join(repo, 'institute-src', '_data', 'editorial.json'), 'utf8')).publications.length, 1);

  const recovered = spawnSync('bash', [importer, `--id=${enqueued.id}`], {encoding: 'utf8', env: environment});
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).status, 'imported');
  assert.equal(JSON.parse(await readFile(join(repo, 'institute-src', '_data', 'editorial.json'), 'utf8')).publications.length, 1);
});

test('import-review rejects post-enqueue mutation and represented-source collisions', async () => {
  const {root, queue, repo} = await fixture();
  const input = await writeInput(root, candidate());
  const enqueued = JSON.parse(run(['enqueue', `--input=${input}`, '--origin=chat'], {queue, repo}).stdout);
  const candidatePath = join(queue, `${enqueued.id}.json`);
  const environment = {...process.env, VORTEX_INSTITUTE_QUEUE: queue, VORTEX_SITE_REPO: repo, VORTEX_NOW: fixedNow, VORTEX_SITE_LOCK: join(root, 'site.lock')};

  await writeFile(candidatePath, `${JSON.stringify({...enqueued, summary: 'Content changed after enqueue.'}, null, 2)}\n`);
  const mutated = spawnSync('bash', [importer, `--id=${enqueued.id}`], {encoding: 'utf8', env: environment});
  assert.notEqual(mutated.status, 0);
  assert.match(mutated.stderr, /content hash does not match/i);

  await writeFile(candidatePath, `${JSON.stringify(enqueued, null, 2)}\n`);
  await writeFile(join(repo, 'institute-src', '_data', 'editorial.json'), `${JSON.stringify({
    schema_version: 1,
    publications: [{id: 'dispatch-other', slug: 'other', sources: enqueued.sources}],
  }, null, 2)}\n`);
  const represented = spawnSync('bash', [importer, `--id=${enqueued.id}`], {encoding: 'utf8', env: environment});
  assert.notEqual(represented.status, 0);
  assert.match(represented.stderr, /already represented/i);
});
