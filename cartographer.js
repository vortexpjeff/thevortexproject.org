import {
  buildEonetUrls,
  buildEarthquakeUrl,
  dayBounds,
  eventCategoryCounts,
  normalizeEonet,
  normalizeEarthquakes,
} from './cartographer-events.js';

const OL = window.ol;
const $ = (id) => document.getElementById(id);
const dateInput = $('imageDate');
const previousDay = $('previousDay');
const nextDay = $('nextDay');
const latestDay = $('latestDay');
const globalView = $('globalView');
const toggleLabels = $('toggleLabels');
const toggleEvents = $('toggleEvents');
const imageState = $('imageState');
const imageDateSide = $('imageDateSide');
const eventCount = $('eventCount');
const eventStatus = $('eventStatus');
const eventFilters = $('eventFilters');
const eventDirectory = $('eventDirectory');
const eventList = $('eventList');
const eventListCount = $('eventListCount');
const eventPopup = $('eventPopup');
const mapPanel = $('mapPanel');
const panelToggle = $('panelToggle');
const panelClose = $('panelClose');

const MIN_DATE = '2002-07-04';
const REFRESH_MS = 300000;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DAILY_ROOT = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/';
const BLANK_TILE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const EVENT_COLORS = Object.freeze({
  earthquake: '#f8d77b',
  wildfires: '#ff8d78',
  volcanoes: '#d7a0ff',
  severeStorms: '#78bfff',
  landslides: '#d5aa6d',
  seaLakeIce: '#9deaf5',
});
const EVENT_LABELS = Object.freeze({
  earthquake: 'Earthquake',
  wildfires: 'Wildfire',
  volcanoes: 'Volcano',
  severeStorms: 'Severe storm',
  landslides: 'Landslide',
  seaLakeIce: 'Sea / lake ice',
});

const utcToday = () => new Date().toISOString().slice(0, 10);
const validDate = (value) => Boolean(dayBounds(value)) && value >= MIN_DATE && value <= utcToday();
const formatLong = (value) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
}).format(new Date(`${value}T12:00:00Z`));
const displayNumber = (value, digits = 0, suffix = '') => Number.isFinite(Number(value))
  ? `${Number(value).toFixed(digits)}${suffix}`
  : '—';

const queryDate = new URLSearchParams(location.search).get('date');
const initialDate = validDate(queryDate) ? queryDate : utcToday();
dateInput.max = utcToday();
dateInput.value = initialDate;

let selectedDate = initialDate;
let map;
let dailySource;
let eventSource;
let eventLayer;
let eventOverlay;
let labelLayers = [];
let pendingTiles = 0;
let loadedTiles = 0;
let failedTiles = 0;
let settleTimer = 0;
let eventAbort;
let eventLoadId = 0;
let eventRecords = [];
let eventProviderNote = '';
let eventsVisible = true;
let eventPopupOpener = null;
const eventCache = new Map();
const enabledCategories = new Set(Object.keys(EVENT_COLORS));
const eventStyleCache = new Map();

