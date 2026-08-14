# 🚀 WindBorne Project — Feature Ideas & Roadmap

> **Based on**: [WindBorne Systems API Docs](https://api.windbornesystems.com/) &
> current project state as of August 2026.  
> WeatherMesh-6 (the most skillful global model to date) was just released — many
> ideas below leverage its new capabilities.

---

## Table of Contents

1. [Data & Forecast Features](#1-data--forecast-features)
2. [Visualization & Map Enhancements](#2-visualization--map-enhancements)
3. [UX / UI Improvements](#3-ux--ui-improvements)
4. [Analytics & Insights](#4-analytics--insights)
5. [Alerts & Notifications](#5-alerts--notifications)
6. [Integration & Export Features](#6-integration--export-features)
7. [Performance & Infrastructure](#7-performance--infrastructure)
8. [Priority Summary Table](#8-priority-summary-table)

---

## 1. Data & Forecast Features

### 1.1 Multi-Variable Atmospheric Profile (Vertical Sounding)
**What**: Use the WeatherMesh `point_forecast` endpoint to fetch atmospheric data at
multiple pressure levels (1000 hPa to 10 hPa) and render a Skew-T / Log-P
vertical sounding chart for the selected balloon's current position.

**Why**: Balloons are stratospheric instruments — showing only surface weather
data (temperature_2m, wind_speed_10m) misses the story. A vertical profile shows
exactly what the balloon is flying through.

**API fields to use**:
```
temperature at 500hPa, 250hPa, 100hPa, 50hPa
wind_u / wind_v at multiple pressure levels
relative_humidity
geopotential_height
```

**Complexity**: Medium — requires a charting library (recharts or d3) and
multiple stacked API calls per balloon click.

---

### 1.2 Precipitation Forecast Timeline (Next 72 h)
**What**: Fetch hourly `precipitation` and `precipitation_probability` from
WeatherMesh for each active balloon's ground-projection coordinates and display a
bar/line chart inside the balloon detail panel.

**Why**: Users can quickly see if a balloon is flying over an active storm system
and correlate balloon drift with precipitation events.

**API fields to use**:
```
precipitation
precipitation_probability
```

**Complexity**: Low — data already partially fetched; needs chart component only.

---

### 1.3 Jet Stream Overlay (Upper-Level Wind Field)
**What**: Query wind_u_100m and wind_v_100m across a lat/lon grid and render an
animated wind particle field on the globe (similar to Windy.com) using WebGL
or deck.gl.

**Why**: Jet streams heavily influence stratospheric balloon flight paths. An
animated overlay makes this correlation immediately visual.

**Complexity**: High — requires grid data fetching + WebGL particle system.

---

### 1.4 WeatherMesh-6 Model Comparison Panel
**What**: Side-by-side forecast comparison between WeatherMesh-6 (latest) and
WeatherMesh (v1) for a selected point, showing accuracy deltas in temperature,
wind, and precipitation.

**Why**: WindBorne just released WeatherMesh-6 — highlighting its improved skill
vs. the previous model (and vs. GFS/ECMWF) is a compelling user-facing feature.

**API**: Use version routing (`/forecasts/version_1/` vs `/forecasts/version_2/`)
already documented in the API schema.

**Complexity**: Medium.

---

### 1.5 Balloon Trajectory Prediction (Forward Simulation)
**What**: Use retrieved wind vectors (wind_u, wind_v) at the balloon's current
altitude and project a predicted future path for the next 6–24 hours as a
dashed polyline on the globe.

**Why**: Purely historical paths are shown today. Predictive paths would add huge
operational value — where is this balloon going?

**Algorithm**:
```
for each hour_step in [1..24]:
    new_lat = current_lat + (wind_v_at_altitude * delta_t / R_earth)
    new_lon = current_lon + (wind_u_at_altitude * delta_t / (R_earth * cos(lat)))
```

**Complexity**: Medium — math is straightforward; integration with the globe
renderer needs care.

---

### 1.6 Real-Time In-Situ Observation Data from Balloons
**What**: The WindBorne API exposes raw in-situ measurements from the balloon
constellation (temperature, humidity, pressure, wind at flight altitude). Surface
these directly in the UI alongside WeatherMesh model data so users can see where
the model agrees/disagrees with the balloon sensor.

**Why**: This is WindBorne's core scientific value proposition — the balloons *are*
the sensors. The current app only uses balloons as map markers and uses WeatherMesh
for weather, never crossing the two.

**Complexity**: Medium — data structure mapping required.

---

## 2. Visualization & Map Enhancements

### 2.1 Heatmap of Balloon Density / Coverage
**What**: Render a heatmap layer on the globe showing where WindBorne balloons have
historically concentrated (24 h telemetry aggregated by grid cell), with opacity
encoding density.

**Why**: Immediately answers "which parts of the world have the most real-time
atmospheric coverage?" — a key marketing and scientific insight.

**Complexity**: Low — use MapLibre `heatmap` layer type on the existing telemetry.

---

### 2.2 3D Altitude Ribbon Visualization
**What**: Extrude balloon flight paths into 3D ribbons in globe space, with ribbon
height = balloon altitude and color = temperature or wind speed at that point.

**Why**: Currently paths are flat polylines on the globe surface. True 3D ribbons
would make altitude changes visible without clicking into a detail panel.

**Complexity**: Medium — requires deck.gl PathLayer or custom MapLibre 3D source.

---

### 2.3 Cloud Cover Layer (Satellite Imagery Blend)
**What**: Overlay near-real-time satellite cloud imagery (e.g., from NASA Worldview
GIBS tiles) blended with the WeatherMesh cloud cover forecast layer, with a
time-scrub slider for +/- 12 h.

**Why**: Visual correlation between satellite imagery and model cloud cover
demonstrates forecast accuracy in real time.

**Complexity**: Medium — tile layer + time slider component.

---

### 2.4 Extreme Weather Event Markers
**What**: Poll WeatherMesh for grid cells exceeding configurable thresholds
(wind > 50 kt, temperature anomaly > 10 C, CAPE > 2500 J/kg) and place pulsing
alert markers on the map at those locations.

**Why**: Transforms a passive visualization into an active global weather dashboard.

**Complexity**: Medium — threshold logic + marker management.

---

### 2.5 Day/Night Terminator Overlay
**What**: Render the real-time solar terminator (day/night boundary) as a
translucent overlay on the globe, updating every minute.

**Why**: Balloons often behave differently at night (thermal contraction). The
day/night context is directly relevant to balloon operations.

**Complexity**: Low — solar position formula + MapLibre fill layer.

---

### 2.6 Animated Playback of 24-Hour Mission
**What**: Add a timeline scrubber (slider + play/pause/speed controls) that
animates balloon positions through all 24 hourly snapshots, moving each marker
along its recorded path in real time.

**Why**: Currently only the full static path is shown. Playback shows the story
of each mission chronologically.

**Complexity**: Medium — requires timestamp alignment fix (see PROJECT_REVIEW_AND_FEEDBACK.md
item #2) + animation loop.

---

## 3. UX / UI Improvements

### 3.1 Toast Notification System
**What**: Replace silent fallback behavior with a toast notification library (e.g.,
react-hot-toast) that displays:
- "⚠️ Python backend offline — using direct telemetry"
- "✅ WeatherMesh-6 data loaded"
- "🔑 API key missing — weather layers disabled"

**Why**: Users currently have no idea when the system degrades gracefully. Toasts
make system state transparent.

**Complexity**: Low — `npm install react-hot-toast` + call sites in API routes.

---

### 3.2 Advanced Balloon Filter Panel
**What**: Expand the search bar into a filter panel with:
- Altitude range slider (e.g., 15–25 km)
- Active / lost signal toggle
- Region bounding box selector
- Color-coding by altitude band

**Why**: With many balloons on the map, users need structured filtering to find
specific balloons of interest.

**Complexity**: Low–Medium.

---

### 3.3 Balloon Detail Dashboard (Expanded Panel)
**What**: Replace the current minimal balloon info card with a full-width slide-out
drawer containing:
- Altitude vs. time sparkline
- Current wind speed / direction gauge
- Temperature trend
- Estimated remaining flight time (based on historical descent rates)
- "Share this balloon" deep-link button

**Why**: The current panel shows altitude, coordinates, and point count — far below
what the data supports.

**Complexity**: Medium.

---

### 3.4 Multi-Language Support (i18n)
**What**: Add internationalization using `next-intl` with at minimum English,
Spanish, French, and Japanese locale files.

**Why**: Windborne operates a global constellation. Localized UI increases
accessibility for international research teams.

**Complexity**: Medium — requires string extraction + locale files.

---

### 3.5 Progressive Web App (PWA) Support
**What**: Add a `manifest.json`, service worker, and offline cache strategy so the
app can be installed on mobile devices and works with cached data when offline.

**Why**: Field meteorologists may need access in low-connectivity environments.

**Complexity**: Low — Next.js PWA plugin (`next-pwa`).

---

## 4. Analytics & Insights

### 4.1 Flight Statistics Dashboard
**What**: A dedicated `/stats` page showing:
- Total active balloons today
- Average altitude across fleet
- Total km of telemetry recorded (last 24 h)
- Regional coverage heatmap
- Longest active flight time

**Why**: Aggregate operational statistics give context to the individual balloon
data and demonstrate the scale of the constellation.

**Complexity**: Low — computed from existing telemetry data.

---

### 4.2 AI-Powered Weather Summary (LLM Integration)
**What**: For a selected balloon's location, call an LLM (e.g., Gemini API) with
the WeatherMesh forecast data and return a natural-language weather briefing:

> "At 18.5 km altitude over the South Atlantic, winds are from the west at 85 kt.
> Temperatures are -62 C. No significant precipitation expected."

**Why**: Makes atmospheric data accessible to non-meteorologists.

**Complexity**: Medium — API integration + prompt engineering.

---

### 4.3 Anomaly Detection
**What**: Flag balloons that exhibit unexpected behavior:
- Rapid altitude drop (> 500 m/hr descent)
- Unexpected trajectory deviation vs. WeatherMesh wind prediction
- Signal gap > 2 hours

**Why**: Operational monitoring use case — alerts teams when a balloon may be
malfunctioning or about to land.

**Complexity**: Medium — statistical thresholds on telemetry stream.

---

## 5. Alerts & Notifications

### 5.1 Browser Push Notifications
**What**: Let users subscribe to alerts for specific balloons:
- "Balloon WB-7 is descending — expected landing in 45 min"
- "WeatherMesh data updated for your tracked balloon"

**Technology**: Web Push API + service worker + a lightweight notification backend.

**Complexity**: High — requires push subscription management.

---

### 5.2 Email / Webhook Alerts
**What**: Allow users to register a webhook URL or email address to receive alerts
when a balloon enters a specified geographic bounding box or altitude range.

**Complexity**: High — requires user auth + backend scheduling.

---

## 6. Integration & Export Features

### 6.1 GPX / KML Export
**What**: Add an "Export Track" button on each balloon detail panel that downloads
the balloon's 24-hour flight path as:
- `.gpx` (GPS Exchange Format)
- `.kml` (Google Earth)
- `.geojson`

**Why**: Researchers and aviation communities work with these standard formats.

**Complexity**: Low — pure data transformation, no external APIs.

---

### 6.2 Deep Link Sharing
**What**: Encode the current map state (center, zoom, selected balloon, active
layers) into the URL hash so sharing a URL restores the exact view.

**Example**:
```
https://your-app.com/#lat=23.5&lon=-45.2&balloon=WB-12&layers=radar,wind
```

**Complexity**: Low — URL hash parsing + state sync.

---

### 6.3 Public REST API for Third-Party Access
**What**: Expose a documented public API endpoint (`/api/v1/balloons`,
`/api/v1/weather/{lat}/{lon}`) with rate limiting and optional API key auth, so
external tools (dashboards, research scripts) can consume the data.

**Complexity**: Medium — rate limiting middleware + OpenAPI documentation.

---

### 6.4 Integration with Space Weather APIs (NOAA SWPC)
**What**: Overlay NOAA Space Weather Prediction Center data (Kp-index, aurora
probability) as a layer on the globe. High-altitude balloons are directly
affected by space weather.

**API**: NOAA SWPC JSON feeds (https://services.swpc.noaa.gov/)

**Complexity**: Low — additional tile/data layer.

---

## 7. Performance & Infrastructure

### 7.1 Edge Caching with Vercel / Cloudflare
**What**: Cache WeatherMesh API responses at the CDN edge layer with a 5-minute
TTL using Vercel Edge Config or Cloudflare Cache API, reducing backend load.

**Why**: Every map click currently triggers a fresh backend + WeatherMesh call.

**Complexity**: Low–Medium.

---

### 7.2 WebSocket Real-Time Updates
**What**: Replace the 60-second `setInterval` polling in `page.tsx` with a
WebSocket connection to the FastAPI backend (websockets + asyncio), pushing
updates only when new balloon data is available.

**Why**: Reduces unnecessary network requests and delivers updates the moment data
changes rather than on a fixed clock cycle.

**Complexity**: Medium.

---

### 7.3 PostgreSQL + TimescaleDB Telemetry Storage
**What**: Persist balloon telemetry into a TimescaleDB hypertable instead of
re-fetching all 24 hours of JSON on every backend restart. This enables:
- Historical queries beyond 24 hours
- Efficient time-range queries
- Anomaly detection queries

**Complexity**: High — requires database setup + migration.

---

### 7.4 End-to-End Test Suite
**What**: Add Playwright E2E tests covering:
- Globe renders correctly
- Clicking a balloon opens the detail panel
- Weather layers toggle on/off
- Search returns valid results

**Complexity**: Medium — testing infrastructure.

---

## 8. Priority Summary Table

| Priority | ID  | Feature                              | Effort | Impact |
|:--------:|:----|:-------------------------------------|:------:|:------:|
| 🔴 P0   | 3.1 | Toast Notification System            | Low    | High   |
| 🔴 P0   | 2.6 | 24-Hour Animated Playback            | Medium | High   |
| 🔴 P0   | 1.5 | Balloon Trajectory Prediction        | Medium | High   |
| 🟠 P1   | 1.1 | Vertical Sounding Chart              | Medium | High   |
| 🟠 P1   | 1.2 | Precipitation Forecast Timeline      | Low    | Medium |
| 🟠 P1   | 2.1 | Balloon Density Heatmap              | Low    | Medium |
| 🟠 P1   | 3.3 | Balloon Detail Dashboard             | Medium | High   |
| 🟡 P2   | 1.3 | Jet Stream / Wind Field Overlay      | High   | High   |
| 🟡 P2   | 1.6 | In-Situ vs. Model Comparison         | Medium | High   |
| 🟡 P2   | 6.1 | GPX / KML Export                     | Low    | Medium |
| 🟡 P2   | 6.2 | Deep Link Sharing                    | Low    | Medium |
| 🟡 P2   | 4.2 | AI Weather Summary (LLM)             | Medium | Medium |
| 🟢 P3   | 2.2 | 3D Altitude Ribbon                   | High   | Medium |
| 🟢 P3   | 2.5 | Day/Night Terminator Overlay         | Low    | Low    |
| 🟢 P3   | 4.1 | Flight Statistics Dashboard          | Low    | Medium |
| 🟢 P3   | 7.2 | WebSocket Real-Time Updates          | Medium | Medium |
| 🔵 P4   | 7.3 | TimescaleDB Telemetry Storage        | High   | High   |
| 🔵 P4   | 5.1 | Browser Push Notifications           | High   | Medium |
| 🔵 P4   | 6.3 | Public REST API                      | Medium | Medium |

---

## Quick Wins (< 1 Day Each)

These can be implemented immediately with minimal risk:

1. **Toast notifications** (`react-hot-toast`) for backend status
2. **GPX export** button — pure JSON-to-GPX string conversion
3. **Deep link URL hash** — encode map state into `window.location.hash`
4. **Day/Night terminator** — 20-line solar position formula + MapLibre fill layer
5. **Balloon density heatmap** — one MapLibre `heatmap` layer on existing data
6. **Precipitation timeline chart** — `recharts` bar chart from already-fetched data

---

## API Endpoints Leveraged

| Endpoint | What It Enables |
|:---|:---|
| `GET /forecasts/v1/mm/point_forecast?coordinates=<lat>,<lon>` | Weather at any point (current + 168 h) |
| `GET https://a.windbornesystems.com/treasure/{00..23}.json` | 24 h balloon telemetry |
| WeatherMesh-6 model via API version routing | Most accurate global forecast |
| NOAA SWPC public JSON feeds | Space weather / aurora overlay |
| RainViewer tile API (already integrated) | Live precipitation radar |
| NASA GIBS WMTS tiles | Satellite cloud imagery |

---

*Document created: August 14, 2026*
*References: [WindBorne API Docs](https://api.windbornesystems.com/) · [WeatherMesh-6 Announcement](https://windbornesystems.com/blog/introducing-wm-6)*
