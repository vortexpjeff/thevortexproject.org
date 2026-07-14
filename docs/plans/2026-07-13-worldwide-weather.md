# Worldwide Weather Implementation Plan

> **For Hermes:** Implement this plan phase-by-phase with unit tests, browser verification, independent review, and a production hash check.

**Goal:** Add a worldwide, location-driven Weather surface that gives clear forecast timing, air-quality context, and official U.S. alerts while preserving the Observatory’s private-location boundary.

**Architecture:** Keep the site static and dependency-light. Put pure WMO interpretation, wind/AQI categories, hourly-window analysis, and provider-response normalization in `weather-core.js`; use `weather.js` only for API access, browser state, and DOM rendering. Open-Meteo supplies worldwide search/forecast/AQ during this public, noncommercial phase; NWS supplies official U.S. alerts. The public location state is never read by or written into `data/observatory.json`.

**Tech Stack:** Semantic HTML, CSS, browser ES modules, Node 22 built-in test runner, Open-Meteo geocoding/forecast/AQ APIs, NWS GeoJSON alerts.

---

### Phase 1: Pure weather logic

**Files:**
- Create: `package.json`
- Create: `weather-core.js`
- Create: `tests/weather-core.test.js`

**Work:**
1. Write failing tests for WMO codes, wind direction, AQ categories, next-rain timing, dry-window detection, strongest gust, and normalized hourly rows.
2. Implement only the pure functions needed by those tests.
3. Run `node --test` and require all tests to pass.

### Phase 2: Weather surface

**Files:**
- Create: `weather.html`
- Create: `weather.css`
- Create: `weather.js`

**Work:**
1. Build semantic search, alert, current-condition, timing, hourly, daily, AQ, and provenance regions.
2. Add accessible combobox/listbox search behavior with stale-request cancellation.
3. Fetch worldwide forecast and AQ data; fetch NWS alerts only for explicit U.S. search results.
4. Add deterministic summaries, metric/U.S. unit toggle, recent-place local storage, optional click-triggered geolocation, error/empty/loading states, and stale-source labeling.
5. Keep times in the selected place’s timezone and distinguish observation/update/browser times.

### Phase 3: Shared navigation

**Files:**
- Modify: `index.html`
- Modify: `observatory.html`
- Modify: `cartographer.html`
- Modify: `site-shell.css`

**Work:**
1. Add Weather in the synchronized order `Field / Weather / Observatory / Cartographer`.
2. Keep the current page as a non-link with `aria-current="page"`.
3. Preserve 44px targets and fit all four destinations at 390px without horizontal page overflow.

### Phase 4: Verification

**Checks:**
1. `node --test`
2. Extract page module scripts where applicable and run syntax checks.
3. Serve locally and verify real API responses for multiple U.S. and international places.
4. Verify keyboard search, focus states, unit switching, recent places, geolocation denial handling, empty alerts, official-alert coverage wording, and source timestamps.
5. Verify desktop `1440×900`, mobile `390×844`, and reduced motion.
6. Check every public file and request path for private Observatory coordinates, settlement names, station markers, and source-grid identifiers.
7. Run an independent diff review.
8. Commit exact files, push, compare local/production hashes, and rerun canonical browser checks on `https://www.thevortexproject.org/`.

### Phase 5: Documentation

**Files:**
- Create: `docs/weather-data-contract.md`
- Modify the Vortex website skill reference if implementation findings change the documented procedure.
- Append the Observatory project session log in Obsidian.

**Work:**
1. Record provider roles, noncommercial terms, source times, limitations, privacy boundary, and future radar seam.
2. Record the verified deployment in Holographic Memory and the Obsidian session log.

## Explicitly deferred

- Radar ingestion or map animation
- Global official-alert aggregation
- Accounts or cloud-synchronized places
- Earth Engine operational layers
- Framework migration
- Monetization, advertising, billing, or premium tiers
