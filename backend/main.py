from __future__ import annotations

import asyncio
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from services.bedrock import BedrockChatService
from services.cyclones import FORECAST_HOURS as CYCLONE_HOURS, TropicalCycloneService
from services.gridded import FORECAST_HOURS as GRID_HOURS, GriddedForecastService
from services.openweather_tiles import OPENWEATHER_TILE_MAX_ZOOM, OpenWeatherTileProxy
from services.rate_limit import KeyedRateLimiter
from services.wb_gate import wb_fetch_gate
from services.windborne import WindBorneClient

# Single dotenv load path (no custom parsers)
_BASE = Path(__file__).resolve().parent
load_dotenv(_BASE / ".env")
load_dotenv(_BASE / ".env.local")
load_dotenv(_BASE.parent / ".env")
load_dotenv(_BASE.parent / ".env.local")

COLORS = ["#00ffea", "#ff0055", "#ccff00", "#bf00ff", "#00ccff", "#ffaa00"]
WINDBORNE_TOKEN = os.getenv("WB_API_KEY") or os.getenv("WINDBORNE_TOKEN") or os.getenv("WINDBORNE_API_KEY")

CHAT_RPM = int(os.getenv("CHAT_RPM_LIMIT", "10") or "10")
WEATHER_RPM = int(os.getenv("WEATHER_RPM_LIMIT", "30") or "30")
API_KEY = (os.getenv("API_KEY") or "").strip()
TELEMETRY_CACHE_TTL = int(os.getenv("TELEMETRY_CACHE_TTL", "300") or "300")

# Explicit origins only — no wildcard default (FEEDBACK P0)
_DEFAULT_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
allowed_origins = [
    o.strip()
    for o in (os.getenv("ALLOWED_ORIGINS") or _DEFAULT_ORIGINS).split(",")
    if o.strip() and o.strip() != "*"
]
if not allowed_origins:
    allowed_origins = _DEFAULT_ORIGINS.split(",")

http_client: Optional[httpx.AsyncClient] = None
wb_client = WindBorneClient()
owm_tiles = OpenWeatherTileProxy()
cyclone_service = TropicalCycloneService()
gridded_service = GriddedForecastService()
chat_limiter = KeyedRateLimiter(max_per_minute=CHAT_RPM)
weather_limiter = KeyedRateLimiter(max_per_minute=WEATHER_RPM)

_telemetry_cache: Optional[List[Dict[str, Any]]] = None
_telemetry_cache_expires = 0.0


async def fetch_url(client: httpx.AsyncClient, url: str) -> Optional[Any]:
    try:
        headers = {}
        if WINDBORNE_TOKEN:
            headers["Authorization"] = f"Bearer {WINDBORNE_TOKEN}"
        resp = await client.get(url, headers=headers, timeout=10.0)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Failed to fetch {url}: {e}")
        return None


