#!/usr/bin/env node
import {closeSync, mkdirSync, openSync, readFileSync, realpathSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  atomicJson,
  candidateContentHash,
  candidateFingerprint,
  loadAll,
  loadById,
  now,
  queueDir,
  sharesPrimarySource,
  validateInput,
  withQueueLock,
} from './dispatch-candidate-controller.mjs';
import {publicationRevisionHash} from '../publication-contract.js';
import {validateCatalogTransition} from '../transition-contract.js';

const workerFlag = '--internal-flock-worker';
const isWorker = process.argv[2] === workerFlag;
const cliArgs = process.argv.slice(isWorker ? 3 : 2);
const args = Object.fromEntries(cliArgs.map(value => {
  if (!value.startsWith('--')) throw new Error(`unsupported argument: ${value}`);
  const [key, ...rest] = value.slice(2).split('=');
  return [key, rest.join('=')];
}));
const id = args.id;
if (!/^candidate-[a-z0-9-]+$/.test(id || '')) throw new Error('candidate import requires --id=CANDIDATE_ID');

const defaultRepo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const siteRepo = resolve(process.env.VORTEX_SITE_REPO || defaultRepo);
const scriptPath = fileURLToPath(import.meta.url);
const lockPath = resolve(process.env.VORTEX_SITE_LOCK || join(process.env.HOME, '.cache', 'vortex-site', 'git.lock'));

function verifyFlockParent() {
  let parentCommand;
  let parentArgs;
  try {
    parentCommand = readFileSync(`/proc/${process.ppid}/comm`, 'utf8').trim();
    parentArgs = readFileSync(`/proc/${process.ppid}/cmdline`).toString('utf8').split('\0').filter(Boolean);
  } catch {
    throw new Error('candidate import worker requires a live flock parent');
  }
  if (parentCommand !== 'flock' || !parentArgs.includes(realpathSync(lockPath)) || !parentArgs.includes(scriptPath)) {
    throw new Error('candidate import worker is not owned by the configured shared flock');
  }
}

