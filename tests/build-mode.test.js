import test from 'node:test';
import assert from 'node:assert/strict';

import {resolveBuildMode} from '../build-context.js';

test('build mode defaults to preview and accepts only explicit modes', () => {
  assert.equal(resolveBuildMode(''), 'preview');
  assert.equal(resolveBuildMode('preview'), 'preview');
  assert.equal(resolveBuildMode('production'), 'production');
  assert.throws(() => resolveBuildMode('staging'), /VORTEX_BUILD_MODE/);
});
