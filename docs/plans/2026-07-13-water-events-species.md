# Vortex Water, Earth Events, and Species Context Implementation Plan

**Date:** 2026-07-13  
**Scope:** Design alignment pass followed by three approved instruments: USGS water in Weather, USGS/NASA events in Cartographer, and GBIF species context in Observatory.

## Product contract

The four public surfaces keep distinct roles:

- **Field:** ambient, living entry surface.
- **Weather:** public place-based conditions and practical timing.
- **Observatory:** instrument-dense station payload and acoustic layer.
- **Cartographer:** date-aware global spatial context.

Shared visual language:

- One shared 78 px desktop / 68 px mobile shell from `site-shell.css`.
- Green = observed/current state; gold = time, forecast, or selected context; teal = interactive/reference detail.
- Serif display type remains limited to public/editorial surfaces.
- Motion must encode data or state, stop under `prefers-reduced-motion`, and never prevent reading.
- No public feature may expose the Observatory coordinates.

## Release gate 1 — design alignment and tooltip correction

### Task 1: Lock current geometry in a browser regression test

**Files:**
- Create: `tests/browser-layout-check.py`

1. Add a CDP test that opens all four pages at 1440×900 and 390×844.
2. Assert shared header heights are 78 px desktop and 68 px mobile.
3. Assert no page has horizontal overflow.
4. For Observatory desktop, open a `.primary-label .help-trigger` and assert:
   - panel right edge aligns within 2 px of the enclosing `.readout` right edge;
   - panel does not overlap the `.primary-value` bounding box;
   - panel remains inside the viewport.
5. For mobile, assert the tooltip remains the existing full-width bottom sheet.
6. Run the test and confirm the current desktop primary-tooltip assertion fails before changing CSS/JS.

### Task 2: Remove Cartographer shell drift

**Files:**
- Modify: `cartographer.html`

1. Remove redundant local declarations for `.site-head`, `.brand`, `.mark`, `.brand-copy`, `.head-nav`, and their mobile overrides.
2. Keep only Cartographer-specific workspace and map rules.
3. Verify workspace height still uses 78 px desktop / 68 px mobile.
4. Run browser geometry checks.

### Task 3: Correct primary tooltip positioning

**Files:**
- Modify: `observatory.html`

1. Preserve the generic trigger-relative positioning for ordinary metric tooltips.
2. When the trigger is inside `.primary-label`:
   - use the enclosing `.readout` as the horizontal alignment boundary;
   - right-align the panel to the readout;
   - choose a top position that keeps the panel in the viewport;
   - reject any candidate that overlaps `.primary-value`, moving the panel below or beside the value as needed.
3. Do not alter the mobile bottom-sheet path.
4. Re-run browser geometry checks and capture desktop/mobile screenshots.

## Release gate 2 — Weather: observed water nearby

### Data contract

Provider: production USGS Water Services, no API key.

Request:

```text
https://waterservices.usgs.gov/nwis/iv/
  ?format=json
  &bBox=<west,south,east,north>
  &parameterCd=00060,00065
  &period=P2D
  &siteStatus=active
```

Parameter meanings:

- `00060`: discharge
- `00065`: gage height
- `P`: provisional qualifier

The request uses only the visitor-selected Weather coordinates. It is never called for the hidden Observatory location.

### Task 4: Add failing unit tests for water normalization

**Files:**
- Modify: `tests/weather-core.test.js`
- Modify: `weather-core.js`

Add fixtures and tests for:

1. Bounding-box generation near ordinary longitudes and near ±180°.
2. Haversine distance.
3. Grouping separate discharge and gage-height series by USGS site code.
4. Selecting the nearest site with at least one current value.
5. Preserving timestamps, units, parameter codes, station URL, and provisional qualifiers.
6. Trend calculation from recent finite values without inventing missing samples.
7. Empty/malformed service responses.

Run `npm test` and confirm the new tests fail before implementation.

### Task 5: Implement the pure water helpers

**Files:**
- Modify: `weather-core.js`

Export:

- `waterBoundingBox(latitude, longitude, radiusKm)`
- `haversineKm(a, b)`
- `normalizeWaterSeries(payload, selectedPlace)`
- `waterTrend(values)`
- `waterSparkline(values, width, height)`

Requirements:

- Never coerce missing measurements to zero.
- Keep source units from USGS and convert only at render time if necessary.
- Select by distance after normalizing all returned sites.
- Cap the displayed series to the last 48 hours.

### Task 6: Add the USGS request to Weather’s failure-isolated load

**Files:**
- Modify: `weather.js`

1. Add `state.water`.
2. Add a `waterRequest(place)` only for `countryCode === 'US'` or a selected coordinate known to be in the United States.
3. Include water in the existing `Promise.allSettled` call.
4. Forecast remains the only required provider.
5. A USGS failure must not fail weather, air, or alerts.
6. Abort stale water requests when the user changes place.

