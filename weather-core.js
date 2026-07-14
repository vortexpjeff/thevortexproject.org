const WEATHER_CODES = new Map([
  [0, ['Clear sky', 'clear']],
  [1, ['Mostly clear', 'mostly-clear']],
  [2, ['Partly cloudy', 'partly-cloudy']],
  [3, ['Overcast', 'cloudy']],
  [45, ['Fog', 'fog']],
  [48, ['Depositing rime fog', 'fog']],
  [51, ['Light drizzle', 'drizzle']],
  [53, ['Moderate drizzle', 'drizzle']],
  [55, ['Dense drizzle', 'drizzle']],
  [56, ['Light freezing drizzle', 'freezing']],
  [57, ['Dense freezing drizzle', 'freezing']],
  [61, ['Light rain', 'rain']],
  [63, ['Moderate rain', 'rain']],
  [65, ['Heavy rain', 'heavy-rain']],
  [66, ['Light freezing rain', 'freezing']],
  [67, ['Heavy freezing rain', 'freezing']],
  [71, ['Light snow', 'snow']],
  [73, ['Moderate snow', 'snow']],
  [75, ['Heavy snow', 'heavy-snow']],
  [77, ['Snow grains', 'snow']],
  [80, ['Light rain showers', 'showers']],
  [81, ['Moderate rain showers', 'showers']],
  [82, ['Violent rain showers', 'heavy-rain']],
  [85, ['Light snow showers', 'snow']],
  [86, ['Heavy snow showers', 'heavy-snow']],
  [95, ['Thunderstorm', 'storm']],
  [96, ['Thunderstorm with light hail', 'storm']],
  [99, ['Thunderstorm with heavy hail', 'storm']],
]);

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

const AQI_CATEGORIES = [
  {maximum: 50, label: 'Good', key: 'good'},
  {maximum: 100, label: 'Moderate', key: 'moderate'},
  {maximum: 150, label: 'Unhealthy for sensitive groups', key: 'sensitive'},
  {maximum: 200, label: 'Unhealthy', key: 'unhealthy'},
  {maximum: 300, label: 'Very unhealthy', key: 'very-unhealthy'},
  {maximum: Infinity, label: 'Hazardous', key: 'hazardous'},
];

export function weatherCode(code) {
  const value = WEATHER_CODES.get(Number(code));
  return value
    ? {code: Number(code), label: value[0], key: value[1]}
    : {code: Number.isFinite(Number(code)) ? Number(code) : null, label: 'Conditions unavailable', key: 'unknown'};
}

export function windCardinal(degrees) {
  if (degrees === null || degrees === undefined || !Number.isFinite(Number(degrees))) return '—';
  const normalized = ((Number(degrees) % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 22.5) % 16];
}

export function aqiCategory(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return {label: 'Unavailable', key: 'unavailable', maximum: null};
  }
  const numeric = Number(value);
  const match = AQI_CATEGORIES.find((category) => numeric <= category.maximum);
  return {...match, value: numeric};
}

export function geocodeFallbackQueries(query) {
  const cleaned = String(query || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return [];
  if (/^\d+$/.test(cleaned)) return [cleaned];
  const commaBase = cleaned.includes(',') ? cleaned.split(',')[0].trim() : '';
  const words = cleaned.split(' ');
  const wordBase = words.length > 1 ? words.slice(0, -1).join(' ').replace(/,$/, '').trim() : '';
  const fallback = commaBase || wordBase;
  return fallback && fallback !== cleaned ? [cleaned, fallback] : [cleaned];
}

function at(values, index) {
  return Array.isArray(values) && index < values.length ? values[index] : null;
}

export function normalizeHourly(hourly = {}) {
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  return times.map((time, index) => ({
    time,
    temperature: at(hourly.temperature_2m, index),
    apparentTemperature: at(hourly.apparent_temperature, index),
    precipitationProbability: at(hourly.precipitation_probability, index),
    precipitation: at(hourly.precipitation, index),
    rain: at(hourly.rain, index),
    snowfall: at(hourly.snowfall, index),
    weatherCode: at(hourly.weather_code, index),
    cloudCover: at(hourly.cloud_cover, index),
    visibility: at(hourly.visibility, index),
    windSpeed: at(hourly.wind_speed_10m, index),
    windDirection: at(hourly.wind_direction_10m, index),
    windGust: at(hourly.wind_gusts_10m, index),
    uvIndex: at(hourly.uv_index, index),
  }));
}

function inWindow(row, now, hours) {
  const limit = now + hours * 3600;
  return Number(row.time) >= now && Number(row.time) <= limit;
}

export function findNextPrecipitation(rows, now, {searchHours = 48, probabilityThreshold = 35, amountThreshold = 0.01} = {}) {
  return rows.find((row) => {
    if (!inWindow(row, now, searchHours)) return false;
    const probability = Number(row.precipitationProbability) || 0;
    const amount = Number(row.precipitation) || 0;
    return probability >= probabilityThreshold || amount >= amountThreshold;
  }) || null;
}

export function findDryWindow(rows, now, {minimumHours = 3, searchHours = 36, probabilityMaximum = 25, amountMaximum = 0.01} = {}) {
  const candidates = rows.filter((row) => inWindow(row, now, searchHours));
  let run = [];

  for (const row of candidates) {
    const probability = Number(row.precipitationProbability) || 0;
    const amount = Number(row.precipitation) || 0;
    const dry = probability < probabilityMaximum && amount <= amountMaximum;

    if (dry) {
      if (run.length && Number(row.time) - Number(run.at(-1).time) > 5400) run = [];
      run.push(row);
      if (run.length >= minimumHours) {
        let endIndex = candidates.indexOf(row) + 1;
        while (endIndex < candidates.length) {
          const next = candidates[endIndex];
          const nextProbability = Number(next.precipitationProbability) || 0;
          const nextAmount = Number(next.precipitation) || 0;
          if (nextProbability >= probabilityMaximum || nextAmount > amountMaximum) break;
          run.push(next);
          endIndex += 1;
        }
        return {start: run[0].time, end: run.at(-1).time, hours: run.length};
      }
    } else {
      run = [];
    }
  }

  return null;
}

export function strongestGust(rows, now, hours = 24) {
  const candidates = rows.filter((row) => inWindow(row, now, hours) && Number.isFinite(Number(row.windGust)));
  if (!candidates.length) return null;
  const peak = candidates.reduce((best, row) => Number(row.windGust) > Number(best.windGust) ? row : best);
  return {time: peak.time, value: Number(peak.windGust)};
}
