import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const cartographer = await readFile(new URL('../cartographer.js', import.meta.url), 'utf8');
const cartographerHtml = await readFile(new URL('../cartographer.html', import.meta.url), 'utf8');
const weatherCss = await readFile(new URL('../weather.css', import.meta.url), 'utf8');

test('Cartographer is a fixed geographic instrument without a slippy-map runtime', () => {
  assert.doesNotMatch(cartographerHtml, /openlayers|cdn\.jsdelivr\.net\/npm\/ol@|role="application"|id="globalView"|class="ol-/i);
  assert.match(cartographerHtml, /id="orbitalFrame"/);
  assert.match(cartographerHtml, /id="orbitalImage"/);
  assert.match(cartographerHtml, /id="eventMarkerLayer"/);
  assert.match(cartographerHtml, /id="eventLedger"/);
  assert.match(cartographerHtml, /id="eventInspector"/);
  assert.doesNotMatch(cartographer, /new OL\.|window\.ol|EPSG:3857|animate\(/);
  assert.match(cartographer, /buildGibsImageUrl/);
  assert.match(cartographer, /projectToOrbitalFrame/);
});

test('Weather uses the Observatory sans-and-monospace typography system', () => {
  assert.doesNotMatch(weatherCss, /Georgia/i);
  assert.match(weatherCss, /--weather-sans:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif/);
  assert.match(weatherCss, /--weather-mono:ui-monospace,SFMono-Regular,Consolas,monospace/);
});