### Task 7: Build the observed-water instrument

**Files:**
- Modify: `weather.html`
- Modify: `weather.css`
- Modify: `weather.js`

Placement: after current conditions and before forecast timing.

Contents:

- Eyebrow: `OBSERVED WATER`
- Heading: `Water nearby`
- Station name and distance from the selected city point
- Latest discharge and/or gage height
- Observation time and age
- `Provisional` label when any latest qualifier contains `P`
- Direct official USGS station link
- Explicit statement that raw gage height is not a flood-stage interpretation

Motion:

- Draw an inline SVG trace from the recent observations.
- Animate a small highlight along the trace only when new finite observations exist.
- Animation duration may respond to recent change, but line amplitude always represents values.
- Stop the highlight under reduced motion.

Failure/coverage states:

- Outside U.S.: section hidden; provenance states USGS coverage is U.S.-only.
- No active station in search box: show a quiet, bounded no-coverage message.
- Provider failure: show `USGS observations temporarily unavailable` without retry loops.

### Task 8: Update provenance and browser verification

**Files:**
- Modify: `weather.html`
- Modify: `tests/browser-layout-check.py`

1. Add a fourth source card for USGS observed water.
2. Verify no overflow at 1440, 760, 390, and 320 px.
3. Verify keyboard focus reaches station link and no SVG is exposed as an unlabeled control.
4. Verify live Asheville data renders and a non-U.S. place omits the water request.

## Release gate 3 — Cartographer: date-aware Earth events

### Data contract

USGS FDSN query for the selected UTC day:

```text
https://earthquake.usgs.gov/fdsnws/event/1/query
  ?format=geojson
  &starttime=<YYYY-MM-DD>
  &endtime=<next-YYYY-MM-DD>
  &minmagnitude=2.5
  &orderby=time
```

NASA EONET v3:

```text
https://eonet.gsfc.nasa.gov/api/v3/events
  ?start=<YYYY-MM-DD>
  &end=<YYYY-MM-DD>
  &limit=<bounded>
  &category=<category-id>
```

Allowed EONET categories:

- `wildfires`
- `volcanoes`
- `severeStorms`
- `floods`
- `landslides`
- `seaLakeIce`

Do not duplicate EONET’s earthquake category because USGS is authoritative for this layer.

### Task 9: Add failing event-normalization tests

**Files:**
- Create: `cartographer-events.js`
- Create: `tests/cartographer-events.test.js`

Test:

1. Next-day UTC date calculation.
2. USGS GeoJSON normalization with magnitude, depth, reviewed status, tsunami flag, time, and official URL.
3. EONET point and polygon geometry normalization.
4. Selection of the geometry closest to the selected date.
5. Prescribed-fire detection from titles without reclassifying them as emergencies.
6. Reject malformed coordinates and unknown categories.
7. Stable event keys and category counts.

Confirm red tests before implementing the helpers.

### Task 10: Implement event normalization and bounded fetching

**Files:**
- Modify: `cartographer-events.js`
- Modify: `cartographer.html`

1. Import the module from Cartographer.
2. Keep NASA GIBS map initialization unchanged.
3. Fetch USGS plus EONET categories independently with `Promise.allSettled`.
4. Cache normalized results in memory by date.
5. Apply a request generation token so late responses cannot replace a newer selected date.
6. Enforce a per-category result cap and report truncation honestly.

### Task 11: Add map layer, controls, legend, and details

**Files:**
- Modify: `cartographer.html`

1. Add one compact `Events` map toggle.
2. Add category filters and counts in the existing sidebar `datum` stack.
3. On mobile, keep filters in the lower information sheet; do not add another map toolbar row.
4. Add an OpenLayers vector layer for normalized events.
5. Add an accessible details panel after marker selection with:
   - event title;
   - source/provider;
   - observed time;
   - magnitude/depth/area when supplied;
   - prescribed-fire note where applicable;
   - official source link.
6. Marker selection works by pointer and keyboard-accessible event list.

### Task 12: Add meaningful event motion

**Files:**
- Modify: `cartographer.html`

1. Use OpenLayers `postrender` to draw bounded pulse rings around visible point events.
2. Quake ring radius responds to magnitude; timing responds to event age.
3. EONET categories use distinct restrained glyphs/colors, not universal emergency red.
4. Prescribed fires use a neutral gold treatment.
5. Stop the render loop when:
   - events are hidden;
   - no animated point is in view;
   - the tab is hidden;
   - reduced motion is requested.
6. Do not animate polygons continuously.

### Task 13: Verify date, map, and provider behavior

**Files:**
- Modify: `tests/browser-layout-check.py`

Verify:

