import test from 'node:test';
import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';

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

productionTest('production build emits empty public machines and deployment records', async () => {
  const catalog = JSON.parse(await text('api/publications.json'));
  const feed = JSON.parse(await text('feeds/dispatches.json'));
  assert.deepEqual(catalog.publications, []);
  assert.deepEqual(feed.items, []);
  assert.match(await text('sitemap.xml'), /<loc>https:\/\/www\.thevortexproject\.org\/institute\/<\/loc>/);
  const manifest = JSON.parse(await text('build-manifest.json'));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.build_mode, 'production');
  assert.ok(manifest.files.length > 20);
  assert.ok(manifest.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
});
