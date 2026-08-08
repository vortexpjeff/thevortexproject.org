#!/usr/bin/env node
import {readFile, rename, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isUtcTimestamp, validateEditorialCatalog} from '../publication-contract.js';

if (process.env.VORTEX_SITE_LOCK_HELD !== '1') {
  throw new Error('assessment recording requires scripts/record-publication-assessment.sh shared-lock wrapper');
}

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));
if (!args.id || !args.input || !isUtcTimestamp(args['checked-at'])) {
  throw new Error('usage: record-publication-assessment.mjs --id=ID --input=ASSESSMENT_JSON --checked-at=UTC_RFC3339_TIMESTAMP');
}

const allowed = new Set(['checked_by', 'claims_basis', 'privacy_basis', 'rights_basis', 'sources']);
const assessmentInput = JSON.parse(await readFile(resolve(args.input), 'utf8'));
const unsupported = Object.keys(assessmentInput).find(key => !allowed.has(key));
if (unsupported) throw new Error(`unsupported assessment input field: ${unsupported}`);

const defaultRepo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const siteRepo = resolve(process.env.VORTEX_SITE_REPO || defaultRepo);
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
    process.exit(0);
  }
  throw new Error(`${record.id} already has a different review assessment; refusing silent replacement`);
}
record.review_assessment = assessment;
validateEditorialCatalog(catalog);
const temporary = `${path}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, {mode: 0o600});
await rename(temporary, path);
console.log(`${record.id} review assessment recorded ${record.review_assessment.checked_at}`);
