import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {join, relative} from 'node:path';

const ROOT = new URL('../', import.meta.url);
const OUTPUT = new URL('../_site/', import.meta.url);

const legacyFiles = [
  '.nojekyll',
  '.well-known/ai-catalog.json',
  'CNAME',
  'favicon.svg',
  'index.html',
  'site-shell.css',
  'weather.html',
  'weather.css',
  'weather.js',
  'weather-core.js',
  'observatory.html',
  'instrument.css',
  'cartographer.html',
  'cartographer.css',
  'cartographer.js',
  'cartographer-view.js',
  'cartographer-events.js',
  'data/observatory.json',
];

async function bytes(url) {
  return readFile(url);
}

async function allFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await allFiles(path));
    else files.push(path);
  }
  return files;
}

test('build preserves every public legacy surface byte for byte', async () => {
  for (const path of legacyFiles) {
    const source = await bytes(new URL(path, ROOT));
    const built = await bytes(new URL(path, OUTPUT));
    assert.deepEqual(built, source, path);
  }
});

test('all five surfaces expose one synchronized project navigation', async () => {
  for (const path of ['index.html', 'weather.html', 'observatory.html', 'cartographer.html', 'institute/index.html']) {
    const html = await readFile(new URL(path, OUTPUT), 'utf8');
    assert.match(html, /aria-label="Project views"/, path);
    for (const destination of ['Field', 'Weather', 'Observatory', 'Cartographer', 'Institute']) {
      assert.match(html, new RegExp(`>${destination}<`), `${path}: ${destination}`);
    }
  }
});

test('build generates the Institute, Dispatches, feeds, and public publication catalog', async () => {
  const institute = await readFile(new URL('institute/index.html', OUTPUT), 'utf8');
  const archive = await readFile(new URL('dispatches/index.html', OUTPUT), 'utf8');
  const article = await readFile(new URL('dispatches/one-acoustic-pass/index.html', OUTPUT), 'utf8');
  const rss = await readFile(new URL('feeds/dispatches.xml', OUTPUT), 'utf8');
  const jsonFeed = JSON.parse(await readFile(new URL('feeds/dispatches.json', OUTPUT), 'utf8'));
  const catalog = JSON.parse(await readFile(new URL('api/publications.json', OUTPUT), 'utf8'));

  assert.match(institute, /<title>Institute · The Vortex Project<\/title>/);
  assert.match(institute, /aria-current="page">Institute<\/span>/);
  assert.match(institute, /data-editorial-state="fixture"/);
  assert.match(archive, /Dispatch<span>archive/);
  assert.match(article, /One acoustic pass, three listening heads/);
  assert.match(article, /What remains unknown/);
  assert.match(article, /Correction history/);
  assert.doesNotMatch(article, /Editor:/);
  assert.match(rss, /<rss version="2\.0"/);
  assert.doesNotMatch(rss, /<item>/);
  assert.equal(jsonFeed.version, 'https://jsonfeed.org/version/1.1');
  assert.deepEqual(jsonFeed.items, []);
  assert.equal(catalog.schema_version, 1);
  assert.deepEqual(catalog.publications, []);
});

test('build excludes development internals and obvious private-boundary strings', async () => {
  const outputPath = new URL('.', OUTPUT).pathname;
  const paths = (await allFiles(outputPath)).map(path => relative(outputPath, path));
  for (const forbidden of ['package.json', 'package-lock.json', 'tests', 'scripts', 'institute-src']) {
    assert.ok(!paths.some(path => path === forbidden || path.startsWith(`${forbidden}/`)), forbidden);
  }

  for (const path of paths.filter(path => /\.(?:html|css|js|json|xml|md)$/i.test(path))) {
    const text = await readFile(join(outputPath, path), 'utf8');
    assert.doesNotMatch(text, /(?:\/home\/|\/mnt\/|127\.0\.0\.1|localhost|\.git-credentials|birdnet_password)/i, path);
  }
});

test('Pages artifact archive preserves required public dotfiles', async () => {
  const workflow = await readFile(new URL('.github/workflows/deploy-pages.yml', ROOT), 'utf8');
  assert.match(workflow, /Archive Pages artifact including required dotfiles/);
  assert.match(workflow, /--directory _site/);
  assert.match(workflow, /name: github-pages/);
  assert.doesNotMatch(workflow, /actions\/upload-pages-artifact/);
});
