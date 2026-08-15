"""Tests for tropical cyclone normalize/geojson and WindBorne 5-minute fetch gate."""

from __future__ import annotations

import asyncio
import time

import pytest

from services.cyclones import TropicalCycloneService
from services.gridded import parse_bbox
from services.wb_gate import WindBorneFetchGate


SAMPLE_STORM = {
    "tropical_cyclone_id": "EP082026",
    "storm_name": "HERNAN",
    "basins": ["EP"],
    "genesis": {"latitude": 15.0, "longitude": -110.0},
    "start_time": "2026-08-10T00:00:00Z",
    "end_time": "2026-08-14T00:00:00Z",
    "max_wind_kt": 65,
    "min_mslp_hpa": 990,
    "path": [
        {
            "valid_at": "2026-08-12T00:00:00Z",
            "forecast_hour": 0,
            "latitude": 16.1,
            "longitude": -112.2,
            "max_wind_kt": 60,
            "min_mslp_hpa": 992,
            "storm_type": "TS",
            "contributing_members_count": 20,
        },
        {
            "valid_at": "2026-08-13T00:00:00Z",
            "forecast_hour": 24,
            "latitude": 17.5,
            "longitude": -114.0,
            "max_wind_kt": 55,
            "min_mslp_hpa": 995,
            "storm_type": "TS",
            "contributing_members_count": 18,
        },
    ],
    "landfalls": [
        {
            "valid_at": "2026-08-14T12:00:00Z",
            "latitude": 22.0,
            "longitude": -109.5,
            "max_wind_kt": 40,
            "min_mslp_hpa": 1000,
            "storm_type": "TS",
            "ensemble_member": 3,
        }
    ],
    "cone": {
        "members_total": 50,
        "max_forecast_hour": 120,
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [-115, 15],
                    [-110, 15],
                    [-110, 20],
                    [-115, 20],
                    [-115, 15],
                ]
            ],
        },
    },
}


def test_normalize_and_point_at_hour():
    svc = TropicalCycloneService()
    raw = {
        "initialization_time": "2026-08-12T00:00:00Z",
        "forecast_zero": "2026-08-12T00:00:00Z",
        "tropical_cyclones": {"EP082026": SAMPLE_STORM},
        "total": 1,
    }
    payload = svc._normalize_payload(raw, from_cache=False)
    assert payload["ok"] is True
    storm = svc.get_storm(payload, "ep082026")
    assert storm is not None
    assert storm["storm_name"] == "HERNAN"
    pt0 = svc.point_at_hour(storm, 0)
    assert pt0["latitude"] == 16.1
    pt12 = svc.point_at_hour(storm, 12)
    assert pt12["forecast_hour"] in (0, 24)


def test_null_path_uses_genesis_in_geojson():
    svc = TropicalCycloneService()
    empty = {
        **SAMPLE_STORM,
        "path": [],
        "cone": None,
        "max_wind_kt": None,
        "min_mslp_hpa": None,
        "storm_name": None,
    }
    payload = svc._normalize_payload(
        {"tropical_cyclones": {"CP012026": empty}, "total": 1},
        from_cache=True,
    )
    gj = svc.to_geojson(payload, forecast_hour=0)
    positions = [f for f in gj["features"] if f["properties"]["feature_type"] == "position"]
    assert len(positions) == 1
    assert positions[0]["properties"].get("position_source") == "genesis"
    assert positions[0]["geometry"]["coordinates"] == [-110.0, 15.0]


def test_geojson_includes_path_cone_and_ensemble_landfalls():
    svc = TropicalCycloneService()
    payload = svc._normalize_payload(
        {"tropical_cyclones": {"EP082026": SAMPLE_STORM}, "total": 1},
        from_cache=False,
    )
    gj = svc.to_geojson(payload, forecast_hour=24, include_ensemble=True, selected_id="EP082026")
    types = {f["properties"]["feature_type"] for f in gj["features"]}
    assert "mean_path" in types
    assert "uncertainty_cone" in types
    assert "position" in types
    assert "landfall" in types
    pos = next(f for f in gj["features"] if f["properties"]["feature_type"] == "position")
    assert pos["geometry"]["coordinates"] == [-114.0, 17.5]
    assert pos["properties"]["selected"] is True


def test_parse_bbox_rejects_huge_area():
    with pytest.raises(ValueError):
        parse_bbox("-180,-90,180,90")
    west, south, east, north = parse_bbox("-130,20,-60,55")
    assert west == -130 and north == 55


def test_wb_gate_serves_cache_without_second_fetch():
    gate = WindBorneFetchGate(min_interval_seconds=300)
    calls = {"n": 0}

    async def fetcher():
        calls["n"] += 1
        return {"ok": True, "n": calls["n"]}

    async def run():
        a, cached_a = await gate.run("k1", fetcher)
        b, cached_b = await gate.run("k1", fetcher)
        assert a == b
        assert cached_a is False
        assert cached_b is True
        assert calls["n"] == 1

    asyncio.run(run())


def test_wb_gate_returns_stale_instead_of_sleeping():
    from services.wb_gate import RateLimitedFetch

    gate = WindBorneFetchGate(min_interval_seconds=300)
    calls = {"n": 0}

    async def fetcher():
        calls["n"] += 1
        return {"n": calls["n"]}

    async def run():
        await gate.run("a", fetcher)
        t0 = time.monotonic()
        # Different key while rate window closed → stale miss → raise quickly (no sleep)
        try:
            await gate.run("b", fetcher)
            assert False, "expected RateLimitedFetch"
        except RateLimitedFetch as e:
            assert e.retry_after > 0
        assert time.monotonic() - t0 < 1.0
        assert calls["n"] == 1

        # After caching key b via force, later gated miss returns stale
        await gate.run("b", fetcher, force=True)
        assert calls["n"] == 2
        out, from_cache = await gate.run("b", fetcher)
        assert from_cache is True
        assert out["n"] == 2

    asyncio.run(run())


def test_wb_gate_block_true_waits_min_interval():
    gate = WindBorneFetchGate(min_interval_seconds=0.15)
    calls = {"n": 0}

    async def fetcher():
        calls["n"] += 1
        return calls["n"]

    async def run():
        await gate.run("a", fetcher)
        t0 = time.monotonic()
        await gate.run("b", fetcher, block=True)
        elapsed = time.monotonic() - t0
        assert calls["n"] == 2
        assert elapsed >= 0.12

    asyncio.run(run())
