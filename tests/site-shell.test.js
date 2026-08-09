import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const pageNames = ['index.html', 'weather.html', 'observatory.html', 'cartographer.html'];
const pages = await Promise.all(pageNames.map(name => readFile(new URL(name, root), 'utf8')));
const shellCss = await readFile(new URL('site-shell.css', root), 'utf8');

test('the shared shell has no Institute link and suppresses stale retired links', () => {
  for (const [index, html] of pages.entries()) {
    assert.doesNotMatch(html, /href=["']\/(?:institute|dispatches)(?:\/|["'])/i, `${pageNames[index]} contains a retired Institute link`);
  }
  assert.match(shellCss, /a\[href="\/institute\/"\].*display:none!important/);
  assert.match(shellCss, /a\[href\^="\/dispatches\/"\].*display:none!important/);
});