function southCoverageRow(z) {
  const n = 2 ** z;
  const latitude = -66 * Math.PI / 180;
  return Math.ceil((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * n);
}

function gibsDailyTileFunction(date) {
  return (tileCoord) => {
    if (!tileCoord) return undefined;
    const [z, x, y] = tileCoord;
    const n = 2 ** z;
    if (y < 0 || y >= southCoverageRow(z)) return undefined;
    const wrappedX = ((x % n) + n) % n;
    return `${DAILY_ROOT}${date}/GoogleMapsCompatible_Level9/${z}/${y}/${wrappedX}.jpeg`;
  };
}

function gibsStatic(layer) {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`;
}

function quietTileLoader(tile, src) {
  const image = tile.getImage();
  delete image.dataset.gibsFallback;
  const isCurrentDay = src.includes(`/${utcToday()}/`);
  fetch(src, {mode: 'cors', cache: isCurrentDay ? 'no-cache' : 'default'})
    .then((response) => response.ok ? response.blob() : Promise.reject(new Error('tile outside coverage')))
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      image.addEventListener('load', () => URL.revokeObjectURL(objectUrl), {once: true});
      image.src = objectUrl;
    })
    .catch(() => {
      image.dataset.gibsFallback = 'true';
      image.src = BLANK_TILE;
    });
}

function setImageState(title, detail) {
  imageState.replaceChildren();
  const heading = document.createElement('b');
  const text = document.createElement('span');
  heading.textContent = title;
  text.textContent = detail;
  imageState.append(heading, text);
}

function dateShift(days) {
  const date = new Date(`${selectedDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  setDate(date.toISOString().slice(0, 10));
}

function setDate(value) {
  if (!validDate(value)) return;
  selectedDate = value;
  dateInput.value = value;
  imageDateSide.textContent = formatLong(value);
  previousDay.disabled = value <= MIN_DATE;
  nextDay.disabled = value >= utcToday();
  latestDay.disabled = value === utcToday();
  pendingTiles = 0;
  loadedTiles = 0;
  failedTiles = 0;
  clearTimeout(settleTimer);
  closeEventPopup(false);
  if (dailySource) {
    setImageState('Loading orbital passes', `${formatLong(value)} · Aqua / MODIS true color`);
    dailySource.setTileUrlFunction(gibsDailyTileFunction(value), value);
    dailySource.refresh();
  }
  if (eventSource) loadEarthEvents(value);
  const url = new URL(location.href);
  url.searchParams.set('date', value);
  history.replaceState({}, '', url);
}

function wireTileState(source) {
  source.on('tileloadstart', () => {
    pendingTiles += 1;
    setImageState('Loading orbital passes', `${formatLong(selectedDate)} · ${pendingTiles} tile${pendingTiles === 1 ? '' : 's'} pending`);
  });
  source.on('tileloadend', (event) => {
    pendingTiles = Math.max(0, pendingTiles - 1);
    if (event.tile?.getImage?.().dataset.gibsFallback === 'true') failedTiles += 1;
    else loadedTiles += 1;
    queueSettled();
  });
  source.on('tileloaderror', () => {
    pendingTiles = Math.max(0, pendingTiles - 1);
    failedTiles += 1;
    queueSettled();
  });
}

function queueSettled() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    const detail = failedTiles
      ? `${formatLong(selectedDate)} · ${loadedTiles} tiles loaded · ${failedTiles} outside coverage`
      : `${formatLong(selectedDate)} · imagery loaded from NASA GIBS`;
    setImageState(loadedTiles ? 'Imagery ready' : 'No imagery in this view', detail);
  }, 220);
}

function eventStyle(feature) {
  const event = feature.get('event');
  const magnitude = Number(event?.magnitude);
  const radius = event?.category === 'earthquake'
    ? Math.max(3.4, Math.min(8, 2.3 + (Number.isFinite(magnitude) ? magnitude : 2.5) * 0.82))
    : 4.6;
  const key = `${event?.category}-${radius.toFixed(1)}`;
  if (!eventStyleCache.has(key)) {
    const color = EVENT_COLORS[event?.category] || '#9affb3';
    eventStyleCache.set(key, new OL.style.Style({
      image: new OL.style.Circle({
        radius,
        fill: new OL.style.Fill({color: `${color}c9`}),
        stroke: new OL.style.Stroke({color: `${color}f2`, width: 1}),
      }),
    }));
  }
  return eventStyleCache.get(key);
}

function eventDateTime(event) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(event.time));
}

