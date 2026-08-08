#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {validateCatalogTransition} from '../transition-contract.js';

const base = process.argv[2] || process.env.VORTEX_TRANSITION_BASE || 'origin/main';
const path = 'institute-src/_data/editorial.json';
let before = {schema_version: 1, publications: []};
const historical = spawnSync('git', ['show', `${base}:${path}`], {encoding: 'utf8'});
if (historical.status === 0) {
  before = JSON.parse(historical.stdout);
} else if (!/does not exist|exists on disk, but not in|invalid object name|unknown revision/i.test(historical.stderr || '')) {
  throw new Error(`cannot read publication transition base ${base}: ${historical.stderr || 'git show failed'}`);
}
const after = JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
validateCatalogTransition(before, after);
console.log(`publication transition valid from ${base}`);