function runUnderSharedLock() {
  mkdirSync(dirname(lockPath), {recursive: true, mode: 0o700});
  closeSync(openSync(lockPath, 'a', 0o600));
  const timeout = process.env.VORTEX_SITE_LOCK_TIMEOUT || '600';
  if (!/^\d+$/.test(timeout)) throw new Error('VORTEX_SITE_LOCK_TIMEOUT must be whole seconds');
  const canonicalLockPath = realpathSync(lockPath);
  const result = spawnSync('flock', ['-w', timeout, canonicalLockPath, process.execPath, scriptPath, workerFlag, ...cliArgs], {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function gitOutput(parameters) {
  const result = spawnSync('git', ['-C', siteRepo, ...parameters], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${parameters.join(' ')} failed`);
  return result.stdout.trimEnd();
}

function requireImportGitState(candidate) {
  const repositoryCheck = spawnSync('git', ['-C', siteRepo, 'rev-parse', '--git-dir'], {encoding: 'utf8'});
  if (repositoryCheck.status !== 0) return;
  if (gitOutput(['diff', '--cached', '--name-only'])) throw new Error('refusing candidate import: Git index is not empty');
  const dirty = gitOutput(['status', '--porcelain', '--untracked-files=no']);
  if (!dirty) return;
  if (dirty === ' M institute-src/_data/editorial.json' && candidate.status === 'importing') return;
  throw new Error('refusing candidate import: tracked working tree is not clean');
}

function proposal(candidate) {
  return validateInput({
    schema_version: candidate.schema_version,
    topic: candidate.topic,
    title: candidate.title,
    summary: candidate.summary,
    content_type: candidate.content_type,
    stream: candidate.stream,
    related_program: candidate.related_program,
    evidence_level: candidate.evidence_level,
    evidence_state: candidate.evidence_state,
    slug: candidate.slug,
    sections: candidate.sections,
    sources: candidate.sources,
    ai_assistance: candidate.ai_assistance,
  });
}

function toReviewRecord(candidate, checked = proposal(candidate)) {
  return {
    id: candidate.id.replace(/^candidate-/, 'dispatch-'),
    revision: 1,
    editorial_state: 'review',
    content_type: checked.content_type,
    stream: checked.stream,
    slug: checked.slug,
    title: checked.title,
    summary: checked.summary,
    related_program: checked.related_program,
    evidence_level: checked.evidence_level,
    evidence_state: checked.evidence_state,
    privacy_state: 'review',
    rights_state: 'review',
    correction_state: 'none',
    accountable_editor: null,
    ai_assistance: checked.ai_assistance,
    generated_at: candidate.created_at,
    url: `https://www.thevortexproject.org/dispatches/${checked.slug}/`,
    sections: checked.sections,
    sources: checked.sources,
    corrections: [],
  };
}

async function importReview() {
  verifyFlockParent();
  return withQueueLock(async () => {
    const candidate = await loadById(id);
    if (candidate.id !== id) throw new Error('candidate record ID does not match its filename');
    if (!['queued', 'importing'].includes(candidate.status)) throw new Error(`${id} is ${candidate.status}, not queued or importing`);
    requireImportGitState(candidate);
    const checked = proposal(candidate);
    const fingerprintVersion = candidate.fingerprint_version ?? 0;
    const expectedFingerprint = candidateFingerprint(checked, fingerprintVersion);
    if (candidate.fingerprint_sha256 !== expectedFingerprint) throw new Error('candidate fingerprint does not match current content');
    if (candidate.content_sha256 !== candidateContentHash(checked)) throw new Error('candidate content hash does not match current content');
    const expectedId = `candidate-${candidate.created_at.slice(0, 10).replaceAll('-', '')}-${checked.slug}-${expectedFingerprint.slice(0, 10)}`;
    if (candidate.id !== expectedId) throw new Error('candidate ID does not match current content');
    const queuedDuplicate = (await loadAll()).find(item => item.id !== candidate.id
      && (item.fingerprint_sha256 === expectedFingerprint || sharesPrimarySource(item, checked)));
    if (queuedDuplicate) throw new Error(`candidate duplicates queued source ${queuedDuplicate.id}`);
    const catalogPath = join(siteRepo, 'institute-src', '_data', 'editorial.json');
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    const record = toReviewRecord(candidate, checked);
    const existing = catalog.publications.find(item => item.id === record.id || item.slug === record.slug);
    const representedSource = catalog.publications.find(item => item.id !== record.id && sharesPrimarySource(item, checked));
    if (representedSource) throw new Error(`primary source is already represented in the Institute catalog by ${representedSource.id}`);
    if (existing) {
      if (candidate.status !== 'importing' || existing.id !== record.id
          || publicationRevisionHash(existing) !== publicationRevisionHash(record)) {
        throw new Error(`publication already exists for ${record.id}`);
      }
      const recovered = {
        ...candidate,
        status: 'imported',
        decision: {...candidate.decision, state: 'imported-to-review', decided_at: now(), publication_id: record.id},
      };
      await atomicJson(join(queueDir, `${id}.json`), recovered);
      return recovered;
    }
    const nextCatalog = {...catalog, publications: [...catalog.publications, record]};
    validateCatalogTransition(catalog, nextCatalog);
    const importingCandidate = {
      ...candidate,
      status: 'importing',
      decision: {state: 'importing-review', started_at: candidate.decision?.started_at || now(), publication_id: record.id},
    };
    await atomicJson(join(queueDir, `${id}.json`), importingCandidate);
    await atomicJson(catalogPath, nextCatalog);
    if (process.env.VORTEX_IMPORT_FAIL_AFTER_CATALOG === '1') throw new Error('injected failure after catalog write');
    const importedCandidate = {
      ...importingCandidate,
      status: 'imported',
      decision: {...importingCandidate.decision, state: 'imported-to-review', decided_at: now()},
    };
    await atomicJson(join(queueDir, `${id}.json`), importedCandidate);
    return importedCandidate;
  });
}

if (isWorker) {
  importReview()
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
} else {
  try { runUnderSharedLock(); }
  catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
