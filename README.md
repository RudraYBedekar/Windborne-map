# WindBorne Weather & Mission Globe

Interactive MapLibre 3D globe for **WindBorne WeatherMesh** forecasts and **Vicky-AI**, an Amazon Bedrock co-pilot grounded on live tools. Built with Next.js and FastAPI.

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2016-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![MapLibre](https://img.shields.io/badge/Map-MapLibre%20GL-3388ff)](https://maplibre.org)
[![WeatherMesh](https://img.shields.io/badge/Forecast-WeatherMesh-00bcd4)](https://windbornesystems.com)
[![Bedrock](https://img.shields.io/badge/AI-Amazon%20Bedrock-FF9900?logo=amazon-aws&logoColor=white)](./AWS_BEDROCK_EC2_GUIDE.md)

---

## Features

| Area | What ships today |
|------|------------------|
| **3D globe** | MapLibre globe with satellite, hybrid, dark, and streets basemaps; atmosphere sky |
| **WeatherMesh** | Point forecasts via official API (`temperature`, pressure, precip, wind); 5‑min cache; Open‑Meteo fallback if upstream fails |
| **Place search** | Nominatim geocoding + city weather panel for any location |
| **Overlays** | RainViewer radar (free), accurate day/night solar terminator, optional OpenWeather clouds / temp / wind |
| **Vicky-AI** | Bedrock Converse (Claude Haiku 4.5) with tools: `search_location`, `get_weather`, fleet/balloon lookups when enabled |
| **Effects** | Rain / snow / wind particles driven by live weather |
| **Fleet UI** | Treasure telemetry, 24h timeline, detail panel & export — **off by default** (feed not operationally accurate) |

Balloon markers stay hidden globally unless you set `NEXT_PUBLIC_SHOW_BALLOONS=true`. Searching a place (e.g. California) shows **nearby Treasure balloons** in that region — click a marker for live status.

---

## Architecture

```text
Browser (Next.js :3000)
  └─ /api/* proxies ──► FastAPI (:8000)
                           ├─ WeatherMesh (+ Open-Meteo fallback)
                           ├─ Treasure telemetry (optional)
                           └─ Amazon Bedrock (IAM on EC2, or local keys)
```

---

## Quick start

**Prerequisites:** Node.js 18+, Python 3.10+, WindBorne API key. AWS optional for Vicky-AI.

### Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Set WB_API_KEY=...
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend

```powershell
# From repo root
copy .env.example .env.local
# Set WB_API_KEY if needed for local notes; FASTAPI via default proxy
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment

| Variable | Where | Purpose |
|----------|--------|---------|
| `WB_API_KEY` | `backend/.env` | WeatherMesh bearer token |
| `WINDBORNE_BASE_URL` | `backend/.env` | Defaults to `https://api.windbornesystems.com` |
| `AWS_REGION` | `backend/.env` | Bedrock region (`us-east-1`) |
| `BEDROCK_AGENT_MODEL` | `backend/.env` | e.g. Claude Haiku 4.5 inference profile |
| `AWS_ACCESS_KEY_ID` / `SECRET` | `backend/.env` | Leave empty on EC2 with IAM role |
| `BALLOONS_ENABLED` | `backend/.env` | Allow AI fleet tools (`false` by default) |
| `NEXT_PUBLIC_SHOW_BALLOONS` | `.env.local` | Show balloon markers on the map |
| `ALLOWED_ORIGINS` | `backend/.env` | Comma-separated CORS origins (default localhost:3000; no `*`) |
| `CHAT_RPM_LIMIT` | `backend/.env` | Per-IP chat cap (default **10**/min) |
| `WEATHER_RPM_LIMIT` | `backend/.env` | Per-IP weather cap (default **30**/min) |
| `API_KEY` | `backend/.env` | If set, require `X-API-Key` on `/api/chat` and auth-status |
| `CHAT_MAX_MESSAGE_CHARS` | `backend/.env` | Truncate chat messages (default 2000) |
| `OPENWEATHER_KEY` | `backend/.env` | OpenWeatherMap tile key (server-side proxy) |
| `OPENWEATHER_RPM_LIMIT` | `backend/.env` | Cap tile fetches (default **50**/min; under a 60 RPM plan) |
| `NEXT_PUBLIC_OPENWEATHER_ENABLED` | `.env.local` | Show Clouds/Temp/Wind toggles when key is backend-only |
| `NEXT_PUBLIC_OPENWEATHER_KEY` | `.env.local` | Optional; prefer backend `OPENWEATHER_KEY` |
| `NEXT_PUBLIC_MAPTILER_KEY` | `.env.local` | Optional MapTiler basemap / terrain |

---

## API (FastAPI)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health |
| `GET` | `/api/weather?lat=&lon=` | WeatherMesh point forecast |
| `GET` | `/api/chat/status` | Bedrock readiness & model branding |
| `POST` | `/api/chat` | Vicky-AI grounded chat |
| `GET` | `/api/openweather/status` | OpenWeather tile proxy RPM status |
| `GET` | `/api/openweather/tiles/{layer}/{z}/{x}/{y}` | Rate-limited cloud/temp/wind tiles |
| `GET` | `/windborne` | Treasure telemetry (when used) |

Verification notes: [`API_CHECK.md`](./API_CHECK.md). EC2 + Bedrock IAM: [`AWS_BEDROCK_EC2_GUIDE.md`](./AWS_BEDROCK_EC2_GUIDE.md).

---

## Project layout

```text
backend/                 FastAPI, WeatherMesh, Bedrock, AI tools
src/app/                 Next.js app + API proxies
src/components/          Map, weather UI, VickyChat, layers
src/lib/sun.ts           Solar terminator
src/config/map.ts        Basemaps & overlay config
```

---

## Status

- WeatherMesh + Vicky-AI grounding: **demo-ready** (functional prototype — not a hardened production service)
- Day/night terminator: verified against solar geometry
- Balloon constellation UI: **available but disabled by default**
- Hardening: chat/weather RPM limits, explicit CORS, optional `API_KEY`, telemetry cache, OpenWeather 50 RPM proxy
- Deploy: EC2 + PM2 with Bedrock IAM role — see [`AWS_BEDROCK_EC2_GUIDE.md`](./AWS_BEDROCK_EC2_GUIDE.md); optional `docker-compose.yml`
