const EARTHQUAKE_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';
const EONET_LOOKBACK_DAYS = 2;

export const EONET_CATEGORIES = Object.freeze([
  'wildfires',
  'volcanoes',
  'severeStorms',
  'landslides',
  'seaLakeIce',
]);

export function dayBounds(dateValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || ''))) return null;
  const startDate = new Date(`${dateValue}T00:00:00.000Z`);
  if (!Number.isFinite(startDate.getTime()) || startDate.toISOString().slice(0, 10) !== dateValue) return null;
  const endDate = new Date(startDate.getTime() + 86400000);
  return {start: startDate.toISOString(), end: endDate.toISOString(), date: dateValue};
}

export function buildEarthquakeUrl(dateValue, minMagnitude = 2.5) {
  const bounds = dayBounds(dateValue);
  if (!bounds) return null;
  const params = new URLSearchParams({
    format: 'geojson',
    starttime: bounds.start,
    endtime: bounds.end,
    minmagnitude: String(minMagnitude),
    orderby: 'time-asc',
  });
  return `${EARTHQUAKE_URL}?${params}`;
}

export function buildEonetUrls(dateValue, limit = 200, lookbackDays = EONET_LOOKBACK_DAYS) {
  const bounds = dayBounds(dateValue);
  if (!bounds) return {};
  const safeLookback = Math.max(0, Math.min(7, Number.isFinite(Number(lookbackDays)) ? Math.trunc(Number(lookbackDays)) : EONET_LOOKBACK_DAYS));
  const start = new Date(Date.parse(bounds.start) - safeLookback * 86400000).toISOString().slice(0, 10);
  return Object.fromEntries(EONET_CATEGORIES.map((category) => {
    const params = new URLSearchParams({
      category,
      status: 'all',
      start,
      end: bounds.date,
      limit: String(limit),
    });
    return [category, `${EONET_URL}?${params}`];
  }));
}

function finiteNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteCoordinatePair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = finiteNumber(value[0]);
  const lat = finiteNumber(value[1]);
  if (lon === null || lat === null || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return [lon, lat];
}

function polygonCentroid(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const points = ring.map(finiteCoordinatePair).filter(Boolean);
  if (points.length < 3) return null;
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    x += (current[0] + next[0]) * cross;
    y += (current[1] + next[1]) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    const unique = points.filter((point, index, all) => index === all.findIndex((candidate) => candidate[0] === point[0] && candidate[1] === point[1]));
    return [
      Number((unique.reduce((sum, point) => sum + point[0], 0) / unique.length).toFixed(6)),
      Number((unique.reduce((sum, point) => sum + point[1], 0) / unique.length).toFixed(6)),
    ];
  }
  return [
    Number((x / (3 * twiceArea)).toFixed(6)),
    Number((y / (3 * twiceArea)).toFixed(6)),
  ];
}

export function representativePoint(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  if (geometry.type === 'Point') return finiteCoordinatePair(geometry.coordinates);
  if (geometry.type === 'MultiPoint') {
    return (geometry.coordinates || []).map(finiteCoordinatePair).find(Boolean) || null;
  }
  if (geometry.type === 'Polygon') return polygonCentroid(geometry.coordinates?.[0]);
  if (geometry.type === 'MultiPolygon') return polygonCentroid(geometry.coordinates?.[0]?.[0]);
  return null;
}

function decodeEntities(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function cleanEventTitle(value) {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

function safeHttpsUrl(value, expectedHost, fallback) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || (expectedHost && url.hostname !== expectedHost)) return fallback;
    return url.href;
  } catch {
    return fallback;
  }
}

