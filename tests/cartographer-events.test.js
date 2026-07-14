import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEonetUrls,
  buildEarthquakeUrl,
  dayBounds,
  eventCategoryCounts,
  normalizeEonet,
  normalizeEarthquakes,
  representativePoint,
} from '../cartographer-events.js';

test('dayBounds returns one selected UTC calendar day', () => {
  assert.deepEqual(dayBounds('2026-07-13'), {
    start: '2026-07-13T00:00:00.000Z',
    end: '2026-07-14T00:00:00.000Z',
    date: '2026-07-13',
  });
  assert.equal(dayBounds('not-a-date'), null);
  assert.equal(dayBounds('2026-02-31'), null);
});

test('provider URLs are date-bound and category-specific', () => {
  const earthquake = new URL(buildEarthquakeUrl('2026-07-13'));
  assert.equal(earthquake.origin, 'https://earthquake.usgs.gov');
  assert.equal(earthquake.searchParams.get('starttime'), '2026-07-13T00:00:00.000Z');
  assert.equal(earthquake.searchParams.get('endtime'), '2026-07-14T00:00:00.000Z');
  assert.equal(earthquake.searchParams.get('minmagnitude'), '2.5');

  const eonet = buildEonetUrls('2026-07-13');
  assert.deepEqual(Object.keys(eonet), ['wildfires', 'volcanoes', 'severeStorms', 'landslides', 'seaLakeIce']);
  for (const [category, value] of Object.entries(eonet)) {
    const url = new URL(value);
    assert.equal(url.origin, 'https://eonet.gsfc.nasa.gov');
    assert.equal(url.searchParams.get('category'), category);
    assert.equal(url.searchParams.get('start'), '2026-07-13');
    assert.equal(url.searchParams.get('end'), '2026-07-13');
  }
});

test('normalizeEarthquakes keeps finite point events and provider evidence', () => {
  const result = normalizeEarthquakes({features: [
    {
      id: 'us-test',
      geometry: {type: 'Point', coordinates: [26.9756, 36.5703, 149.786]},
      properties: {mag: 4.1, place: '14 km WSW of Mandraki, Greece', time: 1783899960181, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us-test', status: 'reviewed'},
    },
    {id: 'bad', geometry: null, properties: {mag: 3}},
    {id: 'null-coordinate', geometry: {type: 'Point', coordinates: [null, null]}, properties: {mag: 3, time: 1783899960181}},
    {id: 'null-magnitude', geometry: {type: 'Point', coordinates: [10, 20]}, properties: {mag: null, time: 1783899960181}},
    {id: 'null-time', geometry: {type: 'Point', coordinates: [10, 20]}, properties: {mag: 3, time: null}},
  ]});
  assert.deepEqual(result, [{
    id: 'usgs-us-test',
    provider: 'USGS',
    category: 'earthquake',
    title: 'M 4.1 · 14 km WSW of Mandraki, Greece',
    time: '2026-07-12T23:46:00.181Z',
    coordinates: [26.9756, 36.5703],
    magnitude: 4.1,
    depthKm: 149.786,
    status: 'reviewed',
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us-test',
  }]);
});

test('normalizeEarthquakes enforces a half-open selected day and safe USGS links', () => {
  const at = (id, time, url) => ({
    id,
    geometry: {type: 'Point', coordinates: [10, 20, 5]},
    properties: {mag: 3.2, place: id, time, url},
  });
  const result = normalizeEarthquakes({features: [
    at('start', Date.parse('2026-07-12T00:00:00.000Z'), 'https://earthquake.usgs.gov/earthquakes/eventpage/start'),
    at('last', Date.parse('2026-07-12T23:59:59.999Z'), 'javascript:alert(1)'),
    at('next-midnight', Date.parse('2026-07-13T00:00:00.000Z'), 'https://earthquake.usgs.gov/earthquakes/eventpage/next'),
  ]}, '2026-07-12');
  assert.deepEqual(result.map((event) => event.id), ['usgs-start', 'usgs-last']);
  assert.equal(result[0].url, 'https://earthquake.usgs.gov/earthquakes/eventpage/start');
  assert.equal(result[1].url, 'https://earthquake.usgs.gov/earthquakes/');
});

test('representativePoint supports Point, Polygon, and MultiPolygon geometry', () => {
  assert.deepEqual(representativePoint({type: 'Point', coordinates: [-80, 30]}), [-80, 30]);
  assert.deepEqual(representativePoint({type: 'Polygon', coordinates: [[[-82, 35], [-80, 35], [-80, 37], [-82, 37], [-82, 35]]]}), [-81, 36]);
  assert.deepEqual(representativePoint({type: 'MultiPolygon', coordinates: [[[[-82, 35], [-80, 35], [-80, 37], [-82, 37], [-82, 35]]]]}), [-81, 36]);
  assert.equal(representativePoint({type: 'Point', coordinates: ['x', 30]}), null);
  assert.equal(representativePoint({type: 'Point', coordinates: [null, null]}), null);
});

test('normalizeEonet filters prescribed burns, decodes titles, chooses date-nearest geometry, and deduplicates', () => {
  const payload = {events: [
    {
      id: 'EONET_1', title: 'Wildfire Cedar &amp; Stone', closed: null,
      categories: [{id: 'wildfires', title: 'Wildfires'}],
      sources: [{id: 'InciWeb', url: 'https://example.test/cedar'}],
      geometry: [
        {date: '2026-07-12T10:00:00Z', type: 'Point', coordinates: [-111, 40]},
        {date: '2026-07-13T14:00:00Z', type: 'Point', coordinates: [-110, 41]},
      ],
    },
    {
      id: 'EONET_2', title: 'Cedar &amp; Stone Wildfire', closed: null,
      categories: [{id: 'wildfires', title: 'Wildfires'}],
      sources: [{id: 'NIFC', url: 'https://example.test/duplicate'}],
      geometry: [{date: '2026-07-13T15:00:00Z', type: 'Point', coordinates: [-110.01, 41.01]}],
    },
    {
      id: 'EONET_3', title: 'Prescribed Fire RX Training Unit', closed: null,
      categories: [{id: 'wildfires', title: 'Wildfires'}],
      geometry: [{date: '2026-07-13T16:00:00Z', type: 'Point', coordinates: [-90, 35]}],
    },
  ]};
  const result = normalizeEonet(payload, '2026-07-13', 'wildfires');
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Wildfire Cedar & Stone');
  assert.deepEqual(result[0].coordinates, [-110, 41]);
  assert.equal(result[0].provider, 'NASA EONET');
  assert.equal(result[0].category, 'wildfires');
  assert.equal(result[0].url, 'https://example.test/cedar');
  assert.equal(result[0].time, '2026-07-13T14:00:00.000Z');
});

test('normalizeEonet caps one category and eventCategoryCounts summarizes the merged set', () => {
  const payload = {events: Array.from({length: 12}, (_, index) => ({
    id: `storm-${index}`,
    title: `Storm ${index}`,
    categories: [{id: 'severeStorms', title: 'Severe Storms'}],
    geometry: [{date: `2026-07-13T${String(index).padStart(2, '0')}:00:00Z`, type: 'Point', coordinates: [index, index]}],
  }))};
  const storms = normalizeEonet(payload, '2026-07-13', 'severeStorms', 5);
  assert.equal(storms.length, 5);
  assert.deepEqual(eventCategoryCounts([...storms, {category: 'earthquake'}]), {earthquake: 1, severeStorms: 5});
});
