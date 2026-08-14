# Windborne Project Review & Technical Audit

## Executive Summary

This document provides a comprehensive overview of the **Windborne** project—what has been implemented, how the system components interact, and an in-depth technical audit identifying flaws, edge cases, and areas requiring improvement.

---

## 1. Project Overview & Objectives

**Windborne** is a real-time, interactive 3D geospatial visualization platform designed to track stratospheric hot air balloons across the globe. Built with a modern dual-stack architecture (Next.js frontend + FastAPI backend), the system ingests 24-hour historical flight telemetry, plots high-altitude balloon trajectories, and overlays real-time atmospheric weather forecasts (temperature, wind vectors, pressure, and cloud cover).

### Primary System Architecture
```
                        +------------------------------------+
                        |       Client Web Browser           |
                        +------------------------------------+
                                    |              |
                    Search & Map    |              | UI State & Telemetry
                                    v              v
                        +--------------------+  +----------------------+
                        | MapLibre 3D Globe  |  |  Next.js App Server  |
                        +--------------------+  +----------------------+
                                                    |            |
                                      /api/windborne|            |/api/weather
                                                    v            v
                                        +----------------------------------+
                                        |      FastAPI Python Backend      |
                                        +----------------------------------+
                                                    |            |
                                  Telemetry Ingest  |            | WeatherMesh API
                                                    v            v
                                        +----------------------------------+
                                        |    WindBorne Systems Public &    |
                                        |      WeatherMesh Endpoints       |
                                        +----------------------------------+
```

---

## 2. What Has Been Completed Till Now

The project has achieved significant progress, delivering a feature-rich, high-performance web platform:

### A. Frontend & Visualization Layer (`Next.js` + `MapLibre GL JS`)
- **Interactive 3D Globe View (`src/components/Map.tsx`)**:
  - Implements geodetically accurate 3D globe projection (`projection: 'globe'`) with custom space/sky styling.
  - 3D Terrain exaggeration (1.5x depth) using MapLibre elevation sources.
  - Custom SVG balloon marker sprites and dynamic HTML5 Canvas pulsing dot animations for live telemetry targets.
  - Progressive 2.5-second path drawing animation (`requestAnimationFrame`) when a balloon trajectory is selected.
- **Collapsible Telemetry Sidebar (`src/components/BalloonList.tsx`)**:
  - Displays live list of all active stratospheric balloons (`WB-1`, `WB-2`, etc.).
  - Shows altitude, latest coordinates, total flight duration, and trajectory point counts.
  - Real-time search/filter input to filter balloons by ID or status.
- **Layer & Weather Controls (`src/components/LayerControls.tsx`)**:
  - Basemap switcher: **Dark Matter** (default), **Satellite**, **Streets**, and **Terrain**.
  - Weather map layer toggles: Radar (RainViewer live overlay), Clouds, Temperature, and Wind.
- **Geocoding & Location Search**:
  - Top-bar search integrated with OpenStreetMap Nominatim API for location lookup with smooth camera fly-to transitions.
- **Points of Interest (POIs)**:
  - Curated launch site markers (e.g., Norfolk, VA) with interactive popup detail cards.
- **Ambient Visual Weather Overlay (`src/components/WeatherEffects.tsx`)**:
  - Particle system rendering simulated rain, snow, or wind streaks overlaying the screen.

### B. Data & Service Layer (`TypeScript`)
- **`src/services/windborne.ts`**: Handles client-side API requests for balloon telemetry.
- **`src/services/weather.ts`**: Fetches current weather metrics for latitude/longitude points.
- **`src/services/rainviewer.ts`**: Ingests live precipitation radar tiles from RainViewer API.

### C. API Proxy & Backend Layer (`Next.js API Routes` + `FastAPI`)
- **Next.js API Route Proxies**:
  - `src/app/api/windborne/route.ts`: Queries the Python backend, with automatic direct-fetch fallback to `https://a.windbornesystems.com/treasure/{00..23}.json` if the backend is unreachable.
  - `src/app/api/weather/route.ts`: Proxies weather requests to the Python backend, with automatic fallback to Open-Meteo public API (`https://api.open-meteo.com/v1/forecast`).
- **Python FastAPI Service (`backend/main.py`)**:
  - Ingests 24 hours of raw balloon data files (`00.json` to `23.json`) via asynchronous `httpx` worker threads.
  - Normalizes coordinate tuples `[lat, lon, alt]` into structured balloon paths sorted chronologically.
  - Integrates `WindBorneClient` (`backend/services/windborne.py`) for querying WindBorne WeatherMesh endpoints with 5-minute TTL caching and vector wind component calculations ($u, v \rightarrow \text{speed, direction}$).

