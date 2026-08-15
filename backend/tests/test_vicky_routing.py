"""Regression tests: cyclone forecast routing + regional forecast ranking intents."""

from __future__ import annotations

import asyncio

import pytest

from services import ai_tools
from services.cyclones import TropicalCycloneService
from services.forecast_rank import ForecastRankService, parse_rank_intent, resolve_named_region


LALA_STORM = {
    "tropical_cyclone_id": "CP012026",
    "storm_name": "LALA",
    "basins": ["CP"],
    "genesis": {"latitude": 10.0, "longitude": -160.0},
    "start_time": "2026-08-12T00:00:00Z",
    "max_wind_kt": 45,
    "min_mslp_hpa": 1002,
    "path": [
        {
            "valid_at": "2026-08-12T00:00:00Z",
            "forecast_hour": 0,
            "latitude": 12.0,
            "longitude": -158.0,
            "max_wind_kt": 40,
            "min_mslp_hpa": 1004,
            "storm_type": "TS",
        },
        {
            "valid_at": "2026-08-13T00:00:00Z",
            "forecast_hour": 24,
            "latitude": 14.5,
            "longitude": -155.2,
            "max_wind_kt": 50,
            "min_mslp_hpa": 998,
            "storm_type": "TS",
        },
        {
            "valid_at": "2026-08-14T00:00:00Z",
            "forecast_hour": 48,
            "latitude": 17.8,
            "longitude": -152.3,
            "max_wind_kt": 55,
            "min_mslp_hpa": 992,
            "storm_type": "TS",
        },
    ],
}

NO_PATH_STORM = {
    "tropical_cyclone_id": "EP992026",
    "storm_name": "EMPTY",
    "genesis": {"latitude": 15.0, "longitude": -110.0},
    "path": [],
    "max_wind_kt": 30,
    "min_mslp_hpa": 1008,
}


@pytest.mark.parametrize(
    "query,name,hour",
    [
        ("Where is LALA expected to be in 24 hours?", "LALA", 24),
        ("Where will LALA be in 48 hours?", "LALA", 48),
        ("Show LALA's forecast position", "LALA", 24),
        ("LALA +48h", "LALA", 48),
        ("Where will this cyclone be tomorrow?", "__selected__", 24),
        ("Where is LALA expected to be?", "LALA", 24),
    ],
)
def test_cyclone_forecast_intent_phrases(query, name, hour):
    intent = ai_tools.parse_cyclone_forecast_intent(query)
    assert intent is not None, f"expected forecast intent for: {query}"
    assert intent["name_or_id"].upper() == name.upper() or intent["name_or_id"] == name
    assert intent["forecast_hour"] == hour
    # Must not be treated as list routing
    assert not ai_tools.look_like_cyclone_list_query(query)


@pytest.mark.parametrize(
    "query",
    [
        "What tropical cyclones are active?",
        "What cyclones are active?",
        "Which cyclone has the strongest wind?",
        "List tropical cyclones.",
        "cyclones list",
    ],
)
def test_cyclone_list_intent_phrases(query):
    assert ai_tools.look_like_cyclone_list_query(query)
    assert ai_tools.parse_cyclone_forecast_intent(query) is None
    assert parse_rank_intent(query) is None


def test_forecast_position_exact_and_nearest():
    svc = TropicalCycloneService()
    exact = svc.forecast_position(LALA_STORM, 24)
    assert exact["ok"] is True
    assert exact["latitude"] == 14.5
    assert exact["longitude"] == -155.2
    assert exact["forecast_hour"] == 24
    assert exact["nearest_used"] is False
    assert exact["max_wind_kt"] == 50
    assert exact["min_mslp_hpa"] == 998

    nearest = svc.forecast_position(LALA_STORM, 30)
    assert nearest["ok"] is True
    assert nearest["nearest_used"] is True
    assert nearest["forecast_hour"] == 24  # closest path hour
    assert nearest["latitude"] == 14.5


def test_forecast_position_no_path_message():
    svc = TropicalCycloneService()
    out = svc.forecast_position(NO_PATH_STORM, 24)
    assert out["ok"] is False
    assert "WeatherMesh has not published a forecast position for EMPTY at +24h." in out["message"]
    # Genesis must never become a fake +24h point
    assert "latitude" not in out or out.get("latitude") is None


def test_resolve_storm_by_name():
    svc = TropicalCycloneService()
    payload = {"tropical_cyclones": {"CP012026": LALA_STORM}}
    storm = svc.resolve_storm(payload, "LALA")
    assert storm is not None
    assert storm["tropical_cyclone_id"] == "CP012026"


