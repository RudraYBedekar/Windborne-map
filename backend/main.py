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
from services.openweather_tiles import OPENWEATHER_TILE_MAX_ZOOM, OpenWeatherTileProxy
from services.rate_limit import KeyedRateLimiter
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
    yield
    await http_client.aclose()
    http_client = None


bedrock_service = BedrockChatService(
    weather_client=wb_client,
    telemetry_loader=_load_treasure_telemetry,
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
