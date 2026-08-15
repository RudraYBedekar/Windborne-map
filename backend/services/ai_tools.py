"""
Deterministic tool executors for Vicky-AI.
The LLM never invents these values — Python computes them from real APIs.
"""
from __future__ import annotations

import hashlib
import logging
import math
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

from services.ai_config import get_ai_config

logger = logging.getLogger("ai_tools")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


async def reverse_geocode(lat: float, lon: float) -> Dict[str, Any]:
    """Nearest place / country for cyclone context (Nominatim). Not news."""
    try:
        url = "https://nominatim.openstreetmap.org/reverse"
        params = {
            "format": "json",
            "lat": lat,
            "lon": lon,
            "zoom": 5,
            "addressdetails": 1,
        }
        headers = {"User-Agent": "Windborne-VickyAI/1.0 (mission-ops)"}
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code != 200:
                return {"ok": False, "error": f"HTTP_{resp.status_code}"}
            data = resp.json()
            addr = data.get("address") or {}
            country = addr.get("country")
            ocean = addr.get("ocean") or addr.get("sea")
            state = addr.get("state") or addr.get("region")
            display = data.get("display_name")
            region_bits = [b for b in (state, country or ocean) if b]
            return {
                "ok": True,
                "display_name": display,
                "country": country,
                "ocean_or_sea": ocean,
                "state": state,
                "region_label": ", ".join(region_bits) if region_bits else (display or "Open ocean / remote area"),
                "retrievedAt": _utc_now(),
                "provider": "OpenStreetMap Nominatim",
            }
    except Exception as e:
        logger.warning("[ai_tools] reverse_geocode error=%s", type(e).__name__)
        return {"ok": False, "error": type(e).__name__, "message": str(e)}


async def reverse_geocode_city(lat: float, lon: float) -> Dict[str, Any]:
    """Resolve a grid point to a city/town name. Rejects ocean / uninhabited water."""
    try:
        url = "https://nominatim.openstreetmap.org/reverse"
        params = {
            "format": "json",
            "lat": lat,
            "lon": lon,
            "zoom": 10,
            "addressdetails": 1,
        }
        headers = {"User-Agent": "Windborne-VickyAI/1.0 (mission-ops)"}
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code != 200:
                return {"ok": False, "is_city": False, "error": f"HTTP_{resp.status_code}"}
            data = resp.json()
            addr = data.get("address") or {}
            if addr.get("ocean") or addr.get("sea") or addr.get("water"):
                return {
                    "ok": True,
                    "is_city": False,
                    "reason": "ocean_or_water",
                    "retrievedAt": _utc_now(),
                }
            city = (
                addr.get("city")
                or addr.get("town")
                or addr.get("village")
                or addr.get("municipality")
                or addr.get("city_district")
                or addr.get("suburb")
                or addr.get("hamlet")
                or addr.get("county")
            )
            state = addr.get("state") or addr.get("region")
            country = addr.get("country")
            if not city:
                return {
                    "ok": True,
                    "is_city": False,
                    "reason": "no_settlement",
                    "country": country,
                    "state": state,
                    "retrievedAt": _utc_now(),
                }
            # Prefer "City, State" for US-style labels; else "City, Country"
            if state and country in (None, "United States", "United States of America", "Canada", "Mexico"):
                label = f"{city}, {state}"
            elif country:
                label = f"{city}, {country}"
            else:
                label = city
            return {
                "ok": True,
                "is_city": True,
                "city": city,
                "state": state,
                "country": country,
                "location": label,
                "display_name": data.get("display_name"),
                "retrievedAt": _utc_now(),
                "provider": "OpenStreetMap Nominatim",
            }
    except Exception as e:
        logger.warning("[ai_tools] reverse_geocode_city error=%s", type(e).__name__)
        return {"ok": False, "is_city": False, "error": type(e).__name__, "message": str(e)}


