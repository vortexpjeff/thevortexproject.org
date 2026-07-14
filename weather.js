import {
  aqiCategory,
  findDryWindow,
  findNextPrecipitation,
  geocodeFallbackQueries,
  isCurrentHourlyPeriod,
  normalizeHourly,
  normalizeWaterSeries,
  precipitationAmountThreshold,
  strongestGust,
  waterBoundingBox,
  waterSparkline,
  waterTrend,
  weatherCode,
  windCardinal,
} from './weather-core.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active';
const USGS_WATER_URL = 'https://waterservices.usgs.gov/nwis/iv/';
const RECENT_KEY = 'vortex-weather-recent-v1';
const UNIT_KEY = 'vortex-weather-units-v1';
const glyphs = {
  clear: '☉', 'mostly-clear': '◐', 'partly-cloudy': '◒', cloudy: '●', fog: '≋', drizzle: '╎',
  rain: '╱', 'heavy-rain': '╱', showers: '╱', freezing: '◇', snow: '✣', 'heavy-snow': '✣', storm: 'ϟ', unknown: '·',
};

const $ = (selector) => document.querySelector(selector);
const dom = {
  form: $('#placeForm'), input: $('#placeSearch'), results: $('#placeResults'), locate: $('#locateButton'), units: $('#unitButton'),
  recents: $('#recentPlaces'), status: $('#weatherStatus'), empty: $('#weatherEmpty'), content: $('#weatherContent'),
  alertSection: $('#alertSection'), currentSection: $('#currentSection'), alertCoverage: $('#alertCoverage'), alertList: $('#alertList'),
  placeContext: $('#placeContext'), place: $('#currentPlace'), placeClock: $('#placeClock'), currentTime: $('#currentTime'), currentAge: $('#currentAge'),
  conditionOrb: $('#conditionOrb'), currentTemp: $('#currentTemp'), temperatureUnit: $('#temperatureUnit'), conditionLabel: $('#conditionLabel'), feelsLike: $('#feelsLike'),
  humidity: $('#currentHumidity'), dew: $('#currentDew'), wind: $('#currentWind'), gust: $('#currentGust'), pressure: $('#currentPressure'), cloud: $('#currentCloud'),
  timing: $('#timingGrid'), hourly: $('#hourlyRail'), daily: $('#dailyList'), timezone: $('#forecastTimezone'),
  air: $('#airContent'), airTime: $('#airTime'), requestStamp: $('#requestStamp'),
  waterSection: $('#waterSection'), waterCoverage: $('#waterCoverage'), waterContent: $('#waterContent'),
};

const state = {
  units: localStorage.getItem(UNIT_KEY) || (navigator.language?.toUpperCase().endsWith('-US') ? 'imperial' : 'metric'),
  place: null,
  forecast: null,
  air: null,
  alerts: null,
  water: null,
  searchResults: [],
  activeResult: -1,
  searchAbort: null,
  searchId: 0,
  loadAbort: null,
  loadId: 0,
  searchTimer: null,
  clockTimer: null,
};

function setStatus(message, type = 'idle') {
  dom.status.textContent = message;
  dom.status.dataset.state = type;
}

function setBusy(busy) {
  dom.input.setAttribute('aria-busy', String(busy));
  dom.locate.disabled = busy;
  dom.units.disabled = busy;
}

function unitConfig() {
  return state.units === 'imperial'
    ? {temperature: 'fahrenheit', wind: 'mph', precipitation: 'inch', label: '°F · mph'}
    : {temperature: 'celsius', wind: 'kmh', precipitation: 'mm', label: '°C · km/h'};
}

function updateUnitButton() {
  dom.units.textContent = unitConfig().label;
  dom.units.setAttribute('aria-label', state.units === 'imperial' ? 'Switch to metric units' : 'Switch to U.S. customary units');
}

function placeName(place) {
  return [place.name, place.admin1, place.country].filter(Boolean).filter((value, index, array) => array.indexOf(value) === index).join(', ');
}

function placeRegion(place) {
  return [place.admin1, place.country].filter(Boolean).filter((value, index, array) => array.indexOf(value) === index).join(' · ');
}

function fromGeocode(result) {
  return {
    id: result.id,
    name: result.name,
    admin1: result.admin1 || '',
    country: result.country || '',
    countryCode: result.country_code || '',
    timezone: result.timezone || 'auto',
    latitude: Number(result.latitude),
    longitude: Number(result.longitude),
    source: 'search',
  };
}

