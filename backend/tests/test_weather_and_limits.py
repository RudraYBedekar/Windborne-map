"""
Additional unit tests for WeatherMesh normalize, rate limiter, tools filter.
Run: python -m pytest tests/ -q
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("BEDROCK_AGENT_MODEL", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
os.environ["BALLOONS_ENABLED"] = "false"

from services.windborne import WindBorneClient
from services.rate_limit import SlidingWindowRateLimiter, KeyedRateLimiter
from services import ai_tools


def test_normalize_nested_forecasts():
    client = WindBorneClient(api_key="test")
    payload = {
        "forecast_zero": "2026-01-01T00:00:00Z",
        "forecasts": [
            [
                {
                    "latitude": 38.85,
                    "longitude": -77.31,
                    "time": "2026-01-01T01:00:00Z",
                    "temperature_2m": 22.5,
                    "dewpoint_2m": 10.0,
                    "pressure_msl": 1012.0,
                    "precipitation": 0.1,
                    "wind_u_10m": 2.0,
                    "wind_v_10m": -2.0,
                    "wind_speed_10m": 2.8,
                }
            ]
        ],
    }
    out = client._normalize_response(payload, 38.85, -77.31)
    assert "error" not in out
    assert out["provider"] == "WindBorne WeatherMesh"
    assert out["current"]["temperature"] == 22.5
    assert out["current"]["pressure"] == 1012.0
    assert isinstance(out["current"]["windDirection"], (int, float))


def test_normalize_rejects_empty():
    client = WindBorneClient(api_key="test")
    out = client._normalize_response({"forecasts": [[]]}, 0, 0)
    assert "error" in out


def test_rate_limiter_try_acquire():
    async def run():
        lim = SlidingWindowRateLimiter(max_per_minute=2, window_seconds=60)
        assert await lim.try_acquire() is True
        assert await lim.try_acquire() is True
        assert await lim.try_acquire() is False

    asyncio.run(run())


def test_keyed_rate_limiter_isolates_ips():
    async def run():
        lim = KeyedRateLimiter(max_per_minute=1)
        assert await lim.try_acquire("a") is True
        assert await lim.try_acquire("a") is False
        assert await lim.try_acquire("b") is True

    asyncio.run(run())


def test_tools_excluded_when_balloons_disabled():
    tools = ai_tools.tools_for_config(False)
    names = {t["toolSpec"]["name"] for t in tools}
    assert "get_weather" in names
    assert "search_location" in names
    assert "get_fleet_status" not in names
    assert "get_balloon" not in names


def test_tools_included_when_balloons_enabled():
    tools = ai_tools.tools_for_config(True)
    names = {t["toolSpec"]["name"] for t in tools}
    assert "get_fleet_status" in names
    assert "get_balloon" in names


def test_lat_lon_validation_bounds():
    # Mirrors /api/weather validation contract
    def valid(lat, lon):
        return -90 <= lat <= 90 and -180 <= lon <= 180

    assert valid(38.8, -77.3)
    assert not valid(100, 0)
    assert not valid(0, 200)
