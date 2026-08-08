#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {closeSync, mkdirSync, openSync, readFileSync, realpathSync} from 'node:fs';
import {readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isUtcTimestamp, validateEditorialCatalog} from '../publication-contract.js';

const workerFlag = '--internal-flock-worker';
const isWorker = process.argv[2] === workerFlag;
const cliArgs = process.argv.slice(isWorker ? 3 : 2);
const args = Object.fromEntries(cliArgs.map(value => {
  if (!value.startsWith('--')) throw new Error(`unsupported argument: ${value}`);
  const [key, ...rest] = value.slice(2).split('=');
  return [key, rest.join('=')];
}));
if (!args.id || !args.input || !isUtcTimestamp(args['checked-at'])) {
  throw new Error('usage: record-publication-assessment.mjs --id=ID --input=ASSESSMENT_JSON --checked-at=UTC_RFC3339_TIMESTAMP');
}

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
    throw new Error('assessment worker requires a live flock parent');
  }
  if (parentCommand !== 'flock' || !parentArgs.includes(realpathSync(lockPath)) || !parentArgs.includes(scriptPath)) {
    throw new Error('assessment worker is not owned by the configured shared flock');
  }
}

function runUnderSharedLock() {
  mkdirSync(dirname(lockPath), {recursive: true, mode: 0o700});
  closeSync(openSync(lockPath, 'a', 0o600));
  const timeout = process.env.VORTEX_SITE_LOCK_TIMEOUT || '600';
  if (!/^\d+$/.test(timeout)) throw new Error('VORTEX_SITE_LOCK_TIMEOUT must be whole seconds');
  const result = spawnSync('flock', ['-w', timeout, realpathSync(lockPath), process.execPath, scriptPath, workerFlag, ...cliArgs], {
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

function requireCleanGitState() {
  const repositoryCheck = spawnSync('git', ['-C', siteRepo, 'rev-parse', '--git-dir'], {encoding: 'utf8'});
  if (repositoryCheck.status !== 0) return;
  if (gitOutput(['diff', '--cached', '--name-only'])) throw new Error('refusing assessment recording: Git index is not empty');
  if (gitOutput(['status', '--porcelain', '--untracked-files=no'])) {
    throw new Error('refusing assessment recording: tracked working tree is not clean');
  }
}

async function recordAssessment() {
  verifyFlockParent();
  requireCleanGitState();
  const allowed = new Set(['checked_by', 'claims_basis', 'privacy_basis', 'rights_basis', 'sources']);
  const assessmentInput = JSON.parse(await readFile(resolve(args.input), 'utf8'));
  const unsupported = Object.keys(assessmentInput).find(key => !allowed.has(key));
  if (unsupported) throw new Error(`unsupported assessment input field: ${unsupported}`);

  const path = join(siteRepo, 'institute-src', '_data', 'editorial.json');
  const catalog = JSON.parse(await readFile(path, 'utf8'));
  const record = catalog.publications.find(item => item.id === args.id);
  if (!record) throw new Error(`publication not found: ${args.id}`);
  if (record.editorial_state !== 'review') throw new Error(`${record.id} must be review before assessment recording`);
  const assessment = {
    state: 'checks-passed',
    checked_at: args['checked-at'],
    checked_by: assessmentInput.checked_by,
    claims_basis: assessmentInput.claims_basis,
    privacy_basis: assessmentInput.privacy_basis,
    rights_basis: assessmentInput.rights_basis,
    sources: assessmentInput.sources,
  };
  if (record.review_assessment) {
    if (JSON.stringify(record.review_assessment) === JSON.stringify(assessment)) {
      console.log(`${record.id} review assessment already recorded ${record.review_assessment.checked_at}`);
      return;
    }
    throw new Error(`${record.id} already has a different review assessment; refusing silent replacement`);
  }
  record.review_assessment = assessment;
  validateEditorialCatalog(catalog);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, {mode: 0o600});
  await rename(temporary, path);
  console.log(`${record.id} review assessment recorded ${record.review_assessment.checked_at}`);
}

if (isWorker) await recordAssessment();
else runUnderSharedLock();
