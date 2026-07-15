import {
  buildEonetUrls,
  buildEarthquakeUrl,
  dayBounds,
  eventCategoryCounts,
  normalizeEonet,
  normalizeEarthquakes,
} from './cartographer-events.js';
import {
  buildBlueMarbleUrl,
  buildGibsImageUrl,
  imageDimensions,
  productForDate,
  projectToOrbitalFrame,
} from './cartographer-view.js';

const $ = (id) => document.getElementById(id);
const dateInput = $('imageDate');
const previousDay = $('previousDay');
const nextDay = $('nextDay');
const latestDay = $('latestDay');
const orbitalFrame = $('orbitalFrame');
const orbitalImage = $('orbitalImage');
const imageState = $('imageState');
const frameState = $('frameState');
const frameBrief = $('frameBrief');
const coverageState = $('coverageState');
const sourceImageLink = $('sourceImageLink');
const eventCount = $('eventCount');
const eventStatus = $('eventStatus');
const eventFilters = $('eventFilters');
const eventMarkerLayer = $('eventMarkerLayer');
const eventLedger = $('eventLedger');
const eventInspector = $('eventInspector');
const eventInspectorClose = $('eventInspectorClose');
const eventLedgerMore = $('eventLedgerMore');

const MIN_DATE = '2000-02-24';
const REFRESH_MS = 300000;
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
const MAP_MARKER_LIMITS = Object.freeze({
  earthquake: 20,
  wildfires: 30,
  volcanoes: 12,
  severeStorms: 12,
  landslides: 12,
  seaLakeIce: 12,
});
const LEDGER_PAGE_SIZE = 36;

const utcToday = () => new Date().toISOString().slice(0, 10);
const validDate = (value) => Boolean(dayBounds(value)) && value >= MIN_DATE && value <= utcToday() && Boolean(productForDate(value));
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
let requestedImageWidth = 0;
let imageRequestId = 0;
let imageMode = 'daily';
let resizeTimer = 0;
let eventAbort;
let eventLoadId = 0;
let eventRecords = [];
let eventProviderNote = '';
let selectedEventId = null;
let selectedEventOpener = null;
let ledgerLimit = LEDGER_PAGE_SIZE;
const eventCache = new Map();
const enabledCategories = new Set(Object.keys(EVENT_COLORS));

function setImageState(title, detail) {
  imageState.replaceChildren();
  const heading = document.createElement('b');
  const text = document.createElement('span');
  heading.textContent = title;
  text.textContent = detail;
  imageState.append(heading, text);
}

function requestedWidth() {
  const physicalWidth = Math.round(orbitalFrame.getBoundingClientRect().width * Math.max(1, window.devicePixelRatio || 1));
  return imageDimensions(physicalWidth).width;
}

function updateProductMetadata(product) {
  $('imagePlatform').textContent = product.platform;
  $('imageInstrument').textContent = product.instrument;
  $('imageResolution').textContent = product.resolution;
  $('imageDateLong').textContent = formatLong(selectedDate);
  $('imageProvenance').textContent = `${product.instrument} aboard ${product.platform} · NASA GIBS`;
  $('imageProduct').textContent = 'Corrected Reflectance · True Color';
}

function updateBaselineMetadata() {
  $('imagePlatform').textContent = 'NASA composite';
  $('imageInstrument').textContent = 'Blue Marble';
  $('imageResolution').textContent = '500 m nominal';
  $('imageDateLong').textContent = 'Timeless baseline';
  $('imageProvenance').textContent = 'NASA Blue Marble · timeless baseline';
  $('imageProduct').textContent = 'Blue Marble · Next Generation';
}