function duplicateKey(title) {
  return title
    .toLowerCase()
    .replace(/\b(wildfire|fire|volcano|storm|landslide|iceberg)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeEarthquakes(payload, dateValue = null) {
  const bounds = dateValue ? dayBounds(dateValue) : null;
  if (dateValue && !bounds) return [];
  const start = bounds ? Date.parse(bounds.start) : Number.NEGATIVE_INFINITY;
  const end = bounds ? Date.parse(bounds.end) : Number.POSITIVE_INFINITY;
  return (Array.isArray(payload?.features) ? payload.features : []).flatMap((feature) => {
    const point = representativePoint(feature?.geometry);
    const properties = feature?.properties || {};
    const magnitude = finiteNumber(properties.mag);
    const timestamp = finiteNumber(properties.time);
    if (!point || magnitude === null || timestamp === null) return [];
    const eventTime = new Date(timestamp);
    if (!Number.isFinite(eventTime.getTime()) || timestamp < start || timestamp >= end) return [];
    const depth = finiteNumber(feature.geometry?.coordinates?.[2]);
    const place = cleanEventTitle(properties.place) || 'Location unavailable';
    return [{
      id: `usgs-${feature.id || `${properties.time}-${point.join('-')}`}`,
      provider: 'USGS',
      category: 'earthquake',
      title: `M ${magnitude.toFixed(1)} · ${place}`,
      time: eventTime.toISOString(),
      coordinates: point,
      magnitude,
      depthKm: depth,
      status: properties.status || '',
      url: safeHttpsUrl(properties.url, 'earthquake.usgs.gov', 'https://earthquake.usgs.gov/earthquakes/'),
    }];
  });
}

function eventGeometryForDate(event, dateValue) {
  const bounds = dayBounds(dateValue);
  if (!bounds) return null;
  const windowStart = Date.parse(bounds.start) - EONET_LOOKBACK_DAYS * 86400000;
  const windowEnd = Date.parse(bounds.end);
  const candidates = (Array.isArray(event?.geometry) ? event.geometry : []).flatMap((geometry) => {
    const point = representativePoint(geometry);
    if (!point) return [];
    const rawDate = geometry.date;
    const parsed = typeof rawDate === 'string' && rawDate.trim() ? new Date(rawDate) : null;
    if (!parsed || !Number.isFinite(parsed.getTime())) return [];
    const timestamp = parsed.getTime();
    if (timestamp < windowStart || timestamp >= windowEnd) return [];
    return [{geometry, point, time: parsed}];
  });
  if (!candidates.length) return null;
  const target = new Date(`${dateValue}T12:00:00.000Z`).getTime();
  candidates.sort((a, b) => {
    const aDistance = a.time ? Math.abs(a.time.getTime() - target) : Number.POSITIVE_INFINITY;
    const bDistance = b.time ? Math.abs(b.time.getTime() - target) : Number.POSITIVE_INFINITY;
    return aDistance - bDistance;
  });
  return candidates[0];
}

export function normalizeEonet(payload, dateValue, expectedCategory, maxEvents = 80) {
  if (!dayBounds(dateValue)) return [];
  const seen = new Set();
  const normalized = [];
  for (const event of Array.isArray(payload?.events) ? payload.events : []) {
    const title = cleanEventTitle(event?.title);
    if (!title || /\bprescribed\b|\brx\b/i.test(title)) continue;
    const category = event?.categories?.[0]?.id || expectedCategory;
    if (expectedCategory && category !== expectedCategory) continue;
    const chosen = eventGeometryForDate(event, dateValue);
    if (!chosen) continue;
    const key = duplicateKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const sourceUrl = (event?.sources || [])
      .map((source) => safeHttpsUrl(source?.url, null, null))
      .find(Boolean);
    const time = chosen.time.toISOString();
    normalized.push({
      id: `eonet-${event.id || `${category}-${key}`}`,
      provider: 'NASA EONET',
      category,
      title,
      time,
      coordinates: chosen.point,
      magnitude: finiteNumber(chosen.geometry?.magnitudeValue),
      magnitudeUnit: chosen.geometry?.magnitudeUnit || '',
      status: event?.closed ? 'closed' : 'open',
      url: sourceUrl || (event?.id ? `https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(event.id)}` : 'https://eonet.gsfc.nasa.gov/'),
    });
    if (normalized.length >= maxEvents) break;
  }
  return normalized;
}

export function eventCategoryCounts(events) {
  const counts = {};
  for (const event of Array.isArray(events) ? events : []) {
    if (!event?.category) continue;
    counts[event.category] = (counts[event.category] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
