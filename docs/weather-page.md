# Weather Surface

## Purpose

`weather.html` is the public, worldwide weather surface for The Vortex Project. It answers what the atmosphere is likely to do and when for a visitor-selected place. It does not reuse, expose, or infer the private Observatory location.

## Public behavior

- Search accepts worldwide cities and postal locations through Open-Meteo Geocoding.
- A bounded fallback retries without one trailing country or region token when the full query has no result.
- Browser geolocation is requested only after the visitor presses **Use my location**.
- Browser-derived coordinates are never written to the URL or recent-place history.
- Search-selected places receive shareable query-string URLs.
- Up to five search-selected recent places and the unit preference are stored in local storage.
- The **Clear** control removes recent places from local storage.
- Unit switching reloads provider data rather than converting rounded display values.

## Data sources

### Forecast and current conditions

Open-Meteo Forecast API supplies modeled current, hourly, and daily values. Current conditions are labeled as modeled forecast-grid conditions rather than local sensor measurements.

### Air quality

Open-Meteo Air Quality supplies CAMS-derived regional modeled values. The interface explicitly distinguishes these values from neighborhood monitors.

### Official U.S. alerts

Known U.S. search results query the National Weather Service active-alert endpoint by point. The interface distinguishes these states:

- Successful NWS response with active alerts.
- Successful NWS response with no active alerts.
- NWS service failure.
- Country not covered by the page's official-alert integration.
- Browser coordinates without enough country context to claim coverage.

Unsupported coverage is never rendered as “no alerts.” Active alerts move above current conditions; empty, failed, or unsupported alert states follow current conditions.

## Practical timing

`weather-core.js` deterministically derives:

- First meaningful precipitation signal within 48 hours.
- First qualifying three-hour dry window within 36 hours.
- Strongest gust within 24 hours.
- Next sunrise or sunset from the daily forecast.

These are forecast transformations, not AI advice.

## Accessibility and responsive contract

- Semantic search form and labeled combobox.
- Arrow-key and Enter operation for place results.
- Polite status announcements.
- Visible focus states.
- 44px navigation and 48px primary controls.
- No document-level horizontal overflow at 390px.
- Reduced-motion mode removes atmospheric decoration and smooth scrolling.
- The hourly rail remains independently keyboard-scrollable.

## Verification

The initial release was exercised in Chromium through CDP at 1440×900 and 390×844 with live Asheville, Paris, and Tokyo requests. Verification covered:

- 24 hourly and 10 daily entries.
- Practical timing summaries.
- U.S. NWS and unsupported-country alert states.
- Unit reloads.
- Shareable URL restoration.
- Keyboard combobox selection.
- Responsive overflow and target sizes.
- Reduced motion and focus visibility.
- No Weather JavaScript exceptions or failed Weather resources.
- No private Observatory coordinates or identifiers in Weather files.

Pure weather logic has Node tests in `tests/weather-core.test.js`.

## Future seam

Radar and additional environmental layers should use timestamped immutable frames plus a small current manifest. They should not be added to this page until source licensing, latency, coverage, projection, and failure behavior are explicit.