async def _load_treasure_telemetry(force: bool = False) -> List[Dict[str, Any]]:
    """Shared loader for /windborne and AI fleet tools — 5-minute TTL cache."""
    global _telemetry_cache, _telemetry_cache_expires
    now = time.time()
    if not force and _telemetry_cache is not None and now < _telemetry_cache_expires:
        return _telemetry_cache

    hours = list(range(24))
    urls = [f"https://a.windbornesystems.com/treasure/{str(h).zfill(2)}.json" for h in hours]
    client = http_client or httpx.AsyncClient(timeout=15.0)
    owns_client = http_client is None
    try:
        tasks = [fetch_url(client, url) for url in urls]
        fetched_data = await asyncio.gather(*tasks)
    finally:
        if owns_client:
            await client.aclose()

    balloons: Dict[str, Dict[str, Any]] = {}
    now_ms = int(time.time() * 1000)

    for hour_index, hour_data in enumerate(fetched_data):
        if not hour_data or not isinstance(hour_data, list):
            continue
        timestamp = now_ms - (hour_index * 60 * 60 * 1000)

        for balloon_index, point in enumerate(hour_data):
            if not isinstance(point, list) or len(point) < 3:
                continue
            lat, lon, alt = point[0], point[1], point[2]
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                continue
            valid_alt = alt if isinstance(alt, (int, float)) else 0.0
            balloon_id = f"WB-{balloon_index + 1}"
            if balloon_id not in balloons:
                balloons[balloon_id] = {
                    "id": balloon_id,
                    "path": [],
                    "color": COLORS[balloon_index % len(COLORS)],
                }
            balloons[balloon_id]["path"].append(
                {"lat": lat, "lon": lon, "alt": valid_alt, "time": timestamp}
            )

    results = []
    for b in balloons.values():
        b["path"].sort(key=lambda x: x["time"])
        if b["path"]:
            results.append(b)

    _telemetry_cache = results
    _telemetry_cache_expires = time.time() + TELEMETRY_CACHE_TTL
    return results


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(20.0, connect=5.0),
        limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
    )
    wb_client.set_http_client(http_client)
    owm_tiles.set_http_client(http_client)
    cyclone_service.set_http_client(http_client)
    gridded_service.set_http_client(http_client)

    async def _warm_cyclone_cache():
        """Prefetch cyclones in the background so Vicky answers instantly from cache."""
        await asyncio.sleep(2)
        while True:
            try:
                await cyclone_service.fetch_cyclones(include_details=True)
            except Exception:
                pass
            # Refresh on the same cadence as the upstream gate (default 5 min)
            await asyncio.sleep(max(60.0, wb_fetch_gate.min_interval))

    warm_task = asyncio.create_task(_warm_cyclone_cache())
    yield
    warm_task.cancel()
    try:
        await warm_task
    except asyncio.CancelledError:
        pass
    await http_client.aclose()
    http_client = None


bedrock_service = BedrockChatService(
    weather_client=wb_client,
    telemetry_loader=_load_treasure_telemetry,
    cyclone_service=cyclone_service,
    gridded_service=gridded_service,
)