- Changing date updates imagery and event requests together.
- Today, historical date, and no-event date states.
- USGS failure with EONET success and the reverse.
- Event controls fit mobile.
- Map remains usable with labels hidden.
- No station coordinates or station marker are introduced.

## Release gate 4 — Observatory: GBIF species context

### Data contract

BirdNET source columns:

```text
Date;Time;Sci_Name;Com_Name;Confidence;Lat;Lon;...
```

GBIF requests use `Sci_Name`:

```text
https://api.gbif.org/v1/species/match?name=<scientific-name>
https://api.gbif.org/v1/occurrence/search
  ?taxon_key=<acceptedUsageKey>
  &country=US
  &state_province=Tennessee
  &limit=0
  &facet=month
  &facet_limit=12
```

No station coordinates are sent to GBIF or published.

### Task 14: Extract and test the GBIF cache helper

**Files:**
- Create: `scripts/gbif_species_context.py`
- Create: `tests/test_gbif_species_context.py`
- Modify: `package.json`

Test with Python `unittest`:

1. Exact accepted match normalization.
2. Synonym handling via accepted usage key.
3. Monthly facet normalization into months 1–12 with missing months as zero.
4. Cache freshness using a seven-day TTL.
5. Stale-cache fallback when GBIF is unavailable.
6. Failure isolation for unmatched names.
7. Public output excludes occurrence coordinates and raw records.

Extend `npm test` to run Node tests followed by Python unit tests.

### Task 15: Preserve scientific and common names from BirdNET

**Files:**
- Modify: `scripts/generate_observatory_json.py`

1. Parse column 3 as `scientific_name` and column 4 as `name`.
2. Aggregate top species by stable scientific name while preserving common label.
3. Keep existing visible fields for backward compatibility.
4. Add `scientific_name` to `top_species` and recent detections.
5. Load/update the GBIF cache only for species present in the rolling 24-hour payload.
6. Attach compact context to each top species:
   - accepted scientific name;
   - family;
   - order;
   - GBIF taxon key;
   - Tennessee record count;
   - twelve monthly aggregate counts;
   - cache update time;
   - GBIF species URL.
7. Keep the prior cached context when GBIF is down.

Cache file:

- Create at runtime: `data/gbif_species_context.json`
- Track in git because the static site and cron are already a versioned data pipeline.
- Never store raw occurrence records.

### Task 16: Render species context in the acoustic layer

**Files:**
- Modify: `observatory.html`

1. Keep the current detection count, species count, recent sequence, and activity ranking.
2. Make each enriched ranking row expandable or selectable without turning the whole section into cards.
3. Show:
   - common and scientific name;
   - family;
   - Tennessee GBIF occurrence-record total;
   - twelve-month miniature rhythm;
   - official GBIF link.
4. Label the chart `submitted Tennessee occurrence records by month`.
5. State explicitly that it is not abundance, a local presence claim, or a migration forecast.
6. Keep BirdNET classifications labeled machine-generated and not human-verified.

Motion:

- Use a slow scan/highlight across the twelve month bars, anchored on the current month.
- Motion indicates the calendar position only; bar height carries the record count.
- Stop under reduced motion.

### Task 17: Validate the cron path without pushing

**Files:**
- Modify: `scripts/generate_observatory_json.py`

1. Run with `OBSERVATORY_NO_PUSH=1`.
2. Validate JSON schema-like invariants in a separate check:
   - no `lat`, `lon`, `latitude`, `longitude`, or raw geometry in bird context;
   - top species retain visible names and counts;
   - monthly arrays have exactly 12 non-negative integers;
   - cache failure does not remove BirdNET data.
3. Restore the real generated payload if a fixture run changes it unexpectedly.

## Release gate 5 — integrated review and production

### Task 18: Full automated verification

Run:

```bash
npm test
python3 tests/browser-layout-check.py
python3 -m py_compile scripts/generate_observatory_json.py scripts/gbif_species_context.py
OBSERVATORY_NO_PUSH=1 python3 scripts/generate_observatory_json.py
```

Also verify:

- no mixed-content requests;
- no console errors;
- no external API keys added to browser code;
- no private coordinates in HTML/JS/JSON additions;
- every provider has visible provenance and an isolated failure state;
- all motion stops under reduced motion.

### Task 19: Independent review

Request one independent review covering:

- correctness of USGS/EONET/GBIF semantics;
- privacy boundary;
- stale response races;
- accessibility and reduced motion;
- mobile control density;
- overclaiming in labels.

Fix all high/medium findings and rerun tests.

### Task 20: Deploy and verify production

1. Commit all code and generated cache/payload changes.
2. Push `main`.
3. Wait for GitHub Pages deployment.
4. Verify production at all four URLs with desktop/mobile screenshots.
5. Re-run live API smoke checks from the production origin.
6. Confirm the Observatory cron can refresh the new cache and push normally.
7. Record the completed build in the Holo and the Vortex Obsidian session log.
