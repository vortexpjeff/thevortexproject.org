#!/usr/bin/env node
import {readFile, rename, writeFile} from 'node:fs/promises';
import {isUtcTimestamp, publicationRevisionHash, validateEditorialCatalog} from '../publication-contract.js';

if (process.env.VORTEX_SITE_LOCK_HELD !== '1') {
  throw new Error('promotion requires scripts/promote-publication.sh shared-lock wrapper');
}

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));
if (!args.id || !['approved', 'released'].includes(args.to) || !args.editor || !/^[a-f0-9]{64}$/.test(args['expected-sha256'] || '')) {
  throw new Error('usage: promote-publication.mjs --id=ID --to=approved|released --editor=NAME --expected-sha256=HASH');
}
const path = new URL('../institute-src/_data/editorial.json', import.meta.url);
const catalog = JSON.parse(await readFile(path, 'utf8'));
const record = catalog.publications.find(item => item.id === args.id);
if (!record) throw new Error(`publication not found: ${args.id}`);
const requiredFrom = args.to === 'approved' ? 'review' : 'approved';
if (record.editorial_state !== requiredFrom) throw new Error(`${record.id} must be ${requiredFrom} before promotion to ${args.to}`);
if (record.privacy_state !== 'public-cleared' || record.rights_state !== 'public-cleared') {
  throw new Error(`${record.id} requires independent privacy and rights clearance before promotion`);
}
const currentHash = publicationRevisionHash(record);
if (currentHash !== args['expected-sha256']) throw new Error(`stale publication revision: expected ${args['expected-sha256']} got ${currentHash}`);
if (args.to === 'released' && record.accountable_editor !== args.editor) {
  throw new Error(`${record.id} release editor must match the accountable approving editor`);
}
const approvalHash = record.approved_sha256;
record.editorial_state = args.to;
if (args.to === 'approved') record.accountable_editor = args.editor;
if (args.to === 'released') {
  if (!isUtcTimestamp(args['published-at'])) throw new Error('released promotion requires --published-at=UTC_RFC3339_TIMESTAMP');
  record.published_at = args['published-at'];
  record.approval_sha256 = approvalHash;
}
record.approved_sha256 = publicationRevisionHash(record);
validateEditorialCatalog(catalog);
const temporary = new URL(`../institute-src/_data/editorial.json.${process.pid}.tmp`, import.meta.url);
await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, {mode: 0o600});
await rename(temporary, path);
console.log(`${record.id} ${record.editorial_state} ${record.approved_sha256}`);