function requestDailyImage(force = false) {
  const product = productForDate(selectedDate);
  if (!product) return;
  const width = requestedWidth();
  if (!force && requestedImageWidth && Math.abs(width - requestedImageWidth) < 320) return;
  requestedImageWidth = width;
  const requestId = ++imageRequestId;
  const dailyUrl = buildGibsImageUrl(selectedDate, width);
  imageMode = 'daily';
  updateProductMetadata(product);
  orbitalImage.classList.remove('is-ready');
  orbitalImage.alt = `${formatLong(selectedDate)} NASA corrected-reflectance true-color world image from ${product.instrument} aboard ${product.platform}, cropped from 90 degrees north to 66 degrees south.`;
  frameState.textContent = 'Loading';
  frameBrief.textContent = `${product.platform} / ${product.instrument} · ${formatLong(selectedDate)} · fixed EPSG:4326 frame`;
  coverageState.textContent = 'Loading daily pass';
  setImageState('Loading daily observation', `${formatLong(selectedDate)} · ${product.platform} / ${product.instrument}`);
  orbitalImage.onload = () => {
    if (requestId !== imageRequestId) return;
    orbitalImage.classList.add('is-ready');
    if (imageMode === 'daily') {
      frameState.textContent = 'Observed';
      coverageState.textContent = 'Daily pass ready';
      frameBrief.textContent = `${product.platform} / ${product.instrument} · ${formatLong(selectedDate)} · source-native observation`;
      setImageState('Daily image ready', `${formatLong(selectedDate)} · ${product.platform} / ${product.instrument} · ${width}px request`);
    } else {
      orbitalImage.alt = 'NASA Blue Marble timeless world baseline shown because the selected daily observation was unavailable.';
      frameState.textContent = 'Baseline';
      coverageState.textContent = 'Timeless fallback';
      frameBrief.textContent = `Daily image unavailable · NASA Blue Marble baseline · selected date remains ${formatLong(selectedDate)}`;
      setImageState('Baseline image', 'Daily observation could not be decoded. Showing timeless NASA Blue Marble, clearly separated from the selected date.');
    }
  };
  orbitalImage.onerror = () => {
    if (requestId !== imageRequestId) return;
    if (imageMode === 'daily') {
      imageMode = 'baseline';
      updateBaselineMetadata();
      sourceImageLink.href = buildBlueMarbleUrl(width);
      orbitalImage.src = sourceImageLink.href;
      return;
    }
    orbitalImage.classList.remove('is-ready');
    frameState.textContent = 'Unavailable';
    coverageState.textContent = 'Image unavailable';
    setImageState('Image unavailable', 'NASA GIBS did not return a decodable daily image or baseline. Public event records remain available below.');
  };
  sourceImageLink.href = dailyUrl;
  const url = new URL(dailyUrl);
  if (selectedDate === utcToday()) url.searchParams.set('_', String(Date.now()));
  orbitalImage.src = url.href;
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
  previousDay.disabled = value <= MIN_DATE;
  nextDay.disabled = value >= utcToday();
  latestDay.disabled = value === utcToday();
  requestedImageWidth = 0;
  ledgerLimit = LEDGER_PAGE_SIZE;
  clearSelectedEvent(false);
  requestDailyImage(true);
  loadEarthEvents(value);
  const url = new URL(location.href);
  url.searchParams.set('date', value);
  history.replaceState({}, '', url);
}

function eventDateTime(event) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(event.time));
}

function eventDetail(event) {
  const parts = [eventDateTime(event)];
  if (event.category === 'earthquake') {
    if (Number.isFinite(event.depthKm)) parts.push(`${displayNumber(event.depthKm, 1, ' km')} depth`);
    if (event.status) parts.push(event.status);
  } else if (event.status) {
    parts.push(event.status);
  }
  return parts.join(' · ');
}

function sortedEvents(events) {
  return [...events].sort((a, b) => Date.parse(b.time) - Date.parse(a.time) || a.title.localeCompare(b.title));
}

function updateSelectedState() {
  document.querySelectorAll('[data-event-id]').forEach((control) => {
    const selected = control.dataset.eventId === selectedEventId;
    control.setAttribute('aria-pressed', String(selected));
    control.closest('.event-row')?.classList.toggle('is-selected', selected);
  });
}

function selectEvent(event, opener = null) {
  selectedEventId = event.id;
  selectedEventOpener = opener;
  $('eventInspectorLabel').textContent = `${event.provider} · ${EVENT_LABELS[event.category] || event.category}`;
  $('eventInspectorTitle').textContent = event.title;
  $('eventInspectorDetail').textContent = eventDetail(event);
  $('eventInspectorLink').href = event.url;
  eventInspector.hidden = false;
  updateSelectedState();
}

function clearSelectedEvent(restoreFocus = true) {
  const opener = selectedEventOpener;
  selectedEventId = null;
  selectedEventOpener = null;
  eventInspector.hidden = true;
  updateSelectedState();
  if (restoreFocus && opener?.isConnected) opener.focus();
}

function createMarker(event, position) {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'event-marker';
  marker.dataset.category = event.category;
  marker.dataset.eventId = event.id;
  marker.style.left = `${position.x}%`;
  marker.style.top = `${position.y}%`;
  marker.style.setProperty('--event-color', EVENT_COLORS[event.category] || EVENT_COLORS.earthquake);
  marker.setAttribute('aria-label', `${EVENT_LABELS[event.category] || event.category}: ${event.title}. ${eventDateTime(event)}`);
  marker.setAttribute('aria-pressed', String(event.id === selectedEventId));
  marker.title = event.title;
  marker.addEventListener('click', () => selectEvent(event, marker));
  return marker;
}