@pytest.mark.parametrize(
    "query,metric,region,limit",
    [
        (
            "Show me the top 5 snowiest locations in the US over the next 24 hours.",
            "snowfall",
            "us",
            5,
        ),
        (
            "Where are the strongest winds in North America?",
            "wind_speed",
            "north america",
            5,
        ),
        ("Show the coldest 5 locations in Europe.", "temperature_low", "europe", 5),
        (
            "Where is precipitation highest in the current map view?",
            "precipitation",
            "current_map_view",
            5,
        ),
        ("Show me the hottest places in Asia.", "temperature_high", "asia", 5),
    ],
)
def test_rank_intent_phrases(query, metric, region, limit):
    intent = parse_rank_intent(query)
    assert intent is not None, f"expected rank intent for: {query}"
    assert intent["metric"] == metric
    assert intent["region"] == region
    assert intent["limit"] == limit


def test_rank_defaults_to_current_hour():
    intent = parse_rank_intent(
        "Show me the 5 locations with the strongest winds in Asia."
    )
    assert intent is not None
    assert intent["forecast_window_hours"] == 0
    assert intent["region"] == "asia"


def test_rank_explicit_24h_still_parsed():
    intent = parse_rank_intent(
        "Show me the top 5 snowiest locations in the US over the next 24 hours."
    )
    assert intent is not None
    assert intent["forecast_window_hours"] == 24


def test_place_weather_resolves_redwood_city():
    assert ai_tools.look_like_place_weather_query(
        "redwood city california usa check weather"
    )
    place = ai_tools.normalize_place_query("redwood city california usa check weather")
    assert "redwood city" in place.lower()
    assert "weather" not in place.lower()


def test_rank_intent_missing_region_asks_later():
    intent = parse_rank_intent("Show me the top 5 snowiest locations.")
    assert intent is not None
    assert intent["metric"] == "snowfall"
    assert intent["region"] is None


def test_rank_need_region_when_no_viewport():
    class DummyGridded:
        model = "wm-6"

    svc = ForecastRankService(DummyGridded())  # type: ignore[arg-type]

    async def run():
        out = await svc.rank_locations(metric="snowfall", region=None, limit=5, map_bounds=None)
        assert out["ok"] is False
        assert out["error"] == "NEED_REGION"
        assert "US, North America, Europe, or Asia" in out["message"]
        assert "bounding box" not in out["message"].lower()
        assert "min latitude" not in out["message"].lower()

    asyncio.run(run())


def test_rank_uses_viewport_when_region_missing():
    class DummyGridded:
        model = "wm-6"
        KNOWN_SNOW = None

        async def rank_extrema(self, **kwargs):
            return (
                [
                    {"latitude": 40.0, "longitude": -105.0, "value": 12.5},
                    {"latitude": 45.0, "longitude": -110.0, "value": 10.0},
                ],
                {
                    "variable": "snowfall_3h",
                    "valid_time": "2026-08-15T00:00:00Z",
                    "initialization_time": "2026-08-14T00:00:00Z",
                    "from_cache": True,
                },
            )

    async def fake_rev(lat, lon):
        return {
            "ok": True,
            "is_city": True,
            "city": f"City{int(lat)}",
            "state": "Colorado",
            "country": "United States",
            "location": f"City{int(lat)}, Colorado",
        }

    orig = ai_tools.reverse_geocode_city
    ai_tools.reverse_geocode_city = fake_rev  # type: ignore[assignment]
    try:
        svc = ForecastRankService(DummyGridded())  # type: ignore[arg-type]

        async def run():
            out = await svc.rank_locations(
                metric="snowfall",
                region=None,
                forecast_window_hours=24,
                limit=2,
                map_bounds={"west": -125, "south": 24, "east": -66, "north": 50},
            )
            assert out["ok"] is True
            assert out["region"]["used"] == "current_map_view"
            assert len(out["locations"]) == 2
            assert out["locations"][0]["value"] == 12.5
            assert "City" in out["locations"][0]["location"]
            assert out["variable"] == "snowfall_3h"

        asyncio.run(run())
    finally:
        ai_tools.reverse_geocode_city = orig  # type: ignore[assignment]


def test_named_regions_resolve():
    us = resolve_named_region("US")
    assert us and us["kind"] == "named"
    assert us["bbox"][0] == -124.2
    assert resolve_named_region("current_map_view")["kind"] == "viewport"