function renderEventDirectory(events) {
  eventList.replaceChildren();
  eventListCount.textContent = String(events.length);
  eventDirectory.hidden = events.length === 0;
  if (!events.length) eventDirectory.open = false;
  for (const event of events) {
    const item = document.createElement('li');
    const focus = document.createElement('button');
    const title = document.createElement('span');
    const detail = document.createElement('small');
    const link = document.createElement('a');
    focus.type = 'button';
    focus.className = 'event-list-focus';
    focus.dataset.eventId = event.id;
    title.textContent = event.title;
    detail.textContent = `${EVENT_LABELS[event.category] || event.category} · ${eventDateTime(event)}`;
    focus.append(title, detail);
    link.className = 'event-list-link';
    link.href = event.url;
    link.rel = 'external';
    link.textContent = '↗';
    link.setAttribute('aria-label', `Open provider record for ${event.title}`);
    item.append(focus, link);
    eventList.append(item);
  }
}

function renderEventFeatures() {
  if (!eventSource) return;
  const counts = eventCategoryCounts(eventRecords);
  eventFilters.querySelectorAll('.event-filter').forEach((button) => {
    button.querySelector('b').textContent = String(counts[button.dataset.category] || 0);
  });
  const visible = eventRecords.filter((event) => enabledCategories.has(event.category));
  renderEventDirectory(visible);
  const features = visible.map((event) => {
    const feature = new OL.Feature({
      geometry: new OL.geom.Point(OL.proj.fromLonLat(event.coordinates)),
      event,
    });
    feature.setId(event.id);
    return feature;
  });
  eventSource.clear();
  eventSource.addFeatures(features);
  eventLayer.setVisible(eventsVisible);
  eventCount.textContent = eventsVisible ? `${visible.length} visible` : `${visible.length} hidden`;
  eventStatus.textContent = eventRecords.length
    ? `${counts.earthquake || 0} USGS quakes · ${eventRecords.length - (counts.earthquake || 0)} EONET events${eventProviderNote}`
    : `No qualifying events returned for this date window${eventProviderNote}`;
  map?.render();
}

