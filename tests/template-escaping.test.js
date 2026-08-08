import test from 'node:test';
import assert from 'node:assert/strict';

import {nunjucksEnvironment} from '../eleventy.config.js';

const hostile = '\"><script>alert(1)</script>&';

test('Eleventy Nunjucks library escapes editorial data in HTML text and attributes', () => {
  const rendered = nunjucksEnvironment.renderString(
    '<meta content="{{ value }}"><h1>{{ value }}</h1>',
    {value: hostile},
  );
  assert.doesNotMatch(rendered, /<script>/);
  assert.match(rendered, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;/);
});

test('Eleventy Nunjucks library escapes editorial data in XML elements', () => {
  const rendered = nunjucksEnvironment.renderString('<title>{{ value }}</title>', {value: hostile});
  assert.equal(rendered, '<title>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;</title>');
});