def test_rank_skips_ocean_keeps_cities():
    class DummyGridded:
        model = "wm-6"

        async def rank_extrema(self, **kwargs):
            return (
                [
                    {"latitude": 39.75, "longitude": -125.0, "value": 12.0},
                    {"latitude": 39.74, "longitude": -104.99, "value": 11.0},
                    {"latitude": 34.05, "longitude": -118.24, "value": 10.5},
                ],
                {
                    "variable": "wind_speed_10m",
                    "valid_time": "2026-08-16T00:00:00Z",
                    "initialization_time": "2026-08-15T00:00:00Z",
                    "from_cache": True,
                },
            )

    async def fake_city(lat, lon):
        if lon <= -124.5:
            return {"ok": True, "is_city": False, "reason": "ocean_or_water"}
        if abs(lat - 39.74) < 0.1:
            return {
                "ok": True,
                "is_city": True,
                "city": "Denver",
                "state": "Colorado",
                "country": "United States",
                "location": "Denver, Colorado",
            }
        return {
            "ok": True,
            "is_city": True,
            "city": "Los Angeles",
            "state": "California",
            "country": "United States",
            "location": "Los Angeles, California",
        }

    orig = ai_tools.reverse_geocode_city
    ai_tools.reverse_geocode_city = fake_city  # type: ignore[assignment]
    try:
        svc = ForecastRankService(DummyGridded())  # type: ignore[arg-type]

        async def run():
            out = await svc.rank_locations(
                metric="wind_speed", region="us", limit=5, forecast_window_hours=24
            )
            assert out["ok"] is True
            assert len(out["locations"]) == 2
            assert out["locations"][0]["location"] == "Denver, Colorado"
            assert out["locations"][1]["location"] == "Los Angeles, California"
            assert out["skipped_non_city"] == 1

        asyncio.run(run())
    finally:
        ai_tools.reverse_geocode_city = orig  # type: ignore[assignment]


def test_bedrock_routes_forecast_not_list(monkeypatch):
    from services.bedrock import BedrockChatService

    svc = BedrockChatService(cyclone_service=TropicalCycloneService())
    svc.cyclones_enabled = True

    async def fake_exec(name, tool_input):
        assert name == "get_cyclone_forecast"
        assert tool_input["cyclone_id"].upper() == "LALA"
        assert tool_input["forecast_hour"] == 24
        return {
            "ok": True,
            "cyclone_id": "CP012026",
            "storm_name": "LALA",
            "forecast_hour": 24,
            "nearest_used": False,
            "latitude": 14.5,
            "longitude": -155.2,
            "valid_at": "2026-08-13T00:00:00Z",
            "max_wind_kt": 50,
            "min_mslp_hpa": 998,
            "initialization_time": "2026-08-12T00:00:00Z",
        }

    monkeypatch.setattr(svc, "_execute_tool", fake_exec)

    async def run():
        out = await svc.generate_response(
            [{"role": "user", "content": "Where is LALA expected to be in 24 hours?"}]
        )
        assert out["toolCalls"][0]["name"] == "get_cyclone_forecast"
        assert any(a["type"] == "FLY_TO_LOCATION" for a in out["actions"])
        assert "14.500" in out["reply"] or "14.5" in out["reply"]

    asyncio.run(run())


def test_bedrock_routes_list_not_forecast(monkeypatch):
    from services.bedrock import BedrockChatService

    svc = BedrockChatService(cyclone_service=TropicalCycloneService())
    svc.cyclones_enabled = True

    async def fake_exec(name, tool_input):
        assert name == "list_tropical_cyclones"
        return {
            "ok": True,
            "cyclones": [
                {
                    "tropical_cyclone_id": "CP012026",
                    "storm_name": "LALA",
                    "max_wind_kt": 50,
                    "min_mslp_hpa": 998,
                }
            ],
        }

    monkeypatch.setattr(svc, "_execute_tool", fake_exec)

    async def run():
        out = await svc.generate_response(
            [{"role": "user", "content": "What tropical cyclones are active?"}]
        )
        assert out["toolCalls"][0]["name"] == "list_tropical_cyclones"

    asyncio.run(run())


def test_bedrock_rank_asks_region_without_bbox(monkeypatch):
    from services.bedrock import BedrockChatService
    from services.forecast_rank import ForecastRankService

    class DummyGridded:
        model = "wm-6"

    rank = ForecastRankService(DummyGridded())  # type: ignore[arg-type]
    svc = BedrockChatService(rank_service=rank, gridded_service=DummyGridded())
    svc.gridded_enabled = True

    async def run():
        out = await svc.generate_response(
            [{"role": "user", "content": "Show me the top 5 snowiest locations."}]
        )
        assert out["toolCalls"][0]["name"] == "rank_forecast_locations"
        assert "US, North America, Europe, or Asia" in out["reply"]
        assert "bounding box" not in out["reply"].lower()

    asyncio.run(run())