# Small verified seed list — used only when Nominatim is rate-limited / down.
# Coordinates are approximate city centers (not invented at answer time).
_KNOWN_PLACES: Dict[str, Dict[str, Any]] = {
    "redwood city": {
        "name": "Redwood City, California, USA",
        "latitude": 37.4852,
        "longitude": -122.2364,
    },
    "redwood city california": {
        "name": "Redwood City, California, USA",
        "latitude": 37.4852,
        "longitude": -122.2364,
    },
    "redwood city california usa": {
        "name": "Redwood City, California, USA",
        "latitude": 37.4852,
        "longitude": -122.2364,
    },
    "san francisco": {
        "name": "San Francisco, California, USA",
        "latitude": 37.7749,
        "longitude": -122.4194,
    },
    "tokyo": {"name": "Tokyo, Japan", "latitude": 35.6762, "longitude": 139.6503},
    "london": {"name": "London, United Kingdom", "latitude": 51.5074, "longitude": -0.1278},
    "new york": {
        "name": "New York, New York, USA",
        "latitude": 40.7128,
        "longitude": -74.0060,
    },
}

_geocode_mem: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_GEOCODE_TTL_SEC = 86400.0


def _geocode_cache_dir():
    from pathlib import Path

    d = Path(__file__).resolve().parent.parent / ".cache" / "geocode"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _geocode_cache_get(key: str) -> Optional[Dict[str, Any]]:
    now = time.time()
    hit = _geocode_mem.get(key)
    if hit and hit[0] > now:
        return hit[1]
    try:
        import pickle

        path = _geocode_cache_dir() / f"{hashlib.sha256(key.encode()).hexdigest()}.pkl"
        if not path.exists():
            return None
        with path.open("rb") as f:
            payload = pickle.load(f)
        if float(payload.get("expires") or 0) < now:
            return None
        value = payload.get("value")
        if isinstance(value, dict):
            _geocode_mem[key] = (float(payload["expires"]), value)
            return value
    except Exception:
        return None
    return None


def _geocode_cache_set(key: str, value: Dict[str, Any]) -> None:
    expires = time.time() + _GEOCODE_TTL_SEC
    _geocode_mem[key] = (expires, value)
    try:
        import pickle

        path = _geocode_cache_dir() / f"{hashlib.sha256(key.encode()).hexdigest()}.pkl"
        with path.open("wb") as f:
            pickle.dump({"expires": expires, "value": value}, f)
    except Exception:
        pass


def normalize_place_query(query: str) -> str:
    """Strip weather/check fluff so 'Redwood City … check weather' geocodes cleanly."""
    import re

    q = (query or "").strip()
    q = re.sub(
        r"\b(check|show|get|tell me|what's|whats|what is)\b",
        " ",
        q,
        flags=re.I,
    )
    q = re.sub(
        r"\b(the\s+)?(weather|forecast|conditions|temperature|temps?)\b",
        " ",
        q,
        flags=re.I,
    )
    q = re.sub(r"\s+", " ", q).strip(" ,.?!")
    return q


def look_like_place_weather_query(text: str) -> bool:
    """True for 'Redwood City check weather' / 'weather in Tokyo' style asks."""
    import re

    q = (text or "").strip().lower()
    if not q or len(q) > 80:
        return False
    if look_like_cyclone_query(q) or parse_rank_intent_safe(q):
        return False
    if re.search(r"\b(weather|forecast|conditions|temperature)\b", q):
        place = normalize_place_query(q)
        words = [w for w in place.replace(",", " ").split() if w]
        return 1 <= len(words) <= 6
    return False


def parse_rank_intent_safe(text: str) -> bool:
    try:
        from services.forecast_rank import parse_rank_intent

        return parse_rank_intent(text) is not None
    except Exception:
        return False


