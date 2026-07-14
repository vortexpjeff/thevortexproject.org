import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aqiCategory,
  findDryWindow,
  findNextPrecipitation,
  geocodeFallbackQueries,
  normalizeHourly,
  strongestGust,
  weatherCode,
  windCardinal,
} from '../weather-core.js';

test('geocodeFallbackQueries preserves the full query before a bounded fallback', () => {
  assert.deepEqual(geocodeFallbackQueries('Paris France'), ['Paris France', 'Paris']);
  assert.deepEqual(geocodeFallbackQueries('San Francisco, CA'), ['San Francisco, CA', 'San Francisco']);
  assert.deepEqual(geocodeFallbackQueries('37876'), ['37876']);
});

test('weatherCode maps clear, fog, rain, snow, and thunderstorm codes', () => {
  assert.equal(weatherCode(0).label, 'Clear sky');
  assert.equal(weatherCode(45).label, 'Fog');
  assert.equal(weatherCode(63).label, 'Moderate rain');
  assert.equal(weatherCode(75).label, 'Heavy snow');
  assert.equal(weatherCode(95).label, 'Thunderstorm');
  assert.equal(weatherCode(999).label, 'Conditions unavailable');
});

test('windCardinal returns sixteen-point compass directions', () => {
  assert.equal(windCardinal(0), 'N');
  assert.equal(windCardinal(90), 'E');
  assert.equal(windCardinal(225), 'SW');
  assert.equal(windCardinal(359), 'N');
  assert.equal(windCardinal(null), '—');
});

test('aqiCategory follows U.S. AQI breakpoints', () => {
  assert.equal(aqiCategory(38).label, 'Good');
  assert.equal(aqiCategory(75).label, 'Moderate');
  assert.equal(aqiCategory(125).label, 'Unhealthy for sensitive groups');
  assert.equal(aqiCategory(175).label, 'Unhealthy');
  assert.equal(aqiCategory(250).label, 'Very unhealthy');
  assert.equal(aqiCategory(350).label, 'Hazardous');
  assert.equal(aqiCategory(undefined).label, 'Unavailable');
});

test('normalizeHourly aligns provider arrays without inventing values', () => {
  const rows = normalizeHourly({
    time: [1000, 4600],
    temperature_2m: [60, 61],
    apparent_temperature: [59, 60],
    precipitation_probability: [10, 55],
    precipitation: [0, 0.03],
    rain: [0, 0.03],
    snowfall: [0, 0],
    weather_code: [1, 61],
    cloud_cover: [20, 90],
    visibility: [16000, 8000],
    wind_speed_10m: [4, 8],
    wind_direction_10m: [180, 210],
    wind_gusts_10m: [7, 18],
    uv_index: [0, 0],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], {
    time: 4600,
    temperature: 61,
    apparentTemperature: 60,
    precipitationProbability: 55,
    precipitation: 0.03,
    rain: 0.03,
    snowfall: 0,
    weatherCode: 61,
    cloudCover: 90,
    visibility: 8000,
    windSpeed: 8,
    windDirection: 210,
    windGust: 18,
    uvIndex: 0,
  });
});

const rows = [
  {time: 1000, precipitationProbability: 10, precipitation: 0, windGust: 7},
  {time: 4600, precipitationProbability: 15, precipitation: 0, windGust: 12},
  {time: 8200, precipitationProbability: 20, precipitation: 0, windGust: 9},
  {time: 11800, precipitationProbability: 55, precipitation: 0.04, windGust: 24},
  {time: 15400, precipitationProbability: 70, precipitation: 0.12, windGust: 19},
  {time: 19000, precipitationProbability: 12, precipitation: 0, windGust: 8},
  {time: 22600, precipitationProbability: 8, precipitation: 0, windGust: 6},
  {time: 26200, precipitationProbability: 5, precipitation: 0, windGust: 7},
  {time: 29800, precipitationProbability: 10, precipitation: 0, windGust: 5},
];

test('findNextPrecipitation returns the first meaningful signal after now', () => {
  const result = findNextPrecipitation(rows, 2000);
  assert.equal(result.time, 11800);
  assert.equal(result.precipitationProbability, 55);
});

test('findDryWindow returns the first qualifying consecutive dry period', () => {
  const result = findDryWindow(rows, 11000, {minimumHours: 3, searchHours: 24});
  assert.equal(result.start, 19000);
  assert.equal(result.end, 29800);
  assert.equal(result.hours, 4);
});

test('strongestGust finds the peak in the requested horizon', () => {
  const result = strongestGust(rows, 2000, 6);
  assert.equal(result.time, 11800);
  assert.equal(result.value, 24);
});