async function fetchJson(url, {signal, headers} = {}) {
  const response = await fetch(url, {signal, headers});
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function forecastRequest(place) {
  const units = unitConfig();
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '10',
    temperature_unit: units.temperature,
    wind_speed_unit: units.wind,
    precipitation_unit: units.precipitation,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,snowfall,weather_code,cloud_cover,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max',
  });
  return `${FORECAST_URL}?${params}`;
}

function airRequest(place) {
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '3',
    current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide',
    hourly: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide',
  });
  return `${AIR_URL}?${params}`;
}

function waterRequest(place) {
  const bounds = waterBoundingBox(place.latitude, place.longitude, 50);
  if (bounds.length !== 4) return null;
  const params = new URLSearchParams({
    format: 'json',
    bBox: bounds.join(','),
    parameterCd: '00060,00065',
    period: 'P2D',
    siteStatus: 'active',
  });
  return `${USGS_WATER_URL}?${params}`;
}

async function loadWater(place, signal) {
  if (place.countryCode !== 'US') return {coverage: 'unsupported', station: null};
  const url = waterRequest(place);
  if (!url) return {coverage: 'unsupported', station: null};
  const payload = await fetchJson(url, {signal});
  const station = normalizeWaterSeries(payload, place);
  return {coverage: station ? 'usgs' : 'empty', station};
}

async function loadAlerts(place, signal) {
  if (place.countryCode !== 'US') return {coverage: 'unsupported', features: []};
  const params = new URLSearchParams({point: `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`});
  const data = await fetchJson(`${NWS_ALERTS_URL}?${params}`, {signal, headers: {Accept: 'application/geo+json'}});
  return {coverage: 'nws', features: Array.isArray(data.features) ? data.features : []};
}

function formatTime(epoch, timezone, options = {}) {
  if (!Number.isFinite(Number(epoch))) return '—';
  return new Intl.DateTimeFormat(undefined, {timeZone: timezone, hour: 'numeric', minute: '2-digit', ...options}).format(new Date(Number(epoch) * 1000));
}

function formatDay(epoch, timezone, short = false) {
  if (!Number.isFinite(Number(epoch))) return '—';
  return new Intl.DateTimeFormat(undefined, {timeZone: timezone, weekday: short ? 'short' : 'long', month: short ? undefined : 'short', day: short ? undefined : 'numeric'}).format(new Date(Number(epoch) * 1000));
}