async def search_location(query: str) -> Dict[str, Any]:
    """Resolve a place name via OpenStreetMap Nominatim (cached + known-place fallback)."""
    raw_q = (query or "").strip()
    q = normalize_place_query(raw_q) or raw_q
    if not q:
        return {"ok": False, "error": "EMPTY_QUERY", "results": []}

    cache_key = q.lower()
    cached = _geocode_cache_get(cache_key)
    if cached:
        out = dict(cached)
        out["from_cache"] = True
        out["retrievedAt"] = _utc_now()
        return out

    # Known-place fallback before hitting Nominatim when we already know the city
    known = _KNOWN_PLACES.get(cache_key)
    if known:
        result = {
            "ok": True,
            "query": q,
            "results": [
                {
                    "name": known["name"],
                    "latitude": known["latitude"],
                    "longitude": known["longitude"],
                    "placeId": None,
                    "type": "known_place",
                }
            ],
            "provider": "local_known_places",
            "retrievedAt": _utc_now(),
        }
        _geocode_cache_set(cache_key, result)
        return result

    url = "https://nominatim.openstreetmap.org/search"
    params = {"format": "json", "q": q, "limit": 5}
    headers = {"User-Agent": "Windborne-VickyAI/1.0 (mission-ops)"}

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code == 429:
                # Retry known places with looser contains match
                for key, place in _KNOWN_PLACES.items():
                    if key in cache_key or cache_key in key:
                        result = {
                            "ok": True,
                            "query": q,
                            "results": [
                                {
                                    "name": place["name"],
                                    "latitude": place["latitude"],
                                    "longitude": place["longitude"],
                                    "placeId": None,
                                    "type": "known_place",
                                }
                            ],
                            "provider": "local_known_places",
                            "from_cache": False,
                            "nominatim_rate_limited": True,
                            "retrievedAt": _utc_now(),
                        }
                        _geocode_cache_set(cache_key, result)
                        return result
                return {
                    "ok": False,
                    "error": "GEOCODER_RATE_LIMITED",
                    "message": (
                        "The location service is temporarily rate-limited. "
                        "Try again shortly, or ask with a major city name."
                    ),
                    "results": [],
                    "retrievedAt": _utc_now(),
                }
            if resp.status_code != 200:
                logger.warning("[ai_tools] search_location status=%s", resp.status_code)
                return {
                    "ok": False,
                    "error": f"GEOCODER_HTTP_{resp.status_code}",
                    "results": [],
                    "retrievedAt": _utc_now(),
                }
            raw = resp.json()
            results = []
            for item in raw:
                results.append(
                    {
                        "name": item.get("display_name"),
                        "latitude": float(item["lat"]),
                        "longitude": float(item["lon"]),
                        "placeId": item.get("place_id"),
                        "type": item.get("type"),
                    }
                )
            out = {
                "ok": True,
                "query": q,
                "results": results,
                "provider": "OpenStreetMap Nominatim",
                "retrievedAt": _utc_now(),
            }
            if results:
                _geocode_cache_set(cache_key, out)
            return out
    except Exception as e:
        logger.warning("[ai_tools] search_location error=%s", type(e).__name__)
        return {
            "ok": False,
            "error": "GEOCODER_UNAVAILABLE",
            "message": "Could not resolve that location right now.",
            "results": [],
            "retrievedAt": _utc_now(),
        }


async def get_weather(lat: float, lon: float, weather_client) -> Dict[str, Any]:
    """Weather via existing WindBorne WeatherMesh client (Open-Meteo fallback inside)."""
    result = await weather_client.get_forecast(lat, lon)
    if not isinstance(result, dict) or result.get("error"):
        return {
            "ok": False,
            "error": result.get("error") if isinstance(result, dict) else "WEATHER_FAILED",
            "message": (
                result.get("message")
                if isinstance(result, dict)
                else "Weather data unavailable."
            ),
            "retrievedAt": _utc_now(),
        }

    provider = result.get("provider") or "Unknown"
    is_fallback = "open-meteo" in provider.lower() or "fallback" in provider.lower()
    current = result.get("current") or {}
    return {
        "ok": True,
        "provider": provider,
        "isFallback": is_fallback,
        "model": result.get("model"),
        "coordinates": result.get("coordinates") or {"latitude": lat, "longitude": lon},
        "forecastTime": result.get("forecastTime"),
        "current": {
            "temperature": current.get("temperature"),
            "pressure": current.get("pressure"),
            "humidity": current.get("humidity"),
            "windSpeed": current.get("windSpeed"),
            "windDirection": current.get("windDirection"),
            "precipitation": current.get("precipitation"),
        },
        "retrievedAt": _utc_now(),
    }


