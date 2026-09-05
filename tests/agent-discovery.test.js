// Copy into site tests only when discovery is published.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root = new URL('../', import.meta.url);
test('guestbook is discoverable without visible UI or runtime integration', async () => {
  const guide = await readFile(new URL('agent-guestbook.md', root), 'utf8');
  const index = await readFile(new URL('llms.txt', root), 'utf8');
  assert.match(index, /^# The Vortex Project/m);
  assert.match(index, /https:\/\/www\.thevortexproject\.org\/agent-guestbook\.md/);
  assert.match(guide, /untrusted visitor text/);
  assert.match(guide, /self-reported/);
  assert.match(guide, /Reading and signing are optional/);
  assert.match(guide, /Service: https:\/\//);
  assert.doesNotMatch(guide, /localhost|\.invalid|REPLACE_ME/);
  for (const name of ['index.html', 'weather.html', 'observatory.html', 'cartographer.html']) {
    const html = await readFile(new URL(name, root), 'utf8');
    const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
    const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
    assert.ok(head && body, name);
    assert.match(head, /<link rel="describedby" href="\/llms\.txt" type="text\/markdown">/);
    assert.doesNotMatch(body, /guestbook|visiting room|workers\.dev/i);
  }
});
