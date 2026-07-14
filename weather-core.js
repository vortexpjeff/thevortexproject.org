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

export function precipitationAmountThreshold(units) {
  return units === 'imperial' ? 0.01 : 0.254;
}

export function isCurrentHourlyPeriod(periodStart, currentTime, periodSeconds = 3600) {
  const start = Number(periodStart);
  const current = Number(currentTime);
  return Number.isFinite(start) && Number.isFinite(current) && start <= current && current < start + periodSeconds;
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
        const final = run.at(-1);
        const prior = run.at(-2);
        const interval = prior ? Math.max(1, Number(final.time) - Number(prior.time)) : 3600;
        return {start: run[0].time, end: Number(final.time) + interval, hours: run.length};
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

const WATER_PARAMETERS = {
  '00060': 'discharge',
  '00065': 'gageHeight',
};

const roundTo = (value, digits = 3) => Number(Number(value).toFixed(digits));

export function waterBoundingBox(latitude, longitude, radiusKm = 50) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  const radius = Math.max(1, Number(radiusKm) || 50);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const latDelta = radius / 111.32;
  const longitudeScale = Math.max(0.05, Math.cos(lat * Math.PI / 180));
  const lonDelta = radius / (111.32 * longitudeScale);
  return [
    roundTo(Math.max(-180, lon - lonDelta), 6),
    roundTo(Math.max(-90, lat - latDelta), 6),
    roundTo(Math.min(180, lon + lonDelta), 6),
    roundTo(Math.min(90, lat + latDelta), 6),
  ];
}

export function haversineKm(first, second) {
  const lat1 = Number(first?.latitude);
  const lon1 = Number(first?.longitude);
  const lat2 = Number(second?.latitude);
  const lon2 = Number(second?.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function waterValues(series) {
  const noData = Number(series?.variable?.noDataValue);
  const blocks = Array.isArray(series?.values) ? series.values : [];
  return blocks.flatMap((block) => Array.isArray(block?.value) ? block.value : [])
    .map((row) => ({
      value: Number(row?.value),
      time: row?.dateTime || '',
      qualifiers: Array.isArray(row?.qualifiers) ? row.qualifiers.filter(Boolean) : [],
    }))
    .filter((row) => Number.isFinite(row.value)
      && (!Number.isFinite(noData) || row.value !== noData)
      && Number.isFinite(Date.parse(row.time)))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

export function normalizeWaterSeries(payload, selectedPlace) {
  const seriesList = payload?.value?.timeSeries;
  if (!Array.isArray(seriesList) || !seriesList.length) return null;
  const stations = new Map();

  for (const series of seriesList) {
    const source = series?.sourceInfo || {};
    const code = String(source?.siteCode?.[0]?.value || '').trim();
    const parameterCode = String(series?.variable?.variableCode?.[0]?.value || '').trim();
    const key = WATER_PARAMETERS[parameterCode];
    const latitude = Number(source?.geoLocation?.geogLocation?.latitude);
    const longitude = Number(source?.geoLocation?.geogLocation?.longitude);
    const values = waterValues(series);
    if (!code || !key || !values.length || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    if (!stations.has(code)) {
      stations.set(code, {
        siteCode: code,
        name: String(source.siteName || `USGS station ${code}`).trim(),
        latitude,
        longitude,
        measurements: {},
        url: `https://waterdata.usgs.gov/monitoring-location/USGS-${encodeURIComponent(code)}/`,
      });
    }
    const station = stations.get(code);
    station.measurements[key] = {
      parameterCode,
      description: String(series?.variable?.variableDescription || '').trim(),
      unit: String(series?.variable?.unit?.unitCode || '').trim(),
      values,
      latest: values.at(-1),
    };
  }

  const candidates = [...stations.values()].map((station) => ({
    ...station,
    distanceKm: haversineKm(selectedPlace, station),
  })).filter((station) => Number.isFinite(station.distanceKm));
  candidates.sort((a, b) => a.distanceKm - b.distanceKm || a.siteCode.localeCompare(b.siteCode));
  return candidates[0] || null;
}

export function waterTrend(values) {
  const finite = (Array.isArray(values) ? values : [])
    .map((row) => ({value: Number(row?.value), time: Date.parse(row?.time)}))
    .filter((row) => Number.isFinite(row.value) && Number.isFinite(row.time))
    .sort((a, b) => a.time - b.time);
  if (finite.length < 2) return null;
  const first = finite[0];
  const last = finite.at(-1);
  const hours = (last.time - first.time) / 3600000;
  if (!(hours > 0)) return null;
  const delta = last.value - first.value;
  return {
    direction: Math.abs(delta) < 1e-6 ? 'steady' : delta > 0 ? 'rising' : 'falling',
    delta: roundTo(delta),
    hours: roundTo(hours, 2),
    ratePerHour: roundTo(delta / hours),
  };
}

export function waterSparkline(values, width = 640, height = 140, padding = 8) {
  const finite = (Array.isArray(values) ? values : [])
    .map((row) => ({value: Number(row?.value), time: Date.parse(row?.time)}))
    .filter((row) => Number.isFinite(row.value) && Number.isFinite(row.time))
    .sort((a, b) => a.time - b.time);
  if (!finite.length) return null;
  const minValue = Math.min(...finite.map((row) => row.value));
  const maxValue = Math.max(...finite.map((row) => row.value));
  const minTime = finite[0].time;
  const maxTime = finite.at(-1).time;
  const innerWidth = Math.max(1, Number(width) - padding * 2);
  const innerHeight = Math.max(1, Number(height) - padding * 2);
  const points = finite.map((row, index) => {
    const xRatio = maxTime === minTime ? (finite.length === 1 ? 0.5 : index / (finite.length - 1)) : (row.time - minTime) / (maxTime - minTime);
    const yRatio = maxValue === minValue ? 0.5 : (row.value - minValue) / (maxValue - minValue);
    return [roundTo(padding + xRatio * innerWidth, 2), roundTo(padding + (1 - yRatio) * innerHeight, 2)];
  });
  return {
    points,
    path: points.map(([x, y], index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' '),
    min: minValue,
    max: maxValue,
  };
}
