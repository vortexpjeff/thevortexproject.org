import test from 'node:test';
import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import {publicationsForPublicOutput} from '../publication-contract.js';

const OUTPUT = new URL('../_site/', import.meta.url);
const productionTest = process.env.VORTEX_BUILD_MODE === 'production' ? test : test.skip;

async function text(path) { return readFile(new URL(path, OUTPUT), 'utf8'); }

async function missing(path) {
  try { await access(new URL(path, OUTPUT)); return false; } catch { return true; }
}

productionTest('production build excludes preview state and fixture article', async () => {
  const institute = await text('institute/index.html');
  const archive = await text('dispatches/index.html');
  assert.doesNotMatch(institute, /build fixture|not published/i);
  assert.doesNotMatch(archive, /fixture records/i);
  assert.match(institute, /Independent research from Pine Hollow/);
  assert.equal(await missing('dispatches/one-acoustic-pass/index.html'), true);
});

productionTest('production build emits the exact public catalog, feeds, sitemap, and deployment records', async () => {
  const catalog = JSON.parse(await text('api/publications.json'));
  const feed = JSON.parse(await text('feeds/dispatches.json'));
  const source = JSON.parse(await readFile(new URL('../institute-src/_data/editorial.json', import.meta.url), 'utf8'));
  const expected = publicationsForPublicOutput(source);
  assert.deepEqual(catalog.publications, expected);
  assert.equal(feed.items.length, expected.length);
  const sitemap = await text('sitemap.xml');
  assert.match(sitemap, /<loc>https:\/\/www\.thevortexproject\.org\/institute\/<\/loc>/);
  for (const record of expected) {
    assert.equal(await missing(`dispatches/${record.slug}/index.html`), false, record.slug);
    assert.ok(feed.items.some(item => item.url === record.url), record.url);
    assert.ok(sitemap.includes(record.url), record.url);
  }
  assert.doesNotMatch(JSON.stringify(catalog), /accountable_editor|publication_approval|review_assessment|privacy_clearance|rights_clearance|"editor"|"reviewer"/);
  const manifest = JSON.parse(await text('build-manifest.json'));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.build_mode, 'production');
  assert.ok(manifest.files.length > 20);
  assert.ok(manifest.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
});