function createLedgerRow(event, inFrame) {
  const item = document.createElement('li');
  const focus = document.createElement('button');
  const title = document.createElement('strong');
  const detail = document.createElement('span');
  const link = document.createElement('a');
  item.className = 'event-row';
  item.dataset.category = event.category;
  item.classList.toggle('is-selected', event.id === selectedEventId);
  focus.type = 'button';
  focus.className = 'event-ledger-focus';
  focus.dataset.category = event.category;
  focus.dataset.eventId = event.id;
  focus.setAttribute('aria-pressed', String(event.id === selectedEventId));
  title.textContent = event.title;
  detail.textContent = `${EVENT_LABELS[event.category] || event.category} · ${eventDateTime(event)}${inFrame ? '' : ' · south of image frame'}`;
  focus.append(title, detail);
  focus.addEventListener('click', () => selectEvent(event, focus));
  link.className = 'event-source-link';
  link.href = event.url;
  link.rel = 'external';
  link.textContent = '↗';
  link.setAttribute('aria-label', `Open provider record for ${event.title}`);
  item.append(focus, link);
  return item;
}

function renderEvents() {
  const counts = eventCategoryCounts(eventRecords);
  eventFilters.querySelectorAll('.event-filter').forEach((button) => {
    button.querySelector('b').textContent = String(counts[button.dataset.category] || 0);
  });
  const visible = sortedEvents(eventRecords.filter((event) => enabledCategories.has(event.category)));
  eventMarkerLayer.replaceChildren();
  eventLedger.replaceChildren();
  const mappedByCategory = {};
  let mapped = 0;
  for (const event of visible) {
    const position = projectToOrbitalFrame(event.coordinates);
    const categoryMapped = mappedByCategory[event.category] || 0;
    if (position && categoryMapped < (MAP_MARKER_LIMITS[event.category] || 12)) {
      eventMarkerLayer.append(createMarker(event, position));
      mappedByCategory[event.category] = categoryMapped + 1;
      mapped += 1;
    }
  }
  visible.slice(0, ledgerLimit).forEach((event) => {
    eventLedger.append(createLedgerRow(event, Boolean(projectToOrbitalFrame(event.coordinates))));
  });
  if (!visible.length) {
    const empty = document.createElement('li');
    empty.className = 'event-ledger-empty';
    empty.textContent = eventRecords.length ? 'All event categories are currently hidden.' : 'No qualifying public events returned for this date window.';
    eventLedger.append(empty);
  }
  if (selectedEventId && !visible.some((event) => event.id === selectedEventId)) clearSelectedEvent(false);
  eventLedgerMore.hidden = visible.length <= ledgerLimit;
  eventLedgerMore.textContent = eventLedgerMore.hidden ? 'Show more events' : `Show more events · ${visible.length - ledgerLimit} remaining`;
  eventCount.textContent = `${mapped} mapped · ${visible.length} records`;
  eventStatus.textContent = eventRecords.length
    ? `${counts.earthquake || 0} USGS quakes · ${eventRecords.length - (counts.earthquake || 0)} EONET events${eventProviderNote}`
    : `No qualifying events returned for this date window${eventProviderNote}`;
  updateSelectedState();
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
    renderEvents();
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
    if (request.category === 'earthquake') records.push(...normalizeEarthquakes(result.value, dateValue));
    else records.push(...normalizeEonet(result.value, dateValue, request.category));
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
  if (truncated.length) notes.push(`provider limit reached for ${truncated.join(', ')}`);
  eventProviderNote = notes.length ? ` · ${notes.join(' · ')}` : '';
  if (!failed.length && !truncated.length) {
    eventCache.set(dateValue, {records, note: eventProviderNote});
    trimEventCache();
  }
  renderEvents();
}

previousDay.addEventListener('click', () => dateShift(-1));
nextDay.addEventListener('click', () => dateShift(1));
latestDay.addEventListener('click', () => setDate(utcToday()));
dateInput.addEventListener('change', () => setDate(dateInput.value));
eventFilters.addEventListener('click', (event) => {
  const button = event.target.closest('.event-filter');
  if (!button) return;
  const category = button.dataset.category;
  const visible = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(visible));
  if (visible) enabledCategories.add(category);
  else enabledCategories.delete(category);
  ledgerLimit = LEDGER_PAGE_SIZE;
  renderEvents();
});
eventLedgerMore.addEventListener('click', () => {
  ledgerLimit += LEDGER_PAGE_SIZE;
  renderEvents();
});
eventInspectorClose.addEventListener('click', () => clearSelectedEvent(true));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !eventInspector.hidden) {
    event.preventDefault();
    clearSelectedEvent(true);
  }
});
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => requestDailyImage(false), 220);
}, {passive: true});

function refreshLiveData() {
  const today = utcToday();
  dateInput.max = today;
  nextDay.disabled = selectedDate >= today;
  latestDay.disabled = selectedDate === today;
  if (selectedDate === today) {
    eventCache.delete(today);
    requestDailyImage(true);
    loadEarthEvents(today);
  }
}

setDate(initialDate);
setInterval(refreshLiveData, REFRESH_MS);
