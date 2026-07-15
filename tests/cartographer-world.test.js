import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const cartographer = await readFile(new URL('../cartographer.js', import.meta.url), 'utf8');
const weatherCss = await readFile(new URL('../weather.css', import.meta.url), 'utf8');

test('Cartographer stays inside one non-repeating world', () => {
  assert.match(cartographer, /const WORLD_EXTENT = OL\?\.proj\.get\('EPSG:3857'\)\.getExtent\(\);/);
  assert.equal((cartographer.match(/wrapX: false/g) || []).length, 4);
  assert.doesNotMatch(cartographer, /wrapX: true|multiWorld: true/);
  assert.match(cartographer, /extent: WORLD_EXTENT,[\s\S]*showFullExtent: true,[\s\S]*multiWorld: false,/);
  assert.match(cartographer, /if \(x < 0 \|\| x >= n \|\| y < 0 \|\| y >= southCoverageRow\(z\)\) return undefined;/);
  assert.match(cartographer, /\$\{z\}\/\$\{y\}\/\$\{x\}\.jpeg/);
});

test('Weather uses the Observatory sans-and-monospace typography system', () => {
  assert.doesNotMatch(weatherCss, /Georgia/i);
  assert.match(weatherCss, /--weather-sans:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif/);
  assert.match(weatherCss, /--weather-mono:ui-monospace,SFMono-Regular,Consolas,monospace/);
});