---

## 3. Technical Audit: What Is Wrong & Areas for Improvement

While the application is functional and visually impressive, a thorough code review reveals several architecture, performance, and UX issues that require correction:

### 🚨 1. Hardcoded Local Backend URLs (Deployment Blocker)
- **Issue**: In `src/app/api/windborne/route.ts` (line 63) and `src/app/api/weather/route.ts` (line 19), backend calls hardcode `http://127.0.0.1:8000`.
- **Why It's Wrong**: When deployed to hosting environments like Vercel, Netlify, or AWS, the serverless Next.js functions will attempt to connect to `127.0.0.1:8000` on the container local loopback and fail, triggering fallback logic on every request.
- **Fix**: Use environment variables (`process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000'`).

### ⚠️ 2. Approximated Telemetry Timestamps
- **Issue**: In `backend/main.py` (lines 154–155) and `src/app/api/windborne/route.ts` (lines 26 & 47), timestamps are computed using:
  $$\text{timestamp} = \text{now} - (\text{hourIndex} \times 3600000)$$
- **Why It's Wrong**: This assumes `00.json` through `23.json` represent exact 1-hour intervals aligned with the current server time. If files are updated irregularly by Windborne servers, timestamps become skewed or out of sequence.
- **Fix**: Parse real timestamp metadata from the Windborne payload when available, or store relative hour offsets explicitly.

### 🎨 3. Decoupled Visual Weather Overlay
- **Issue**: `WeatherEffects.tsx` selects a random weather state (`rain`, `snow`, or `wind`) upon mounting regardless of the map's current geographical location or actual weather.
- **Why It's Wrong**: Displaying heavy snowfall visuals while viewing a balloon over the Sahara Desert creates visual conflict and reduces data trustworthiness.
- **Fix**: Connect `WeatherEffects.tsx` state to the active weather data of the currently selected balloon or map center coordinates.

### 🔑 4. Unconfigured OpenWeather Layer Tiles
- **Issue**: In `src/config/map.ts`, cloud, temperature, and wind layer URLs rely on `process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY`.
- **Why It's Wrong**: Without a valid OpenWeather API key provided in `.env.local`, toggling these layers results in HTTP 401 unauthorized errors in the browser console and blank map tiles.
- **Fix**: Add key validation or graceful fallback notifications when layer keys are missing.

### 🔒 5. Wildcard CORS & Redundant `.env` Parsing in Python
- **Issue**: `backend/main.py` sets `allow_origins=["*"]`. Additionally, both `main.py` and `services/windborne.py` contain custom file-reading loops to split strings on `=` to load `.env` files manually.
- **Why It's Wrong**:
  - `allow_origins=["*"]` allows any third-party website to make requests to the backend.
  - Manual `.env` parsing duplicates standard `python-dotenv` / `pydantic-settings` behavior and risks failing on complex environment variables containing quotes or special characters.
- **Fix**: Restrict CORS origins to the frontend domain in production and standardize on `python-dotenv`.

### 🔄 6. Polling & Memory Management on Globe Map
- **Issue**:
  - `page.tsx` polls balloon data every 60 seconds with `setInterval` without exponential backoff on repeated failures.
  - In `Map.tsx`, animation loops (`requestAnimationFrame`) for trajectory lines do not explicitly cancel previous animation frames if a user rapidly clicks multiple balloons in sequence.
- **Fix**: Store `requestAnimationFrame` IDs in React `useRef` and cancel them on selection change or unmount.

---

## 4. Recommended Action Plan & Future Roadmap

| Priority | Feature / Fix | Description |
| :--- | :--- | :--- |
| 🔴 **P0** | **Configurable Backend URLs** | Replace hardcoded `127.0.0.1:8000` with `FASTAPI_BACKEND_URL` environment variables in Next.js routes. |
| 🟠 **P1** | **Live-Weather Visual Sync** | Bind `WeatherEffects.tsx` particle intensity and type to real-time weather metrics fetched for selected balloons. |
| 🟠 **P1** | **Animation Frame Cancellation** | Clean up WebGL sources and `requestAnimationFrame` timers in `Map.tsx` on unmount/re-select to prevent memory leaks. |
| 🟡 **P2** | **Enhanced Error UI** | Display subtle toast alerts when using fallback data (e.g., "Python backend offline – using direct telemetry mode"). |
| 🟢 **P3** | **Historical Telemetry Scrubbing** | Add a timeline slider UI allowing users to play back balloon flight paths over 24 hours. |

---

*Document generated for Windborne project tracking and code quality assurance.*
