const GIBS_WMS_ROOT = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const FRAME = Object.freeze({south: -66, west: -180, north: 90, east: 180});
const FRAME_WIDTH_DEGREES = FRAME.east - FRAME.west;
const FRAME_HEIGHT_DEGREES = FRAME.north - FRAME.south;

export const GIBS_PRODUCTS = Object.freeze([
  Object.freeze({
    id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    start: '2018-01-05',
    instrument: 'VIIRS',
    platform: 'NOAA-20',
    resolution: '250 m nominal',
  }),
  Object.freeze({
    id: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    start: '2015-11-24',
    instrument: 'VIIRS',
    platform: 'Suomi NPP',
    resolution: '250 m nominal',
  }),
  Object.freeze({
    id: 'MODIS_Aqua_CorrectedReflectance_TrueColor',
    start: '2002-07-03',
    instrument: 'MODIS',
    platform: 'Aqua',
    resolution: '250 m nominal',
  }),
  Object.freeze({
    id: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    start: '2000-02-24',
    instrument: 'MODIS',
    platform: 'Terra',
    resolution: '250 m nominal',
  }),
]);

function finiteNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function productForDate(dateValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || ''))) return null;
  return GIBS_PRODUCTS.find((product) => dateValue >= product.start) || null;
}

export function imageDimensions(requestedWidth) {
  const numeric = finiteNumber(requestedWidth);
  const width = Math.max(640, Math.min(2048, Math.round(numeric ?? 1440)));
  return {width, height: Math.round(width * FRAME_HEIGHT_DEGREES / FRAME_WIDTH_DEGREES)};
}

function buildWmsUrl(layer, width, dateValue = null) {
  const dimensions = imageDimensions(width);
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: layer,
    STYLES: '',
    FORMAT: 'image/jpeg',
    CRS: 'EPSG:4326',
    BBOX: `${FRAME.south},${FRAME.west},${FRAME.north},${FRAME.east}`,
    WIDTH: String(dimensions.width),
    HEIGHT: String(dimensions.height),
    BGCOLOR: '0x020806',
  });
  if (dateValue) params.set('TIME', dateValue);
  return `${GIBS_WMS_ROOT}?${params}`;
}

export function buildGibsImageUrl(dateValue, width = 1440) {
  const product = productForDate(dateValue);
  if (!product) return null;
  return buildWmsUrl(product.id, width, dateValue);
}

export function buildBlueMarbleUrl(width = 1440) {
  return buildWmsUrl('BlueMarble_NextGeneration', width);
}

export function projectToOrbitalFrame(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = finiteNumber(coordinates[0]);
  const lat = finiteNumber(coordinates[1]);
  if (lon === null || lat === null || lon < FRAME.west || lon > FRAME.east || lat < FRAME.south || lat > FRAME.north) return null;
  return {
    x: Number((((lon - FRAME.west) / FRAME_WIDTH_DEGREES) * 100).toFixed(6)),
    y: Number((((FRAME.north - lat) / FRAME_HEIGHT_DEGREES) * 100).toFixed(6)),
  };
}