async function fetchJson(url, signal) {
  if (!url) throw new Error('Invalid provider URL');
  const response = await fetch(url, {signal, headers: {Accept: 'application/json'}});
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function trimEventCache() {
  while (eventCache.size > 8) eventCache.delete(eventCache.keys().next().value);
}

async function loadEarthEvents(dateValue) {
  eventAbort?.abort();
  const loadId = ++eventLoadId;
  const cached = eventCache.get(dateValue);
  if (cached) {
    eventRecords = cached.records;
    eventProviderNote = cached.note;
    renderEventFeatures();
    return;
  }
  const controller = new AbortController();
  eventAbort = controller;
  eventCount.textContent = 'loading';
  eventStatus.textContent = `Loading events for ${formatLong(dateValue)}…`;
  const requests = [
    {provider: 'USGS', category: 'earthquake', url: buildEarthquakeUrl(dateValue)},
    ...Object.entries(buildEonetUrls(dateValue)).map(([category, url]) => ({provider: 'NASA EONET', category, url})),
  ];
  const results = await Promise.allSettled(requests.map((request) => fetchJson(request.url, controller.signal)));
  if (loadId !== eventLoadId) return;
  const records = [];
  const failed = [];
  results.forEach((result, index) => {
    const request = requests[index];
    if (result.status === 'rejected') {
      if (result.reason?.name !== 'AbortError') failed.push(request);
      return;
    }
    if (request.category === 'earthquake') {
      records.push(...normalizeEarthquakes(result.value, dateValue));
    } else {
      const cap = request.category === 'wildfires' ? 80 : 30;
      records.push(...normalizeEonet(result.value, dateValue, request.category, cap));
    }
  });
  const failedProviders = new Set(failed.map((request) => request.provider));
  const truncated = results.flatMap((result, index) => {
    const request = requests[index];
    return request.provider === 'NASA EONET' && result.status === 'fulfilled' && result.value?.events?.length >= 200
      ? [EVENT_LABELS[request.category] || request.category]
      : [];
  });
  eventRecords = records;
  const notes = [];
  if (failedProviders.size) notes.push(`${failedProviders.size} provider${failedProviders.size === 1 ? '' : 's'} unavailable`);
  if (truncated.length) notes.push(`EONET limit reached for ${truncated.join(', ')}; list may be incomplete`);
  eventProviderNote = notes.length ? ` · ${notes.join(' · ')}` : '';
  if (!failed.length && !truncated.length) {
    eventCache.set(dateValue, {records, note: eventProviderNote});
    trimEventCache();
  }
  renderEventFeatures();
}

function showEventPopup(feature, opener = null) {
  const event = feature.get('event');
  if (!event || !eventOverlay) return;
  const category = EVENT_LABELS[event.category] || event.category;
  $('eventPopupProvider').textContent = `${event.provider} · ${category}`;
  $('eventPopupTitle').textContent = event.title;
  const details = [eventDateTime(event)];
  if (event.category === 'earthquake') {
    if (Number.isFinite(event.depthKm)) details.push(`${displayNumber(event.depthKm, 1, ' km')} depth`);
    if (event.status) details.push(event.status);
  } else if (event.status) {
    details.push(event.status);
  }
  $('eventPopupDetail').textContent = details.join(' · ');
  $('eventPopupLink').href = event.url;
  eventPopup.hidden = false;
  eventOverlay.setPosition(feature.getGeometry().getCoordinates());
  eventPopupOpener = opener;
  if (opener) $('eventPopupClose').focus();
}

function closeEventPopup(restoreFocus = true) {
  const opener = eventPopupOpener;
  eventPopupOpener = null;
  if (eventOverlay) eventOverlay.setPosition(undefined);
  eventPopup.hidden = true;
  if (restoreFocus && opener?.isConnected) opener.focus();
}

function initMap() {
  if (!OL) {
    $('mapFallback').hidden = false;
    setImageState('Map unavailable', 'The Observatory remains available from the project navigation.');
    eventStatus.textContent = 'Event map unavailable.';
    return;
  }
  dailySource = new OL.source.XYZ({
    tileUrlFunction: gibsDailyTileFunction(selectedDate),
    tileLoadFunction: quietTileLoader,
    crossOrigin: 'anonymous',
    attributions: 'Imagery: NASA EOSDIS GIBS · MODIS / Aqua',
    maxZoom: 9,
    wrapX: true,
  });
  wireTileState(dailySource);
  const imageLayer = new OL.layer.Tile({source: dailySource});
  const features = new OL.layer.Tile({
    source: new OL.source.XYZ({
      url: gibsStatic('Reference_Features'),
      crossOrigin: 'anonymous',
      attributions: 'Reference: OpenStreetMap contributors via NASA GIBS',
      maxZoom: 9,
      wrapX: true,
    }),
  });
  const labels = new OL.layer.Tile({
    source: new OL.source.XYZ({
      url: gibsStatic('Reference_Labels'),
      crossOrigin: 'anonymous',
      maxZoom: 9,
      wrapX: true,
    }),
  });
  labelLayers = [features, labels];
  eventSource = new OL.source.Vector({wrapX: true});
  eventLayer = new OL.layer.Vector({source: eventSource, style: eventStyle, zIndex: 30, declutter: true});
  eventOverlay = new OL.Overlay({
    element: eventPopup,
    positioning: 'bottom-center',
    offset: [0, -12],
    stopEvent: true,
    autoPan: {animation: {duration: reduced ? 0 : 220}},
  });
  map = new OL.Map({
    target: 'map',
    layers: [imageLayer, features, labels, eventLayer],
    overlays: [eventOverlay],
    view: new OL.View({center: [0, 0], zoom: 2, minZoom: 2, maxZoom: 9, enableRotation: false, multiWorld: true}),
  });
  map.addControl(new OL.control.ScaleLine({units: 'metric', bar: false, steps: 2, minWidth: 90}));
  map.on('singleclick', (pointerEvent) => {
    const feature = map.forEachFeatureAtPixel(pointerEvent.pixel, (candidate, layer) => layer === eventLayer ? candidate : null, {hitTolerance: 8});
    if (feature) showEventPopup(feature);
    else closeEventPopup(false);
  });
  map.on('pointermove', (pointerEvent) => {
    if (pointerEvent.dragging) return;
    const hit = map.hasFeatureAtPixel(pointerEvent.pixel, {layerFilter: (layer) => layer === eventLayer, hitTolerance: 6});
    map.getTargetElement().style.cursor = hit ? 'pointer' : '';
  });
  setDate(selectedDate);
}

previousDay.addEventListener('click', () => dateShift(-1));
nextDay.addEventListener('click', () => dateShift(1));
latestDay.addEventListener('click', () => setDate(utcToday()));
dateInput.addEventListener('change', () => setDate(dateInput.value));
globalView.addEventListener('click', () => map?.getView().animate({center: [0, 0], zoom: 2, duration: reduced ? 0 : 450}));
toggleLabels.addEventListener('click', () => {
  const visible = toggleLabels.getAttribute('aria-pressed') !== 'true';
  toggleLabels.setAttribute('aria-pressed', String(visible));
  labelLayers.forEach((layer) => layer.setVisible(visible));
});
toggleEvents.addEventListener('click', () => {
  eventsVisible = toggleEvents.getAttribute('aria-pressed') !== 'true';
  toggleEvents.setAttribute('aria-pressed', String(eventsVisible));
  closeEventPopup(false);
  renderEventFeatures();
});
eventFilters.addEventListener('click', (event) => {
  const button = event.target.closest('.event-filter');
  if (!button) return;
  const category = button.dataset.category;
  const visible = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(visible));
  if (visible) enabledCategories.add(category);
  else enabledCategories.delete(category);
  closeEventPopup(false);
  renderEventFeatures();
});
eventList.addEventListener('click', (event) => {
  const button = event.target.closest('.event-list-focus');
  if (!button) return;
  const feature = eventSource?.getFeatureById(button.dataset.eventId);
  if (!feature) return;
  map?.getView().animate({center: feature.getGeometry().getCoordinates(), duration: reduced ? 0 : 320});
  showEventPopup(feature, button);
});
$('eventPopupClose').addEventListener('click', () => closeEventPopup(true));

