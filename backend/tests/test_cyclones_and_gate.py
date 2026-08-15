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

    storm = svc.get_storm(payload, "CP012026")
    pt = svc.point_at_hour(storm, 0)
    assert pt is not None
    assert pt["position_source"] == "genesis"
    assert pt["latitude"] == 15.0


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
    assert west == -130


def test_subset_bbox_handles_non_monotonic_and_0_360_lon():
    """Reproduce WeatherMesh-style lon that breaks xarray .sel(slice)."""
    import numpy as np
    import xarray as xr

    from services.gridded import subset_dataarray_bbox

    # Descending lat + 0..360 lon (US west coast ~235.8°E == -124.2°)
    lats = np.linspace(60, 10, 26)
    lons = np.linspace(0, 359, 360)
    data = np.arange(lats.size * lons.size, dtype=float).reshape(lats.size, lons.size)
    da = xr.DataArray(data, coords={"latitude": lats, "longitude": lons}, dims=("latitude", "longitude"))

    arr, out_lats, out_lons = subset_dataarray_bbox(da, -124.2, 25.0, -67.0, 49.0)
    assert arr.ndim == 2
    assert out_lats.min() >= 25.0 - 1e-6
    assert out_lats.max() <= 49.0 + 1e-6
    assert out_lons.min() >= -124.2 - 1e-6
    assert out_lons.max() <= -67.0 + 1e-6
    # Values were remapped into [-180, 180)
    assert np.all(out_lons >= -180) and np.all(out_lons < 180)


def test_subset_bbox_handles_shuffled_longitude_index():
    import numpy as np
    import xarray as xr

    from services.gridded import subset_dataarray_bbox

    lats = np.linspace(20, 50, 16)
    lons = np.array([-130.0, -100.0, -120.0, -80.0, -90.0, -70.0])  # non-monotonic
    data = np.ones((lats.size, lons.size), dtype=float)
    da = xr.DataArray(data, coords={"lat": lats, "lon": lons}, dims=("lat", "lon"))

    arr, out_lats, out_lons = subset_dataarray_bbox(da, -124.2, 25.0, -67.0, 49.0)
    assert arr.size > 0
    assert set(np.round(out_lons, 1)).issubset({-100.0, -120.0, -80.0, -90.0, -70.0})


def test_wb_gate_serves_cache_without_second_fetch(tmp_path):
    gate = WindBorneFetchGate(min_interval_seconds=300, disk_dir=tmp_path)
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


def test_wb_gate_returns_stale_instead_of_sleeping(tmp_path):
    from services.wb_gate import RateLimitedFetch

    gate = WindBorneFetchGate(min_interval_seconds=300, disk_dir=tmp_path)
    calls = {"n": 0}

    async def fetcher():
        calls["n"] += 1
        return {"n": calls["n"]}

    async def run():
        await gate.run("a", fetcher)
        t0 = time.monotonic()
        # Unrelated key while rate window closed → raise quickly (no sleep)
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


def test_wb_gate_reuses_related_family_stale(tmp_path):
    gate = WindBorneFetchGate(min_interval_seconds=300, disk_dir=tmp_path)
    calls = {"n": 0}

    async def fetcher():
        calls["n"] += 1
        return {"bytes": b"grid", "valid_time": f"t{calls['n']}"}

    async def run():
        await gate.run("grid:wm-6:wind_speed_10m:2026-08-15T00:00:00Z", fetcher)
        assert calls["n"] == 1
        # Same variable family, different valid_time — must reuse previous, not raise
        out, from_cache = await gate.run(
            "grid:wm-6:wind_speed_10m:2026-08-16T12:00:00Z", fetcher
        )
        assert from_cache is True
        assert out["valid_time"] == "t1"
        assert calls["n"] == 1

    asyncio.run(run())


def test_wb_gate_persists_to_disk_across_instances(tmp_path):
    """Saved snapshots survive process restart (new gate instance, same disk dir)."""
    calls = {"n": 0}

    async def fetcher():
        calls["n"] += 1
        return {"bytes": b"precip", "valid_time": "t1"}

    async def run():
        g1 = WindBorneFetchGate(min_interval_seconds=300, disk_dir=tmp_path)
        await g1.run("grid:wm-6:precipitation:2026-08-15T00:00:00Z", fetcher)
        assert calls["n"] == 1

        g2 = WindBorneFetchGate(min_interval_seconds=300, disk_dir=tmp_path)
        # Simulate still inside rate window
        g2._last_fetch_at = time.time()
        out, from_cache = await g2.run(
            "grid:wm-6:precipitation:2026-08-16T00:00:00Z", fetcher
        )
        assert from_cache is True
        assert out["bytes"] == b"precip"
        assert calls["n"] == 1  # no second upstream fetch

    asyncio.run(run())


def test_rank_intent_rejects_world_as_need_region():
    from services.forecast_rank import parse_rank_intent

    intent = parse_rank_intent(
        "Show me the 5 locations with the strongest winds in the world over the next 24 hours."
    )
    assert intent is not None
    assert intent["world"] is True
    assert intent["region"] is None


def test_wb_gate_block_true_waits_min_interval(tmp_path):
    gate = WindBorneFetchGate(min_interval_seconds=0.15, disk_dir=tmp_path)
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
