import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBlueMarbleUrl,
  buildGibsImageUrl,
  imageDimensions,
  productForDate,
  projectToOrbitalFrame,
} from '../cartographer-view.js';

test('productForDate selects the strongest available true-color record', () => {
  assert.equal(productForDate('2026-07-12').id, 'VIIRS_NOAA20_CorrectedReflectance_TrueColor');
  assert.equal(productForDate('2018-01-05').instrument, 'VIIRS');
  assert.equal(productForDate('2016-05-01').id, 'VIIRS_SNPP_CorrectedReflectance_TrueColor');
  assert.equal(productForDate('2010-05-01').id, 'MODIS_Aqua_CorrectedReflectance_TrueColor');
  assert.equal(productForDate('2001-05-01').id, 'MODIS_Terra_CorrectedReflectance_TrueColor');
  assert.equal(productForDate('1999-12-31'), null);
});

test('imageDimensions preserve the latitude-cropped geographic frame', () => {
  assert.deepEqual(imageDimensions(1440), {width: 1440, height: 624});
  assert.deepEqual(imageDimensions(781), {width: 781, height: 338});
  assert.deepEqual(imageDimensions(99999), {width: 2048, height: 887});
});

test('buildGibsImageUrl requests one fixed EPSG:4326 WMS image', () => {
  const url = new URL(buildGibsImageUrl('2026-07-12', 1440));
  assert.equal(url.origin, 'https://gibs.earthdata.nasa.gov');
  assert.equal(url.pathname, '/wms/epsg4326/best/wms.cgi');
  assert.equal(url.searchParams.get('SERVICE'), 'WMS');
  assert.equal(url.searchParams.get('REQUEST'), 'GetMap');
  assert.equal(url.searchParams.get('VERSION'), '1.3.0');
  assert.equal(url.searchParams.get('CRS'), 'EPSG:4326');
  assert.equal(url.searchParams.get('BBOX'), '-66,-180,90,180');
  assert.equal(url.searchParams.get('WIDTH'), '1440');
  assert.equal(url.searchParams.get('HEIGHT'), '624');
  assert.equal(url.searchParams.get('TIME'), '2026-07-12');
  assert.equal(url.searchParams.get('LAYERS'), 'VIIRS_NOAA20_CorrectedReflectance_TrueColor');
});

test('Blue Marble fallback is explicitly timeless', () => {
  const url = new URL(buildBlueMarbleUrl(720));
  assert.equal(url.searchParams.get('LAYERS'), 'BlueMarble_NextGeneration');
  assert.equal(url.searchParams.has('TIME'), false);
});

test('projectToOrbitalFrame maps geographic coordinates to percentages and clips the far south', () => {
  assert.deepEqual(projectToOrbitalFrame([0, 12]), {x: 50, y: 50});
  assert.deepEqual(projectToOrbitalFrame([-180, 90]), {x: 0, y: 0});
  assert.deepEqual(projectToOrbitalFrame([180, -66]), {x: 100, y: 100});
  assert.equal(projectToOrbitalFrame([0, -66.01]), null);
  assert.equal(projectToOrbitalFrame([181, 0]), null);
  assert.equal(projectToOrbitalFrame([null, 0]), null);
});