function setPanelOpen(open, restoreFocus = false) {
  mapPanel.setAttribute('aria-hidden', String(!open));
  mapPanel.inert = !open;
  panelToggle.setAttribute('aria-expanded', String(open));
  if (open) panelClose.focus();
  else if (restoreFocus) panelToggle.focus();
}

panelToggle.addEventListener('click', () => setPanelOpen(panelToggle.getAttribute('aria-expanded') !== 'true'));
panelClose.addEventListener('click', () => setPanelOpen(false, true));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !eventPopup.hidden) {
    event.preventDefault();
    closeEventPopup(true);
  } else if (event.key === 'Escape' && mapPanel.getAttribute('aria-hidden') === 'false') {
    event.preventDefault();
    setPanelOpen(false, true);
  }
});

function refreshLiveData() {
  const today = utcToday();
  dateInput.max = today;
  nextDay.disabled = selectedDate >= today;
  latestDay.disabled = selectedDate === today;
  if (selectedDate === today && dailySource) {
    pendingTiles = 0;
    loadedTiles = 0;
    failedTiles = 0;
    setImageState('Refreshing orbital passes', `${formatLong(today)} · checking NASA GIBS`);
    dailySource.setTileUrlFunction(gibsDailyTileFunction(today), `${today}-${Date.now()}`);
    dailySource.clear();
    dailySource.refresh();
    eventCache.delete(today);
    loadEarthEvents(today);
  }
}

setDate(initialDate);
initMap();
setInterval(refreshLiveData, REFRESH_MS);