def compute_fleet_stats(balloons: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Deterministic fleet math from telemetry payloads — never LLM-invented."""
    if not balloons:
        return {
            "ok": False,
            "error": "NO_TELEMETRY",
            "message": "No balloon telemetry is available to summarize.",
            "total": 0,
            "retrievedAt": _utc_now(),
        }

    totals = []
    high = 0
    highest = None
    fastest = None
    alt_sum = 0.0

    for b in balloons:
        path = b.get("path") or []
        if not path:
            continue
        last = path[-1]
        alt = float(last.get("alt") or 0)
        # Treasure sometimes returns km; normalize like frontend
        if alt < 100:
            alt = alt * 1000.0
        speed = 0.0
        if len(path) >= 2:
            prev = path[-2]
            # rough speed estimate
            try:
                dlat = float(last["lat"]) - float(prev["lat"])
                dlon = float(last["lon"]) - float(prev["lon"])
                dist_km = math.sqrt(dlat * dlat + dlon * dlon) * 111.0
                dt_h = max((float(last.get("time", 0)) - float(prev.get("time", 0))) / 3_600_000.0, 0.01)
                speed = min(dist_km / dt_h, 350.0)
            except Exception:
                speed = 0.0

        row = {
            "id": b.get("id"),
            "lat": last.get("lat"),
            "lon": last.get("lon"),
            "alt": round(alt, 1),
            "speed_kmh": round(speed, 1),
        }
        totals.append(row)
        alt_sum += alt
        if alt >= 18000:
            high += 1
        if highest is None or alt > highest["alt"]:
            highest = row
        if fastest is None or speed > fastest["speed_kmh"]:
            fastest = row

    n = len(totals)
    cfg = get_ai_config()
    return {
        "ok": True,
        "total": n,
        "active": n,
        "highAltitude": high,
        "averageAltitudeM": round(alt_sum / n, 1) if n else 0,
        "highest": highest,
        "fastest": fastest,
        "provider": "WindBorne Treasure",
        "dataQuality": "unverified_public_feed",
        "balloonsEnabledInUI": cfg.get("BALLOONS_ENABLED", False),
        "note": (
            "Treasure public feed uses hour-file index IDs; treat as exploratory only."
            if not cfg.get("BALLOONS_ENABLED")
            else None
        ),
        "retrievedAt": _utc_now(),
    }


def find_balloon(balloons: List[Dict[str, Any]], balloon_id: str) -> Dict[str, Any]:
    bid = (balloon_id or "").strip().upper()
    for b in balloons:
        if str(b.get("id", "")).upper() == bid:
            path = b.get("path") or []
            if not path:
                return {"ok": False, "error": "EMPTY_PATH", "balloonId": bid}
            last = path[-1]
            alt = float(last.get("alt") or 0)
            if alt < 100:
                alt *= 1000.0
            return {
                "ok": True,
                "balloon": {
                    "id": b.get("id"),
                    "lat": last.get("lat"),
                    "lon": last.get("lon"),
                    "alt": round(alt, 1),
                    "pathPoints": len(path),
                    "lastTime": last.get("time"),
                },
                "provider": "WindBorne Treasure",
                "dataQuality": "unverified_public_feed",
                "retrievedAt": _utc_now(),
            }
    return {
        "ok": False,
        "error": "NOT_FOUND",
        "message": f"No balloon `{bid}` found in current telemetry.",
        "retrievedAt": _utc_now(),
    }


def look_like_cyclone_query(text: str) -> bool:
    """True for any tropical-cyclone related question (blocks bare geocode)."""
    q = (text or "").strip().lower()
    if not q:
        return False
    keys = (
        "cyclone",
        "cyclones",
        "hurricane",
        "hurricanes",
        "typhoon",
        "typhoons",
        "tropical storm",
        "tropical cyclone",
        "storm list",
        "active storm",
        "atcf",
        "lala",
        "hernan",
        "nangka",
    )
    return any(k in q for k in keys)


def look_like_cyclone_list_query(text: str) -> bool:
    """List / ranking of active storms — NOT a single-storm forecast position."""
    q = (text or "").strip().lower()
    if not q or not look_like_cyclone_query(q):
        return False
    # Forecast-position phrasing should not hit the list path
    if parse_cyclone_forecast_intent(q):
        return False
    list_keys = (
        "list",
        "active",
        "which cyclone",
        "what cyclone",
        "what tropical",
        "strongest",
        "how many cyclone",
        "how many hurricane",
        "storms are",
        "cyclones are",
        "hurricanes are",
    )
    return any(k in q for k in list_keys) or q in (
        "cyclones",
        "hurricanes",
        "tropical cyclones",
        "cyclones list",
    )


def parse_cyclone_forecast_intent(text: str) -> Optional[Dict[str, Any]]:
    """
    Parse 'Where is LALA expected to be in 24 hours?' → name + forecast_hour.
    Returns None if not a single-storm forecast/position question.
    """
    import re

    q = (text or "").strip()
    if not q:
        return None
    lower = q.lower()

    # Must look storm-related or contain a known-style name token
    hour = None
    m = re.search(r"\+(\d{1,3})\s*h\b", lower)
    if m:
        hour = int(m.group(1))
    if hour is None:
        m = re.search(r"\bin\s+(\d{1,3})\s*h(?:ou)?rs?\b", lower)
        if m:
            hour = int(m.group(1))
    if hour is None:
        m = re.search(r"\b(\d{1,3})\s*h(?:ou)?rs?\b", lower)
        if m and any(k in lower for k in ("forecast", "expected", "will", "where", "+")):
            hour = int(m.group(1))
    if hour is None and "tomorrow" in lower:
        hour = 24
    if hour is None and re.search(
        r"(forecast position|expected to be|where will|will .+ be)", lower
    ):
        hour = 24  # implied near-term forecast when no hour given
    if hour is None and re.search(r"where is \w+", lower) and look_like_cyclone_query(lower):
        # "Where is LALA?" → current (+0)
        if not any(k in lower for k in ("expected", "will", "forecast", "tomorrow")):
            hour = 0

    if hour is None:
        return None

    # Extract name/id token
    name = None
    m = re.search(r"\b([A-Z]{2}\d{6})\b", q.upper())
    if m:
        name = m.group(1)
    if not name:
        m = re.search(
            r"\b(?:cyclone|hurricane|typhoon|storm)\s+([A-Za-z]{3,})\b", q, re.I
        )
        if m:
            name = m.group(1)
    if not name:
        m = re.search(
            r"\b(lala|hernan|nangka|[A-Za-z]{3,})\b(?:\s*\+\d|\s+in\s+\d|\s+expected|\s+forecast|\s+be\b)?",
            lower,
        )
        # Prefer explicit known storm words or capitalized tokens
        caps = re.findall(r"\b([A-Z][A-Za-z]{2,})\b", q)
        skip = {
            "Where",
            "What",
            "Show",
            "Will",
            "WeatherMesh",
            "Hours",
            "Hour",
            "Forecast",
            "Position",
            "Tropical",
            "Cyclone",
            "Hurricane",
            "Typhoon",
        }
        caps = [c for c in caps if c not in skip]
        if caps:
            name = caps[0]
        elif m and m.group(1) not in (
            "where",
            "will",
            "this",
            "the",
            "show",
            "what",
            "cyclone",
            "hurricane",
            "expected",
            "forecast",
            "hours",
            "hour",
            "tomorrow",
        ):
            name = m.group(1)

    # "Where will this cyclone be tomorrow?" → selected storm context
    if not name and re.search(r"\bthis\s+(cyclone|hurricane|typhoon|storm)\b", lower):
        name = "__selected__"

    if not name:
        return None
    if name.lower() in ("cyclone", "hurricane", "typhoon", "storm", "tropical"):
        return None

    # Snap to supported hours when close
    supported = (0, 12, 24, 48, 72, 120)
    hour = int(hour)
    if hour not in supported:
        hour = min(supported, key=lambda h: abs(h - hour))

    return {"name_or_id": name.strip(), "forecast_hour": hour}


def look_like_bare_location(text: str) -> bool:
    """Heuristic: place name / place+weather query for deterministic geocode path."""
    q = (text or "").strip()
    if not q or len(q) > 80:
        return False
    if look_like_place_weather_query(q):
        return True
    lower = q.lower()
    blocked = [
        "balloon",
        "fleet",
        "forecast",
        "altitude",
        "how many",
        "what is",
        "why",
        "explain",
        "bedrock",
        "terminator",
        "pressure",
        "humidity",
        "cyclone",
        "hurricane",
        "typhoon",
        "storm",
        "gridded",
        "list",
        "snow",
        "wind",
        "hottest",
        "coldest",
        "top ",
        "strongest",
        "rain",
    ]
    # Allow "... weather" when the rest looks like a place
    if "weather" in lower or "conditions" in lower:
        return look_like_place_weather_query(q)
    if any(b in lower for b in blocked):
        return False
    if look_like_cyclone_query(lower):
        return False
    words = [w for w in q.replace(",", " ").split() if w]
    if 1 <= len(words) <= 6 and all(w[0].isalpha() for w in words if w):
        return True
    return False


# Bedrock Converse tool specs
BEDROCK_TOOLS = [
    {
        "toolSpec": {
            "name": "search_location",
            "description": "Geocode a place name to latitude/longitude using Nominatim. Use for city/region queries like Fairfax, Tokyo, London.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Place name to resolve"}
                    },
                    "required": ["query"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_weather",
            "description": "Get current weather for coordinates via WindBorne WeatherMesh (Open-Meteo only if WeatherMesh fails).",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "latitude": {"type": "number"},
                        "longitude": {"type": "number"},
                    },
                    "required": ["latitude", "longitude"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_fleet_status",
            "description": "Return deterministic fleet statistics computed from WindBorne Treasure telemetry. Call this for any fleet count/altitude question. Never invent numbers.",
            "inputSchema": {"json": {"type": "object", "properties": {}, "required": []}},
        }
    },
    {
        "toolSpec": {
            "name": "get_balloon",
            "description": "Look up one balloon by ID (e.g. WB-12) from current telemetry.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "balloon_id": {"type": "string"},
                    },
                    "required": ["balloon_id"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "list_tropical_cyclones",
            "description": (
                "List active WeatherMesh tropical cyclones. Use ONLY for list/ranking questions "
                "(active storms, strongest cyclone). Do NOT use for 'where will LALA be in 24h'."
            ),
            "inputSchema": {"json": {"type": "object", "properties": {}, "required": []}},
        }
    },
    {
        "toolSpec": {
            "name": "get_tropical_cyclone",
            "description": "Get one WeatherMesh tropical cyclone by ATCF ID (e.g. CP012026).",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {"cyclone_id": {"type": "string"}},
                    "required": ["cyclone_id"],
                    "additionalProperties": False,
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_cyclone_forecast",
            "description": (
                "Get WeatherMesh forecast position for one cyclone at a forecast hour. "
                "cyclone_id may be ATCF id OR storm name (e.g. LALA). Hours: 0,12,24,48,72,120. "
                "Use for 'where will LALA be in 24 hours'. Never invent coordinates."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "cyclone_id": {"type": "string"},
                        "forecast_hour": {"type": "integer"},
                    },
                    "required": ["cyclone_id", "forecast_hour"],
                    "additionalProperties": False,
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "rank_forecast_locations",
            "description": (
                "Deterministic top-N WeatherMesh locations for snowfall, precipitation, wind_speed, "
                "temperature_high, or temperature_low. Pass region as US|North America|Europe|Asia|"
                "current_map_view — never ask users for raw bounding-box coordinates."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "metric": {"type": "string"},
                        "region": {"type": "string"},
                        "forecast_window_hours": {"type": "integer"},
                        "limit": {"type": "integer"},
                    },
                    "required": ["metric"],
                    "additionalProperties": False,
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_gridded_forecast_summary",
            "description": "Deterministic WeatherMesh gridded stats (min/max/mean) for a bbox. Prefer rank_forecast_locations for 'top N' questions.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "variable": {
                            "type": "string",
                            "description": "temperature_2m|pressure_msl|precipitation|wind_speed|snowfall_3h",
                        },
                        "bbox": {
                            "type": "string",
                            "description": "west,south,east,north",
                        },
                        "forecast_hour": {"type": "integer"},
                    },
                    "required": ["variable", "bbox"],
                    "additionalProperties": False,
                }
            },
        }
    },
]


def tools_for_config(
    balloons_enabled: bool = False,
    cyclones_enabled: bool = True,
    gridded_enabled: bool = True,
) -> list:
    """Filter tools by feature flags."""
    deny = set()
    if not balloons_enabled:
        deny |= {"get_fleet_status", "get_balloon"}
    if not cyclones_enabled:
        deny |= {"list_tropical_cyclones", "get_tropical_cyclone", "get_cyclone_forecast"}
    if not gridded_enabled:
        deny |= {"get_gridded_forecast_summary", "rank_forecast_locations"}
    return [
        t
        for t in BEDROCK_TOOLS
        if t.get("toolSpec", {}).get("name") not in deny
    ]