function formatDateTime(epoch, timezone) {
  if (!Number.isFinite(Number(epoch))) return '—';
  return new Intl.DateTimeFormat(undefined, {timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'}).format(new Date(Number(epoch) * 1000));
}

function number(value, digits = 0) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
}

function relativeAge(epoch) {
  if (!Number.isFinite(Number(epoch))) return '';
  const minutes = Math.round((Date.now() / 1000 - Number(epoch)) / 60);
  if (minutes < -5) return 'forecast model time';
  if (minutes <= 5) return 'current model hour';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

function renderClock() {
  if (!state.forecast) return;
  const timezone = state.forecast.timezone;
  dom.placeClock.textContent = `${new Intl.DateTimeFormat(undefined, {timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'}).format(new Date())}`;
}

function renderCurrent() {
  const forecast = state.forecast;
  const current = forecast.current || {};
  const units = forecast.current_units || {};
  const condition = weatherCode(current.weather_code);
  dom.place.textContent = placeName(state.place);
  dom.placeContext.textContent = state.place.source === 'geolocation' ? 'BROWSER-SELECTED COORDINATES' : placeRegion(state.place).toUpperCase();
  dom.currentTime.textContent = formatDateTime(current.time, forecast.timezone);
  dom.currentAge.textContent = relativeAge(current.time);
  dom.currentTemp.textContent = number(current.temperature_2m);
  dom.temperatureUnit.textContent = units.temperature_2m || (state.units === 'imperial' ? '°F' : '°C');
  dom.conditionLabel.textContent = condition.label;
  dom.conditionOrb.dataset.condition = condition.key;
  dom.feelsLike.textContent = `Feels like ${number(current.apparent_temperature)}${units.apparent_temperature || ''}`;
  dom.humidity.textContent = `${number(current.relative_humidity_2m)}${units.relative_humidity_2m || '%'}`;
  dom.dew.textContent = `${number(current.dew_point_2m)}${units.dew_point_2m || ''}`;
  dom.wind.textContent = `${number(current.wind_speed_10m)} ${units.wind_speed_10m || ''} ${windCardinal(current.wind_direction_10m)}`;
  dom.gust.textContent = `${number(current.wind_gusts_10m)} ${units.wind_gusts_10m || ''}`;
  dom.pressure.textContent = `${number(current.pressure_msl)} ${units.pressure_msl || 'hPa'}`;
  dom.cloud.textContent = `${number(current.cloud_cover)}${units.cloud_cover || '%'}`;
  renderClock();
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(renderClock, 30000);
}

function timingCard(label, primary, detail) {
  const article = document.createElement('article');
  article.className = 'timing-card';
  const small = document.createElement('small');
  const strong = document.createElement('strong');
  const paragraph = document.createElement('p');
  small.textContent = label;
  strong.textContent = primary;
  paragraph.textContent = detail;
  article.append(small, strong, paragraph);
  return article;
}

function nextLightEvent(now, forecast) {
  const daily = forecast.daily || {};
  for (let index = 0; index < (daily.time || []).length; index += 1) {
    const sunrise = daily.sunrise?.[index];
    const sunset = daily.sunset?.[index];
    if (Number(sunrise) > now) return {label: 'Next light', primary: `Sunrise ${formatTime(sunrise, forecast.timezone)}`, detail: formatDay(sunrise, forecast.timezone)};
    if (Number(sunset) > now) return {label: 'Daylight', primary: `Sunset ${formatTime(sunset, forecast.timezone)}`, detail: formatDay(sunset, forecast.timezone)};
  }
  return {label: 'Daylight', primary: 'Unavailable', detail: 'No solar event in forecast'};
}

function renderTiming(rows) {
  const now = Number(state.forecast.current?.time) || Math.floor(Date.now() / 1000);
  const timezone = state.forecast.timezone;
  const units = state.forecast.hourly_units || {};
  const amountThreshold = precipitationAmountThreshold(state.units);
  const nextRain = findNextPrecipitation(rows, now, {amountThreshold});
  const dry = findDryWindow(rows, now, {amountMaximum: amountThreshold});
  const gust = strongestGust(rows, now, 24);
  const light = nextLightEvent(now, state.forecast);
  dom.timing.replaceChildren();
  dom.timing.append(
    nextRain
      ? timingCard('Next precipitation', formatTime(nextRain.time, timezone), `${number(nextRain.precipitationProbability)}% probability · ${number(nextRain.precipitation, state.units === 'imperial' ? 2 : 1)} ${units.precipitation || ''}`)
      : timingCard('Next precipitation', 'No clear signal', 'Below the display threshold for 48 hours'),
    dry
      ? timingCard('Dry window', `${formatTime(dry.start, timezone)}–${formatTime(dry.end, timezone)}`, `${dry.hours} forecast hours below 25% probability`)
      : timingCard('Dry window', 'Not identified', 'No three-hour dry sequence in the next 36 hours'),
    gust
      ? timingCard('Strongest gust', `${number(gust.value)} ${units.wind_gusts_10m || ''}`, `Around ${formatTime(gust.time, timezone)}`)
      : timingCard('Strongest gust', 'Unavailable', 'No gust values in the next 24 hours'),
    timingCard(light.label, light.primary, light.detail),
  );
}

function renderHourly(rows) {
  const forecast = state.forecast;
  const now = Number(forecast.current?.time) || Math.floor(Date.now() / 1000);
  const units = forecast.hourly_units || {};
  const upcoming = rows.filter((row) => Number(row.time) + 3600 > now).slice(0, 24);
  const fragment = document.createDocumentFragment();
  upcoming.forEach((row) => {
    const condition = weatherCode(row.weatherCode);
    const article = document.createElement('article');
    article.className = 'hourly-card';
    const time = document.createElement('time');
    time.dateTime = new Date(Number(row.time) * 1000).toISOString();
    time.textContent = isCurrentHourlyPeriod(row.time, now) ? 'NOW' : formatTime(row.time, forecast.timezone);
    const glyph = document.createElement('div');
    glyph.className = 'hourly-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = glyphs[condition.key] || '·';
    const temp = document.createElement('div');
    temp.className = 'hourly-temp';
    temp.textContent = `${number(row.temperature)}${units.temperature_2m || ''}`;
    const meta = document.createElement('div');
    meta.className = 'hourly-meta';
    const conditionText = document.createElement('span');
    const precip = document.createElement('span');
    const wind = document.createElement('span');
    conditionText.textContent = condition.label;
    precip.textContent = `${number(row.precipitationProbability)}% precip`;
    wind.textContent = `${number(row.windGust)} ${units.wind_gusts_10m || ''} gust`;
    meta.append(conditionText, precip, wind);
    article.append(time, glyph, temp, meta);
    fragment.append(article);
  });
  dom.hourly.replaceChildren(fragment);
}

function renderDaily() {
  const forecast = state.forecast;
  const daily = forecast.daily || {};
  const units = forecast.daily_units || {};
  const fragment = document.createDocumentFragment();
  (daily.time || []).forEach((epoch, index) => {
    const condition = weatherCode(daily.weather_code?.[index]);
    const row = document.createElement('article');
    row.className = 'daily-row';
    const day = document.createElement('span');
    day.className = 'daily-day';
    day.textContent = index === 0 ? 'Today' : formatDay(epoch, forecast.timezone, true);
    const conditionCell = document.createElement('span');
    conditionCell.className = 'daily-condition';
    const glyph = document.createElement('i');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = glyphs[condition.key] || '·';
    const label = document.createElement('span');
    label.textContent = condition.label;
    conditionCell.append(glyph, label);
    const temperature = document.createElement('span');
    temperature.className = 'daily-temperature';
    const high = document.createElement('span');
    const low = document.createElement('b');
    high.textContent = `${number(daily.temperature_2m_max?.[index])}${units.temperature_2m_max || ''}`;
    low.textContent = ` / ${number(daily.temperature_2m_min?.[index])}${units.temperature_2m_min || ''}`;
    temperature.append(high, low);
    const rain = document.createElement('span');
    rain.className = 'daily-rain';
    rain.textContent = `${number(daily.precipitation_probability_max?.[index])}% · ${number(daily.precipitation_sum?.[index], state.units === 'imperial' ? 2 : 1)} ${units.precipitation_sum || ''}`;
    const wind = document.createElement('span');
    wind.className = 'daily-wind';
    wind.textContent = `Gust ${number(daily.wind_gusts_10m_max?.[index])} ${units.wind_gusts_10m_max || ''}`;
    row.append(day, conditionCell, temperature, rain, wind);
    fragment.append(row);
  });
  dom.daily.replaceChildren(fragment);
  dom.timezone.textContent = `${forecast.timezone_abbreviation || ''} · ${forecast.timezone || ''}`;
}

function renderAir() {
  dom.air.replaceChildren();
  if (!state.air?.current) {
    const message = document.createElement('p');
    message.className = 'coverage-message';
    message.textContent = 'Modeled air-quality data is temporarily unavailable for this place.';
    dom.air.append(message);
    dom.airTime.textContent = '';
    return;
  }
  const current = state.air.current;
  const units = state.air.current_units || {};
  const category = aqiCategory(current.us_aqi);
  const primary = document.createElement('div');
  primary.className = 'aqi-primary';
  const value = document.createElement('div');
  value.className = 'aqi-number';
  value.textContent = number(current.us_aqi);
  const label = document.createElement('div');
  label.className = 'aqi-label';
  label.textContent = `US AQI · ${category.label}`;
  primary.append(value, label);
  const metrics = document.createElement('div');
  metrics.className = 'air-metrics';
  [['PM2.5', current.pm2_5, units.pm2_5], ['PM10', current.pm10, units.pm10], ['Ozone', current.ozone, units.ozone], ['Nitrogen dioxide', current.nitrogen_dioxide, units.nitrogen_dioxide]].forEach(([name, reading, unit]) => {
    const item = document.createElement('div');
    item.className = 'air-metric';
    const small = document.createElement('small');
    const bold = document.createElement('b');
    small.textContent = name;
    bold.textContent = `${number(reading, 1)} ${unit || ''}`;
    item.append(small, bold);
    metrics.append(item);
  });
  dom.air.append(primary, metrics);
  dom.airTime.textContent = `Model hour ${formatTime(current.time, state.air.timezone || state.forecast.timezone)}`;
}

function officialAlertUrl(feature) {
  const properties = feature?.properties || {};
  const candidate = properties['@id'] || properties.id || feature?.id;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:' && (url.hostname === 'weather.gov' || url.hostname.endsWith('.weather.gov'))) return url.href;
  } catch {}
  return 'https://www.weather.gov/';
}

function renderAlerts() {
  dom.alertList.replaceChildren();
  const result = state.alerts;
  const hasActiveAlerts = result?.coverage === 'nws' && result.features?.length > 0;
  if (hasActiveAlerts) dom.content.insertBefore(dom.alertSection, dom.currentSection);
  else dom.currentSection.after(dom.alertSection);
  if (!result || result.coverage === 'failed') {
    dom.alertCoverage.textContent = 'Official service unavailable';
    const message = document.createElement('p');
    message.className = 'coverage-message';
    message.textContent = 'The official U.S. alert service could not be reached. Check local authorities and weather.gov during dangerous weather.';
    dom.alertList.append(message);
    return;
  }
  if (result.coverage === 'unsupported') {
    dom.alertCoverage.textContent = 'Coverage not connected for this country';
    const message = document.createElement('p');
    message.className = 'coverage-message';
    message.textContent = state.place.source === 'geolocation'
      ? 'Official alert coverage cannot be determined from browser coordinates alone. Search for the city by name to check U.S. NWS coverage.'
      : 'Official alert coverage is not available through this page for this selected country. This does not mean there are no local warnings.';
    dom.alertList.append(message);
    return;
  }
  dom.alertCoverage.textContent = 'National Weather Service · United States';
  if (!result.features.length) {
    const message = document.createElement('p');
    message.className = 'coverage-message';
    message.textContent = 'No active NWS watches, warnings, or advisories were returned for this selected point.';
    dom.alertList.append(message);
    return;
  }
  result.features.forEach((feature) => {
    const properties = feature.properties || {};
    const details = document.createElement('details');
    details.className = 'alert-item';
    const summary = document.createElement('summary');
    summary.textContent = properties.headline || properties.event || 'Weather alert';
    const body = document.createElement('div');
    body.className = 'alert-body';
    const meta = document.createElement('p');
    meta.className = 'alert-meta';
    const severity = document.createElement('span');
    const effective = document.createElement('span');
    const expires = document.createElement('span');
    severity.textContent = `Severity: ${properties.severity || 'Unknown'}`;
    effective.textContent = `Effective: ${formatAlertTime(properties.effective || properties.onset)}`;
    expires.textContent = `Expires: ${formatAlertTime(properties.expires || properties.ends)}`;
    meta.append(severity, effective, expires);
    const description = document.createElement('p');
    description.textContent = properties.description || 'See the official alert for details.';
    body.append(meta, description);
    if (properties.instruction) {
      const instruction = document.createElement('p');
      instruction.textContent = properties.instruction;
      body.append(instruction);
    }
    const link = document.createElement('a');
    link.href = officialAlertUrl(feature);
    link.rel = 'external';
    link.textContent = 'Open the official alert';
    body.append(link);
    details.append(summary, body);
    dom.alertList.append(details);
  });
}

function formatAlertTime(value) {
  if (!value) return 'Not specified';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not specified';
  return new Intl.DateTimeFormat(undefined, {timeZone: state.forecast?.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'}).format(date);
}

function waterUnitLabel(unit) {
  return {'ft3/s': 'ft³/s', 'ft': 'ft'}[unit] || unit || '';
}

function formatWaterTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: state.forecast?.timezone,
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}

function waterAge(value) {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed)) return '';
  const minutes = Math.max(0, Math.round(elapsed / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

function renderWaterMessage(message, coverage) {
  dom.waterSection.hidden = false;
  dom.waterCoverage.textContent = coverage;
  dom.waterContent.replaceChildren();
  const paragraph = document.createElement('p');
  paragraph.className = 'water-message';
  paragraph.textContent = message;
  dom.waterContent.append(paragraph);
}

function waterMetric(label, measurement) {
  if (!measurement?.latest) return null;
  const block = document.createElement('div');
  block.className = 'water-metric';
  const small = document.createElement('small');
  const strong = document.createElement('strong');
  const unit = document.createElement('em');
  small.textContent = label;
  strong.textContent = number(measurement.latest.value, measurement.parameterCode === '00065' ? 2 : 0);
  unit.textContent = ` ${waterUnitLabel(measurement.unit)}`;
  strong.append(unit);
  block.append(small, strong);
  return block;
}

function renderWater() {
  const result = state.water;
  if (!result || result.coverage === 'unsupported') {
    dom.waterSection.hidden = true;
    dom.waterContent.replaceChildren();
    return;
  }
  if (result.coverage === 'failed') {
    renderWaterMessage('USGS observations are temporarily unavailable. Forecast and alert data are unaffected.', 'Provider unavailable');
    return;
  }
  if (result.coverage === 'empty' || !result.station) {
    renderWaterMessage('No active USGS station reporting discharge or gage height was returned within about 50 km of this place.', 'No nearby reporting station');
    return;
  }

  const station = result.station;
  const measurements = station.measurements || {};
  const latestRows = Object.values(measurements).map((item) => item?.latest).filter(Boolean);
  const latest = latestRows.sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
  const provisional = latestRows.some((row) => row.qualifiers?.includes('P'));
  const distance = state.units === 'imperial'
    ? `${number(station.distanceKm * 0.621371, 1)} mi`
    : `${number(station.distanceKm, 1)} km`;
  dom.waterSection.hidden = false;
  dom.waterCoverage.textContent = `${distance} · ${latest ? waterAge(latest.time) : 'latest time unavailable'}${provisional ? ' · provisional' : ''}`;
  dom.waterContent.replaceChildren();

  const grid = document.createElement('div');
  grid.className = 'water-grid';
  const reading = document.createElement('div');
  const link = document.createElement('a');
  link.className = 'water-station';
  link.href = station.url;
  link.rel = 'external';
  link.textContent = station.name;
  const meta = document.createElement('p');
  meta.className = 'water-station-meta';
  meta.textContent = `USGS ${station.siteCode} · ${distance}${latest ? ` · observed ${formatWaterTime(latest.time)}` : ''}${provisional ? ' · provisional data' : ''}`;
  const metricGrid = document.createElement('div');
  metricGrid.className = 'water-metrics';
  const dischargeMetric = waterMetric('Discharge', measurements.discharge);
  const gageMetric = waterMetric('Gage height', measurements.gageHeight);
  if (dischargeMetric) metricGrid.append(dischargeMetric);
  if (gageMetric) metricGrid.append(gageMetric);
  const chartMeasurement = measurements.discharge || measurements.gageHeight;
  const trend = waterTrend(chartMeasurement?.values);
  const trendText = document.createElement('p');
  trendText.className = 'water-trend';
  if (trend) {
    const direction = document.createElement('b');
    direction.textContent = trend.direction[0].toUpperCase() + trend.direction.slice(1);
    const unit = waterUnitLabel(chartMeasurement.unit);
    trendText.append(direction, ` by ${number(Math.abs(trend.delta), chartMeasurement.parameterCode === '00065' ? 2 : 0)} ${unit} over ${number(trend.hours, trend.hours < 10 ? 1 : 0)} hours.`);
  } else {
    trendText.textContent = 'Only one current sample was returned for this station.';
  }
  reading.append(link, meta, metricGrid, trendText);

  const figure = document.createElement('figure');
  figure.className = 'water-trace';
  const caption = document.createElement('figcaption');
  const captionLabel = document.createElement('span');
  const captionState = document.createElement('span');
  captionLabel.textContent = `48-hour ${measurements.discharge ? 'discharge' : 'gage-height'} trace`;
  captionState.textContent = 'observed';
  caption.append(captionLabel, captionState);
  const chart = waterSparkline(chartMeasurement?.values, 640, 160, 8);
  if (chart) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.classList.add('water-chart');
    svg.setAttribute('viewBox', '0 0 640 160');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    [40, 80, 120].forEach((y) => {
      const line = document.createElementNS(namespace, 'line');
      line.classList.add('water-gridline');
      line.setAttribute('x1', '8'); line.setAttribute('x2', '632');
      line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
      svg.append(line);
    });
    const path = document.createElementNS(namespace, 'path');
    path.classList.add('water-line');
    path.setAttribute('d', chart.path);
    svg.append(path);
    if (chart.points.length > 1) {
      const flow = document.createElementNS(namespace, 'path');
      flow.classList.add('water-flow');
      flow.setAttribute('d', chart.path);
      flow.setAttribute('pathLength', '1');
      const speed = Math.max(4, 8 - Math.min(4, Math.abs(trend?.ratePerHour || 0)));
      flow.style.setProperty('animation-duration', `${speed}s`);
      svg.append(flow);
    }
    const [lastX, lastY] = chart.points.at(-1);
    const point = document.createElementNS(namespace, 'circle');
    point.classList.add('water-latest');
    point.setAttribute('cx', String(lastX)); point.setAttribute('cy', String(lastY)); point.setAttribute('r', '3.5');
    svg.append(point);
    const traceMeta = document.createElement('div');
    traceMeta.className = 'water-trace-meta';
    const unit = waterUnitLabel(chartMeasurement.unit);
    traceMeta.textContent = `${number(chart.min, chartMeasurement.parameterCode === '00065' ? 2 : 0)}–${number(chart.max, chartMeasurement.parameterCode === '00065' ? 2 : 0)} ${unit}`;
    const observed = document.createElement('span');
    observed.textContent = latest ? formatWaterTime(latest.time) : '';
    traceMeta.append(observed);
    figure.append(caption, svg, traceMeta);
  } else {
    figure.append(caption);
  }
  grid.append(reading, figure);
  dom.waterContent.append(grid);
}

function renderWeather() {
  const rows = normalizeHourly(state.forecast.hourly);
  dom.empty.hidden = true;
  dom.content.hidden = false;
  renderCurrent();
  renderAlerts();
  renderWater();
  renderTiming(rows);
  renderHourly(rows);
  renderDaily();
  renderAir();
  dom.requestStamp.textContent = `Browser request completed ${new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date())}. Forecast, alert, and air-quality times are shown separately above.`;
  setStatus(`Forecast loaded for ${placeName(state.place)}.`, 'ready');
}

async function loadWeather(place, {updateUrl = true} = {}) {
  const loadId = ++state.loadId;
  state.loadAbort?.abort();
  const controller = new AbortController();
  state.loadAbort = controller;
  state.place = place;
  setBusy(true);
  setStatus(`Loading weather for ${placeName(place)}…`, 'loading');
  const forecastPromise = fetchJson(forecastRequest(place), {signal: controller.signal});
  const airPromise = fetchJson(airRequest(place), {signal: controller.signal});
  const alertPromise = loadAlerts(place, controller.signal);
  const waterPromise = loadWater(place, controller.signal);
  try {
    const [forecastResult, airResult, alertResult, waterResult] = await Promise.allSettled([forecastPromise, airPromise, alertPromise, waterPromise]);
    if (loadId !== state.loadId) return;
    if (forecastResult.status !== 'fulfilled') throw forecastResult.reason;
    state.forecast = forecastResult.value;
    state.air = airResult.status === 'fulfilled' ? airResult.value : null;
    state.alerts = alertResult.status === 'fulfilled' ? alertResult.value : {coverage: 'failed', features: []};
    state.water = waterResult.status === 'fulfilled' ? waterResult.value : {coverage: 'failed', station: null};
    if (place.source === 'search') {
      saveRecent(place);
      if (updateUrl) updateLocationUrl(place);
    }
    renderWeather();
  } catch (error) {
    if (loadId !== state.loadId) return;
    if (error.name !== 'AbortError') {
      setStatus(`Weather could not be loaded for ${placeName(place)}. Try again shortly.`, 'error');
      if (!state.forecast) {
        dom.empty.hidden = false;
        dom.content.hidden = true;
      }
      console.error('Weather request failed', error);
    }
  } finally {
    if (loadId === state.loadId) setBusy(false);
  }
}

function renderSearchResults(results) {
  state.searchResults = results;
  state.activeResult = -1;
  dom.results.replaceChildren();
  results.forEach((result, index) => {
    const place = fromGeocode(result);
    const item = document.createElement('li');
    item.id = `place-option-${index}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    const strong = document.createElement('strong');
    const small = document.createElement('small');
    strong.textContent = result.name;
    small.textContent = placeRegion(place) || result.timezone || 'Location result';
    item.append(strong, small);
    item.addEventListener('click', () => selectSearchResult(index));
    dom.results.append(item);
  });
  const expanded = results.length > 0;
  dom.results.hidden = !expanded;
  dom.input.setAttribute('aria-expanded', String(expanded));
  dom.input.setAttribute('aria-activedescendant', expanded && state.activeResult >= 0 ? `place-option-${state.activeResult}` : '');
}

function updateActiveResult(nextIndex) {
  if (!state.searchResults.length) return;
  state.activeResult = (nextIndex + state.searchResults.length) % state.searchResults.length;
  [...dom.results.children].forEach((item, index) => item.setAttribute('aria-selected', String(index === state.activeResult)));
  dom.input.setAttribute('aria-activedescendant', `place-option-${state.activeResult}`);
  dom.results.children[state.activeResult]?.scrollIntoView({block: 'nearest'});
}

function closeResults() {
  dom.results.hidden = true;
  dom.input.setAttribute('aria-expanded', 'false');
  dom.input.setAttribute('aria-activedescendant', '');
}

function clearSearchResults() {
  state.searchResults = [];
  state.activeResult = -1;
  dom.results.replaceChildren();
  closeResults();
}

function selectSearchResult(index) {
  const result = state.searchResults[index];
  if (!result) return;
  const place = fromGeocode(result);
  dom.input.value = placeName(place);
  closeResults();
  loadWeather(place);
}

async function searchPlaces(query, {selectFirst = false} = {}) {
  const cleaned = query.trim();
  if (cleaned.length < 2) {
    clearSearchResults();
    return [];
  }
  const searchId = ++state.searchId;
  state.searchAbort?.abort();
  const controller = new AbortController();
  state.searchAbort = controller;
  try {
    let results = [];
    for (const candidate of geocodeFallbackQueries(cleaned)) {
      const params = new URLSearchParams({name: candidate, count: '8', language: navigator.language?.split('-')[0] || 'en', format: 'json'});
      const data = await fetchJson(`${GEOCODE_URL}?${params}`, {signal: controller.signal});
      if (searchId !== state.searchId) return [];
      results = Array.isArray(data.results) ? data.results : [];
      if (results.length) break;
    }
    if (searchId !== state.searchId) return [];
    renderSearchResults(results);
    if (selectFirst && results.length) selectSearchResult(0);
    if (selectFirst && !results.length) setStatus(`No place matched “${cleaned}”.`, 'error');
    return results;
  } catch (error) {
    if (searchId !== state.searchId) return [];
    if (error.name !== 'AbortError') {
      clearSearchResults();
      setStatus('Location search is temporarily unavailable.', 'error');
      console.error('Location search failed', error);
    }
    return [];
  }
}

function getRecents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude)).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function saveRecent(place) {
  const recents = getRecents().filter((saved) => saved.id !== place.id && !(saved.latitude === place.latitude && saved.longitude === place.longitude));
  recents.unshift(place);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents.slice(0, 5)));
  renderRecents();
}

function renderRecents() {
  const fragment = document.createDocumentFragment();
  const recents = getRecents();
  recents.forEach((place) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = [place.name, place.admin1].filter(Boolean).join(', ');
    button.addEventListener('click', () => {
      dom.input.value = placeName(place);
      loadWeather(place);
    });
    fragment.append(button);
  });
  if (recents.length) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'recent-clear';
    clear.textContent = 'Clear';
    clear.setAttribute('aria-label', 'Clear recent weather places from this browser');
    clear.addEventListener('click', () => {
      localStorage.removeItem(RECENT_KEY);
      renderRecents();
    });
    fragment.append(clear);
  }
  dom.recents.replaceChildren(fragment);
}

function updateLocationUrl(place) {
  const params = new URLSearchParams({
    lat: place.latitude.toFixed(5), lon: place.longitude.toFixed(5), name: place.name,
    admin: place.admin1 || '', country: place.country || '', cc: place.countryCode || '', tz: place.timezone || 'auto',
  });
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

function placeFromUrl() {
  const params = new URLSearchParams(location.search);
  const latitude = Number(params.get('lat'));
  const longitude = Number(params.get('lon'));
  const name = params.get('name');
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    id: `url-${latitude}-${longitude}`, name, admin1: params.get('admin') || '', country: params.get('country') || '',
    countryCode: params.get('cc') || '', timezone: params.get('tz') || 'auto', latitude, longitude, source: 'search',
  };
}

dom.form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(state.searchTimer);
  if (state.searchResults.length && !dom.results.hidden) selectSearchResult(Math.max(0, state.activeResult));
  else searchPlaces(dom.input.value, {selectFirst: true});
});

dom.input.addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  state.searchId += 1;
  state.searchAbort?.abort();
  clearSearchResults();
  state.searchTimer = setTimeout(() => searchPlaces(dom.input.value), 260);
});

dom.input.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); updateActiveResult(state.activeResult + 1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); updateActiveResult(state.activeResult - 1); }
  else if (event.key === 'Enter' && !dom.results.hidden && state.activeResult >= 0) { event.preventDefault(); selectSearchResult(state.activeResult); }
  else if (event.key === 'Escape') closeResults();
});

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.combobox-wrap')) closeResults();
});

dom.units.addEventListener('click', () => {
  state.units = state.units === 'imperial' ? 'metric' : 'imperial';
  localStorage.setItem(UNIT_KEY, state.units);
  updateUnitButton();
  if (state.place) loadWeather(state.place, {updateUrl: false});
});

dom.locate.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('This browser does not provide location access. Search for a city instead.', 'error');
    return;
  }
  setStatus('Waiting for browser location permission…', 'loading');
  navigator.geolocation.getCurrentPosition(
    (position) => loadWeather({
      id: 'browser-location', name: 'Current location', admin1: '', country: '', countryCode: '', timezone: 'auto',
      latitude: position.coords.latitude, longitude: position.coords.longitude, source: 'geolocation',
    }, {updateUrl: false}),
    () => setStatus('Location was not shared. Search for a city or postal code instead.', 'error'),
    {enableHighAccuracy: false, timeout: 10000, maximumAge: 600000},
  );
});

updateUnitButton();
renderRecents();
const initialPlace = placeFromUrl();
if (initialPlace) {
  dom.input.value = placeName(initialPlace);
  loadWeather(initialPlace, {updateUrl: false});
}
