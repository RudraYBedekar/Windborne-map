"""
Deterministic tool executors for Vicky-AI.
The LLM never invents these values — Python computes them from real APIs.
"""
from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from services.ai_config import get_ai_config

logger = logging.getLogger("ai_tools")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


async def search_location(query: str) -> Dict[str, Any]:
    """Resolve a place name via OpenStreetMap Nominatim."""
    q = (query or "").strip()
    if not q:
        return {"ok": False, "error": "EMPTY_QUERY", "results": []}

    url = "https://nominatim.openstreetmap.org/search"
    params = {"format": "json", "q": q, "limit": 5}
    headers = {"User-Agent": "Windborne-VickyAI/1.0 (mission-ops)"}

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, params=params, headers=headers)
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
            return {
                "ok": True,
                "query": q,
                "results": results,
                "provider": "OpenStreetMap Nominatim",
                "retrievedAt": _utc_now(),
            }
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


def look_like_bare_location(text: str) -> bool:
    """Heuristic: bare place name / short location query without weather/fleet keywords."""
    q = (text or "").strip()
    if not q or len(q) > 60:
        return False
    lower = q.lower()
    blocked = [
        "balloon",
        "fleet",
        "weather",
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
    ]
    if any(b in lower for b in blocked):
        return False
    # Single token or short multi-word place-like string
    words = [w for w in q.replace(",", " ").split() if w]
    if 1 <= len(words) <= 4 and all(w[0].isalpha() for w in words if w):
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
]