app = FastAPI(title="Windborne API Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def require_api_key(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    """Optional API key gate — enforced when API_KEY is set in the environment."""
    if not API_KEY:
        return
    if not x_api_key or not secrets.compare_digest(x_api_key, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


class BalloonPoint(BaseModel):
    lat: float
    lon: float
    alt: float
    time: int


class Balloon(BaseModel):
    id: str
    path: List[BalloonPoint]
    color: str


class ChatMessage(BaseModel):
    role: str
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(max_length=24)
    fleet_context: Optional[Dict[str, Any]] = None
    selected_balloon: Optional[Dict[str, Any]] = None
    weather_context: Optional[Dict[str, Any]] = None


@app.get("/")
@app.get("/health")
def read_root():
    return {
        "status": "online",
        "service": "Windborne FastAPI Ingestion Engine",
        "version": "2.1.0",
        "has_wb_key": bool(WINDBORNE_TOKEN),
        "bedrock_status": bedrock_service.get_status(),
        "cors_origins": allowed_origins,
        "chat_rpm_limit": CHAT_RPM,
        "api_key_required": bool(API_KEY),
        "wb_min_request_interval_seconds": wb_fetch_gate.min_interval,
        "cyclones": cyclone_service.capability(),
        "gridded": gridded_service.capability(),
    }


@app.get("/api/weather/auth-status")
async def get_auth_status(_: None = Depends(require_api_key)):
    """WindBorne API key status (requires API_KEY when configured)."""
    return await wb_client.check_auth()


@app.get("/api/chat/status")
async def get_chat_status():
    return bedrock_service.get_status()


@app.post("/api/chat")
async def chat_with_vicky(
    req: ChatRequest,
    request: Request,
    _: None = Depends(require_api_key),
):
    ip = _client_ip(request)
    if not await chat_limiter.try_acquire(ip):
        raise HTTPException(
            status_code=429,
            detail=f"Chat rate limit exceeded ({CHAT_RPM} requests/minute). Try again shortly.",
        )
    msgs = [{"role": m.role, "content": m.content} for m in req.messages]
    return await bedrock_service.generate_response(
        messages=msgs,
        fleet_context=req.fleet_context,
        selected_balloon=req.selected_balloon,
        weather_context=req.weather_context,
    )


@app.get("/api/openweather/status")
async def openweather_status():
    return owm_tiles.status()


@app.get("/api/openweather/tiles/{layer}/{z}/{x}/{y}.png")
@app.get("/api/openweather/tiles/{layer}/{z}/{x}/{y}")
async def openweather_tile(layer: str, z: int, x: int, y: int):
    try:
        body, content_type = await owm_tiles.fetch_tile(layer, z, x, y)
        return Response(
            content=body,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=300",
                "X-OWM-RPM-Limit": str(owm_tiles.rpm_limit),
                "X-OWM-Max-Zoom": str(OPENWEATHER_TILE_MAX_ZOOM),
            },
        )
    except PermissionError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"OpenWeatherMap tile error: {e.response.status_code}",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail="OpenWeatherMap proxy failed")


@app.get("/api/weather/mesh-status")
async def weather_mesh_feature_status():
    """Capability flags for cyclone + gridded modes (5-minute upstream gate)."""
    return {
        "provider": "WindBorne WeatherMesh",
        "wb_gate": wb_fetch_gate.status(),
        "cyclones": cyclone_service.capability(),
        "gridded": gridded_service.capability(),
        "cyclone_forecast_hours": list(CYCLONE_HOURS),
        "grid_forecast_hours": list(GRID_HOURS),
    }


@app.get("/api/cyclones")
async def list_cyclones(
    include_details: bool = True,
    include_unofficial_ids: bool = False,
    include_ensemble: bool = False,
    basin: Optional[str] = None,
    forecast_hour: int = 0,
    geojson: bool = False,
    selected_id: Optional[str] = None,
):
    payload = await cyclone_service.fetch_cyclones(
        include_details=include_details,
        include_unofficial_ids=include_unofficial_ids,
        basin=basin,
    )
    if not payload.get("ok"):
        status = 503
        if payload.get("error") == "UNAUTHORIZED":
            status = 403
        elif payload.get("error") == "CYCLONES_DISABLED":
            status = 503
        raise HTTPException(status_code=status, detail=payload)
    if geojson:
        return cyclone_service.to_geojson(
            payload,
            forecast_hour=forecast_hour,
            include_ensemble=include_ensemble or include_unofficial_ids,
            selected_id=selected_id,
        )
    return payload


BASIN_LABELS = {
    "NA": "North Atlantic",
    "EP": "Eastern Pacific",
    "CP": "Central Pacific",
    "WP": "Western Pacific",
    "NI": "North Indian",
    "SI": "South Indian",
    "SP": "South Pacific",
    "AU": "Australia region",
}


@app.get("/api/cyclones/{cyclone_id}")
async def get_cyclone(cyclone_id: str, forecast_hour: int = 0):
    payload = await cyclone_service.fetch_cyclones(include_details=True)
    if not payload.get("ok"):
        raise HTTPException(status_code=503, detail=payload)
    storm = cyclone_service.get_storm(payload, cyclone_id)
    if not storm:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "cyclone_id": cyclone_id})
    point = cyclone_service.point_at_hour(storm, forecast_hour)

    path = storm.get("path") or []
    route_summary = None
    if len(path) >= 2:
        first, last = path[0], path[-1]
        route_summary = {
            "points": len(path),
            "start": {"lat": first.get("latitude"), "lon": first.get("longitude"), "valid_at": first.get("valid_at")},
            "end": {"lat": last.get("latitude"), "lon": last.get("longitude"), "valid_at": last.get("valid_at")},
            "status": "mean_track_available",
        }
    elif len(path) == 1:
        only = path[0]
        route_summary = {
            "points": 1,
            "start": {"lat": only.get("latitude"), "lon": only.get("longitude"), "valid_at": only.get("valid_at")},
            "end": None,
            "status": "single_point_only",
        }
    else:
        route_summary = {
            "points": 0,
            "start": None,
            "end": None,
            "status": "no_track_yet",
            "note": "WeatherMesh has not published a mean path for this storm yet (often early or weak systems). Genesis position may still be shown.",
        }

    basins = storm.get("basins") or []
    basin_labels = [BASIN_LABELS.get(str(b).upper(), str(b)) for b in basins]

    region = None
    if point and isinstance(point.get("latitude"), (int, float)) and isinstance(point.get("longitude"), (int, float)):
        from services import ai_tools as _ai_tools

        region = await _ai_tools.reverse_geocode(float(point["latitude"]), float(point["longitude"]))

    return {
        "ok": True,
        "provider": payload.get("provider"),
        "model": payload.get("model"),
        "initialization_time": payload.get("initialization_time"),
        "forecast_zero": payload.get("forecast_zero"),
        "forecast_hour": forecast_hour,
        "point": point,
        "cyclone": storm,
        "from_cache": payload.get("from_cache"),
        "basin_labels": basin_labels,
        "route_summary": route_summary,
        "region": region,
        "brief": {
            "name": storm.get("storm_name") or storm.get("tropical_cyclone_id"),
            "basins": basin_labels,
            "track_available": len(path) >= 2,
            "intensity_available": storm.get("max_wind_kt") is not None or (
                point and point.get("max_wind_kt") is not None
            ),
            "news_note": "WeatherMesh does not provide news headlines. Region below is reverse-geocoded from the storm position.",
            "hazards_note": "WindBorne tracks tropical cyclones and weather grids (incl. snowfall). It does not provide avalanche alerts.",
        },
        "cone_caption": (
            "Forecast Cone — WeatherMesh ensemble-supported range of plausible cyclone positions. "
            "Not a guaranteed impact region."
        ),
    }


@app.get("/api/weather/grid")
async def weather_grid(
    variable: str = "temperature_2m",
    forecast_hour: int = 0,
    bbox: str = "-130,20,-60,55",
    format: str = "json",
    resolution: int = 128,
):
    """Frontend-friendly WeatherMesh grid. format=json summary | format=png image overlay."""
    if format == "png":
        try:
            png, meta = await gridded_service.get_png(
                variable=variable,
                bbox=bbox,
                forecast_hour=forecast_hour,
                resolution=resolution,
            )
            return Response(
                content=png,
                media_type="image/png",
                headers={
                    "Cache-Control": f"public, max-age={int(wb_fetch_gate.min_interval)}",
                    "X-WM-Variable": meta.get("variable", variable),
                    "X-WM-Forecast-Hour": str(forecast_hour),
                    "X-WM-BBox": bbox,
                },
            )
        except PermissionError as e:
            raise HTTPException(status_code=503, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(
                status_code=503,
                detail={"error": type(e).__name__, "message": "WeatherMesh forecast layer unavailable.", "detail": str(e)},
            )

    summary = await gridded_service.get_summary(variable, bbox, forecast_hour)
    if not summary.get("ok"):
        code = 400 if summary.get("error") == "VALIDATION" else 503
        raise HTTPException(status_code=code, detail=summary)
    return summary


@app.get("/api/weather")
async def get_weather(lat: float, lon: float, request: Request):
    if not (-90.0 <= lat <= 90.0):
        raise HTTPException(status_code=400, detail="Latitude must be between -90 and 90 degrees.")
    if not (-180.0 <= lon <= 180.0):
        raise HTTPException(status_code=400, detail="Longitude must be between -180 and 180 degrees.")

    ip = _client_ip(request)
    if not await weather_limiter.try_acquire(ip):
        raise HTTPException(
            status_code=429,
            detail=f"Weather rate limit exceeded ({WEATHER_RPM} requests/minute).",
        )

    result = await wb_client.get_forecast(lat, lon)

    if isinstance(result, dict) and "error" in result:
        status_code = result.get("status_code", 500)
        if status_code == 429:
            raise HTTPException(
                status_code=429,
                detail=result.get("message", "Weather data request limit reached."),
            )
        if status_code in (401, 403):
            raise HTTPException(
                status_code=status_code,
                detail=result.get("message", "Invalid or missing WindBorne API key."),
            )
        if status_code in (500, 503, 504):
            raise HTTPException(
                status_code=status_code,
                detail=result.get("message", "WindBorne weather data is temporarily unavailable."),
            )

    return result


@app.get("/windborne")
async def get_windborne_data():
    return await _load_treasure_telemetry()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
