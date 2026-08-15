"""WeatherMesh-6 gridded forecast → cached subset + PNG / summary stats.

Upstream fetches are gated to WB_MIN_REQUEST_INTERVAL_SEC (default 300s).
"""

from __future__ import annotations

import io
import logging
import math
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx

from services.wb_gate import RateLimitedFetch, wb_fetch_gate

logger = logging.getLogger("gridded_service")

# Confirmed present on wm-6 during access check; precip name verified at runtime.
KNOWN_VARS = {
    "temperature_2m": {"units": "°C", "label": "Temperature"},
    "pressure_msl": {"units": "hPa", "label": "Pressure"},
    "wind_u_10m": {"units": "m/s", "label": "Wind U"},
    "wind_v_10m": {"units": "m/s", "label": "Wind V"},
    "wind_speed_10m": {"units": "m/s", "label": "Wind speed"},
    "snowfall_3h": {"units": "mm", "label": "3h snowfall"},
}

PRECIP_CANDIDATES = (
    "total_precipitation",
    "precipitation",
    "precip",
    "tp",
    "total_precipitation_3h",
    "precipitation_rate",
)

SNOW_CANDIDATES = (
    "snowfall_3h",
    "snowfall",
    "snow",
)

FORECAST_HOURS = (0, 3, 6, 12, 24, 48, 72)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_bbox(bbox: str) -> Tuple[float, float, float, float]:
    """west,south,east,north"""
    parts = [p.strip() for p in (bbox or "").split(",")]
    if len(parts) != 4:
        raise ValueError("bbox must be west,south,east,north")
    west, south, east, north = map(float, parts)
    if not (-180 <= west < east <= 180):
        raise ValueError("Invalid longitude bounds")
    if not (-90 <= south < north <= 90):
        raise ValueError("Invalid latitude bounds")
    # Cap area (~CONUS-sized): 70° lon x 35° lat
    if (east - west) * (north - south) > 70 * 35:
        raise ValueError("Requested bbox is too large; shrink the region.")
    return west, south, east, north


class GriddedForecastService:
    def __init__(self, http_client: Optional[httpx.AsyncClient] = None):
        self.enabled = os.getenv("GRIDDED_FORECASTS_ENABLED", "true").lower() in (
            "true",
            "1",
            "yes",
        )
        self.api_key = (
            os.getenv("WB_API_KEY")
            or os.getenv("WINDBORNE_TOKEN")
            or os.getenv("WINDBORNE_API_KEY")
            or ""
        ).strip()
        self.base_url = (
            os.getenv("WINDBORNE_BASE_URL") or "https://api.windbornesystems.com"
        ).rstrip("/")
        self.model = os.getenv("WEATHERMESH_MODEL", "wm-6")
        self._http = http_client
        self._variables_cache: Optional[Dict[str, Any]] = None
        self._png_cache: Dict[str, Tuple[float, bytes, dict]] = {}
        self.last_error: Optional[str] = None
        self.precip_variable: Optional[str] = None

    def set_http_client(self, client: Optional[httpx.AsyncClient]) -> None:
        self._http = client

    def capability(self) -> dict:
        return {
            "enabled": self.enabled,
            "model": self.model,
            "has_wb_key": bool(self.api_key),
            "endpoint": f"/forecasts/v1/{self.model}/gridded",
            "min_request_interval_seconds": wb_fetch_gate.min_interval,
            "forecast_hours": list(FORECAST_HOURS),
            "supported_variables": sorted(KNOWN_VARS.keys())
            + (["precipitation"] if self.precip_variable else []),
            "precip_variable": self.precip_variable,
            "last_error": self.last_error,
            "gate": wb_fetch_gate.status(),
            "deps_ready": self._deps_ready(),
        }

    def _deps_ready(self) -> bool:
        try:
            import numpy  # noqa: F401
            import xarray  # noqa: F401
            import h5netcdf  # noqa: F401
            from PIL import Image  # noqa: F401

            return True
        except Exception:
            return False

    def _headers(self) -> Dict[str, str]:
        h = {"Accept": "*/*", "User-Agent": "Windborne-GriddedMode/1.0"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    async def _get(self, url: str, params: Optional[dict] = None) -> httpx.Response:
        if self._http is not None:
            return await self._http.get(
                url, params=params, headers=self._headers(), follow_redirects=True
            )
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            return await client.get(url, params=params, headers=self._headers())

    async def list_variables(self, force: bool = False) -> Dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": "GRIDDED_DISABLED", "variables": []}
        if not self.api_key:
            return {"ok": False, "error": "MISSING_API_KEY", "variables": []}

        cache_key = f"vars:{self.model}"

        async def fetcher():
            url = f"{self.base_url}/forecasts/v1/{self.model}/variables"
            resp = await self._get(url)
            if resp.status_code >= 400:
                raise RuntimeError(f"variables HTTP {resp.status_code}")
            return resp.json()

        try:
            raw, from_cache = await wb_fetch_gate.run(cache_key, fetcher, force=force)
            self._variables_cache = raw if isinstance(raw, dict) else {}
            sfc = self._variables_cache.get("sfc_variables") or []
            for cand in PRECIP_CANDIDATES:
                if cand in sfc:
                    self.precip_variable = cand
                    break
            return {
                "ok": True,
                "from_cache": from_cache,
                "sfc_variables": sfc,
                "precip_variable": self.precip_variable,
                "retrievedAt": _utc_now(),
            }
        except RateLimitedFetch as e:
            stale = wb_fetch_gate.stale_get(cache_key)
            if isinstance(stale, dict):
                self._variables_cache = stale
                return {
                    "ok": True,
                    "from_cache": True,
                    "sfc_variables": stale.get("sfc_variables") or [],
                    "precip_variable": self.precip_variable,
                    "warning": str(e),
                    "retrievedAt": _utc_now(),
                }
            return {
                "ok": False,
                "error": "RATE_GATED",
                "message": str(e),
                "retry_after_seconds": e.retry_after,
                "variables": [],
            }
        except Exception as e:
            self.last_error = str(e)
            return {"ok": False, "error": type(e).__name__, "message": str(e), "variables": []}

    def resolve_variable(self, variable: str) -> str:
        v = (variable or "").strip()
        if v in ("precipitation", "precip"):
            if self.precip_variable:
                return self.precip_variable
            # Prefer documented candidates until variables cache is warm
            return PRECIP_CANDIDATES[0]
        if v in ("snowfall", "snow", "snowfall_3h"):
            return "snowfall_3h"
        if v == "wind_speed" or v == "wind":
            return "wind_speed_10m"
        if v not in KNOWN_VARS and v not in PRECIP_CANDIDATES and v not in SNOW_CANDIDATES:
            raise ValueError(f"Unsupported variable: {variable}")
        return v

    def _valid_time_for_hour(self, forecast_hour: int) -> str:
        # Align to current UTC hour + forecast_hour
        now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        t = now + timedelta(hours=int(forecast_hour))
        return t.strftime("%Y-%m-%dT%H:00:00Z")

    async def get_summary(
        self,
        variable: str,
        bbox: str,
        forecast_hour: int = 0,
    ) -> Dict[str, Any]:
        """Deterministic regional stats for Vicky-AI (never send full grid to LLM)."""
        if not self.enabled:
            return {"ok": False, "error": "GRIDDED_DISABLED"}
        if not self._deps_ready():
            return {
                "ok": False,
                "error": "DEPS_MISSING",
                "message": "Install xarray, numpy, and pillow for gridded forecasts.",
            }

        try:
            west, south, east, north = parse_bbox(bbox)
            var = self.resolve_variable(variable)
            hour = int(forecast_hour)
            if hour not in FORECAST_HOURS:
                raise ValueError(f"forecast_hour must be one of {FORECAST_HOURS}")
        except ValueError as e:
            return {"ok": False, "error": "VALIDATION", "message": str(e)}

        try:
            arr, meta = await self._load_subset(var, hour, west, south, east, north)
        except Exception as e:
            self.last_error = str(e)
            return {"ok": False, "error": type(e).__name__, "message": str(e)}

        import numpy as np

        flat = np.asarray(arr, dtype=float).ravel()
        flat = flat[np.isfinite(flat)]
        if flat.size == 0:
            return {
                "ok": False,
                "error": "EMPTY_GRID",
                "message": "No finite values in requested region.",
            }

        units = KNOWN_VARS.get(var, {}).get("units", "")
        if var == "wind_speed_10m":
            # values already m/s; also expose km/h for UI clarity
            return {
                "ok": True,
                "variable": var,
                "forecastHour": hour,
                "bbox": {"west": west, "south": south, "east": east, "north": north},
                "minimum": float(np.min(flat)),
                "maximum": float(np.max(flat)),
                "mean": float(np.mean(flat)),
                "units": "m/s",
                "maximum_kmh": float(np.max(flat) * 3.6),
                "mean_kmh": float(np.mean(flat) * 3.6),
                "provider": "WindBorne WeatherMesh",
                "model": self.model,
                "initialization_time": meta.get("initialization_time"),
                "valid_time": meta.get("valid_time"),
                "from_cache": meta.get("from_cache"),
                "retrievedAt": _utc_now(),
            }

        return {
            "ok": True,
            "variable": var,
            "forecastHour": hour,
            "bbox": {"west": west, "south": south, "east": east, "north": north},
            "minimum": float(np.min(flat)),
            "maximum": float(np.max(flat)),
            "mean": float(np.mean(flat)),
            "units": units,
            "provider": "WindBorne WeatherMesh",
            "model": self.model,
            "initialization_time": meta.get("initialization_time"),
            "valid_time": meta.get("valid_time"),
            "from_cache": meta.get("from_cache"),
            "retrievedAt": _utc_now(),
        }

    async def get_png(
        self,
        variable: str,
        bbox: str,
        forecast_hour: int = 0,
        resolution: int = 128,
    ) -> Tuple[bytes, Dict[str, Any]]:
        if not self.enabled:
            raise PermissionError("Gridded forecasts disabled")
        if not self._deps_ready():
            raise RuntimeError("Missing Python deps: xarray, numpy, pillow")

        west, south, east, north = parse_bbox(bbox)
        var = self.resolve_variable(variable)
        hour = int(forecast_hour)
        if hour not in FORECAST_HOURS:
            raise ValueError(f"forecast_hour must be one of {FORECAST_HOURS}")
        resolution = max(32, min(int(resolution), 256))

        cache_key = f"png:{var}:{hour}:{west}:{south}:{east}:{north}:{resolution}"
        hit = self._png_cache.get(cache_key)
        if hit and time.time() < hit[0]:
            return hit[1], hit[2]

        arr, meta = await self._load_subset(var, hour, west, south, east, north)
        png = self._array_to_png(arr, var, resolution)
        meta = {
            **meta,
            "variable": var,
            "forecast_hour": hour,
            "bbox": [west, south, east, north],
            "coordinates": [[west, south], [east, south], [east, north], [west, north]],
            "provider": "WindBorne WeatherMesh",
            "model": self.model,
        }
        self._png_cache[cache_key] = (time.time() + wb_fetch_gate.min_interval, png, meta)
        return png, meta

    async def _load_subset(
        self,
        variable: str,
        forecast_hour: int,
        west: float,
        south: float,
        east: float,
        north: float,
    ):
        import numpy as np

        # Wind speed derived from u/v under a single gated cycle (avoid 5+5 min wait)
        if variable == "wind_speed_10m":
            valid_time = self._valid_time_for_hour(forecast_hour)
            cache_key = f"grid:{self.model}:wind_speed_10m:{valid_time}:{west}:{south}:{east}:{north}"

            async def fetcher_speed():
                u_bytes = await self._download_variable_bytes("wind_u_10m", valid_time)
                # small pause not needed — same minute budget if sequential; gate already waited once
                v_bytes = await self._download_variable_bytes("wind_v_10m", valid_time)
                return {"u": u_bytes, "v": v_bytes, "valid_time": valid_time}

            try:
                raw, from_cache = await wb_fetch_gate.run(cache_key, fetcher_speed)
            except RateLimitedFetch as e:
                stale = wb_fetch_gate.stale_get(cache_key)
                if stale is None:
                    raise RuntimeError(str(e)) from e
                raw, from_cache = stale, True
            u = self._netcdf_bytes_to_subset(raw["u"], west, south, east, north)
            v = self._netcdf_bytes_to_subset(raw["v"], west, south, east, north)
            speed = np.sqrt(np.asarray(u, dtype=float) ** 2 + np.asarray(v, dtype=float) ** 2)
            meta = {
                "valid_time": raw.get("valid_time"),
                "initialization_time": None,
                "from_cache": from_cache,
                "variable": "wind_speed_10m",
                "derived_from": ["wind_u_10m", "wind_v_10m"],
            }
            return speed, meta

        valid_time = self._valid_time_for_hour(forecast_hour)
        cache_key = f"grid:{self.model}:{variable}:{valid_time}"

        async def fetcher():
            content = await self._download_variable_bytes(variable, valid_time)
            return {"bytes": content, "valid_time": valid_time}

        try:
            raw, from_cache = await wb_fetch_gate.run(cache_key, fetcher)
        except RateLimitedFetch as e:
            stale = wb_fetch_gate.stale_get(cache_key)
            if stale is None:
                raise RuntimeError(str(e)) from e
            raw, from_cache = stale, True
        arr = self._netcdf_bytes_to_subset(raw["bytes"], west, south, east, north)
        meta = {
            "valid_time": raw.get("valid_time"),
            "initialization_time": None,
            "from_cache": from_cache,
            "variable": variable,
        }
        return arr, meta

    async def _download_variable_bytes(self, variable: str, valid_time: str) -> bytes:
        url = f"{self.base_url}/forecasts/v1/{self.model}/gridded"
        params = {
            "variable": variable,
            "time": valid_time,
            "format": "netcdf",
            "include_distribution": "false",
        }
        resp = await self._get(url, params=params)
        if resp.status_code == 429:
            raise RuntimeError("WindBorne rate limited (429). Retry after 5 minutes.")
        if resp.status_code in (401, 403):
            raise PermissionError("WindBorne API key cannot access gridded forecasts.")
        if resp.status_code == 404:
            raise FileNotFoundError(f"No gridded forecast for {variable} at {valid_time}")
        if resp.status_code >= 400:
            raise RuntimeError(f"Gridded forecast failed ({resp.status_code})")
        return resp.content

    def _open_netcdf_bytes(self, content: bytes):
        """Open WeatherMesh NetCDF bytes with available xarray engines."""
        import xarray as xr

        last_err: Optional[Exception] = None
        for engine in ("h5netcdf", "netcdf4", None):
            try:
                kwargs = {"engine": engine} if engine else {}
                return xr.open_dataset(io.BytesIO(content), **kwargs)
            except Exception as e:
                last_err = e
                continue
        msg = str(last_err or "Could not open NetCDF")
        if "h5netcdf" in msg.lower() or "backends" in msg.lower():
            raise RuntimeError(
                "WeatherMesh NetCDF needs the `h5netcdf` package. "
                "Install backend deps: pip install h5netcdf h5py netCDF4"
            ) from last_err
        raise RuntimeError(msg) from last_err

    def _netcdf_bytes_to_subset(
        self, content: bytes, west: float, south: float, east: float, north: float
    ):
        import numpy as np

        ds = self._open_netcdf_bytes(content)
        data_vars = list(ds.data_vars)
        if not data_vars:
            ds.close()
            raise RuntimeError("NetCDF contained no data variables")
        da = ds[data_vars[0]]
        while da.ndim > 2:
            da = da.isel({da.dims[0]: 0})

        lat_name = next((d for d in da.dims if "lat" in d.lower()), None)
        lon_name = next((d for d in da.dims if "lon" in d.lower()), None)
        if not lat_name or not lon_name:
            lat_name = next((c for c in da.coords if "lat" in c.lower()), None)
            lon_name = next((c for c in da.coords if "lon" in c.lower()), None)
        if not lat_name or not lon_name:
            ds.close()
            raise RuntimeError("Could not identify lat/lon dimensions in NetCDF")

        lat = da[lat_name]
        lat_asc = bool(lat.values[0] < lat.values[-1])
        if lat_asc:
            da = da.sel({lat_name: slice(south, north), lon_name: slice(west, east)})
        else:
            da = da.sel({lat_name: slice(north, south), lon_name: slice(west, east)})

        arr = np.asarray(da.values, dtype=float)
        ds.close()
        return arr

    def _netcdf_bytes_to_subset_coords(
        self, content: bytes, west: float, south: float, east: float, north: float
    ):
        """Return (2D array, lat_1d, lon_1d) for ranking."""
        import numpy as np

        ds = self._open_netcdf_bytes(content)
        data_vars = list(ds.data_vars)
        if not data_vars:
            ds.close()
            raise RuntimeError("NetCDF contained no data variables")
        da = ds[data_vars[0]]
        while da.ndim > 2:
            da = da.isel({da.dims[0]: 0})

        lat_name = next((d for d in da.dims if "lat" in d.lower()), None)
        lon_name = next((d for d in da.dims if "lon" in d.lower()), None)
        if not lat_name or not lon_name:
            lat_name = next((c for c in da.coords if "lat" in c.lower()), None)
            lon_name = next((c for c in da.coords if "lon" in c.lower()), None)
        if not lat_name or not lon_name:
            ds.close()
            raise RuntimeError("Could not identify lat/lon dimensions in NetCDF")

        lat = da[lat_name]
        lat_asc = bool(lat.values[0] < lat.values[-1])
        if lat_asc:
            da = da.sel({lat_name: slice(south, north), lon_name: slice(west, east)})
        else:
            da = da.sel({lat_name: slice(north, south), lon_name: slice(west, east)})

        arr = np.asarray(da.values, dtype=float)
        lats = np.asarray(da[lat_name].values, dtype=float)
        lons = np.asarray(da[lon_name].values, dtype=float)
        ds.close()
        return arr, lats, lons

    async def rank_extrema(
        self,
        variable: str,
        bbox: str,
        forecast_hour: int = 24,
        limit: int = 5,
        maximize: bool = True,
        min_separation_deg: float = 2.0,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """Deterministic top-N grid extrema with spatial separation."""
        import numpy as np

        if not self.enabled:
            raise PermissionError("Gridded forecasts disabled")
        if not self._deps_ready():
            raise RuntimeError("Missing Python deps: xarray, numpy, pillow, h5netcdf")

        west, south, east, north = parse_bbox(bbox)
        var = self.resolve_variable(variable)
        hour = int(forecast_hour)
        if hour not in FORECAST_HOURS:
            raise ValueError(f"forecast_hour must be one of {FORECAST_HOURS}")

        # Load with coordinates
        if var == "wind_speed_10m":
            arr, meta = await self._load_subset(var, hour, west, south, east, north)
            # Rebuild coords via a lightweight u download cache if possible — approximate mesh
            # from bbox linspace when wind is derived (coords not returned by _load_subset).
            h, w = np.asarray(arr).shape[:2]
            lats = np.linspace(north, south, h)
            lons = np.linspace(west, east, w)
        else:
            valid_time = self._valid_time_for_hour(hour)
            cache_key = f"grid:{self.model}:{var}:{valid_time}"

            async def fetcher():
                content = await self._download_variable_bytes(var, valid_time)
                return {"bytes": content, "valid_time": valid_time}

            try:
                raw, from_cache = await wb_fetch_gate.run(cache_key, fetcher)
            except RateLimitedFetch as e:
                stale = wb_fetch_gate.stale_get(cache_key)
                if stale is None:
                    raise RuntimeError(str(e)) from e
                raw, from_cache = stale, True
            arr, lats, lons = self._netcdf_bytes_to_subset_coords(
                raw["bytes"], west, south, east, north
            )
            meta = {
                "valid_time": raw.get("valid_time"),
                "initialization_time": None,
                "from_cache": from_cache,
                "variable": var,
            }

        a = np.asarray(arr, dtype=float)
        if a.ndim != 2:
            a = np.squeeze(a)
        if a.ndim != 2:
            raise RuntimeError("Expected 2D grid for ranking")

        # Coarsen for ranking stability / speed
        step = max(1, min(a.shape[0], a.shape[1]) // 64)
        work = a[::step, ::step]
        lat_w = lats[::step] if lats.ndim == 1 else lats[::step, 0]
        lon_w = lons[::step] if lons.ndim == 1 else lons[0, ::step]

        flat = work.ravel()
        finite = np.isfinite(flat)
        if not np.any(finite):
            raise RuntimeError("No finite values in region for ranking")

        min_sep = float(min_separation_deg)
        order = np.argsort(flat)[::-1] if maximize else np.argsort(flat)
        picked: List[Dict[str, Any]] = []
        for idx in order:
            if not finite[idx]:
                continue
            iy, ix = np.unravel_index(int(idx), work.shape)
            lat = float(lat_w[iy]) if lat_w.ndim == 1 else float(lat_w[iy])
            lon = float(lon_w[ix]) if lon_w.ndim == 1 else float(lon_w[ix])
            val = float(work[iy, ix])
            if any(
                math.hypot(lat - p["latitude"], lon - p["longitude"]) < min_sep for p in picked
            ):
                continue
            picked.append({"latitude": lat, "longitude": lon, "value": round(val, 3)})
            if len(picked) >= limit:
                break

        return picked, meta

    def _array_to_png(self, arr, variable: str, resolution: int) -> bytes:
        import numpy as np
        from PIL import Image

        a = np.asarray(arr, dtype=float)
        if a.ndim != 2:
            a = np.squeeze(a)
        if a.ndim != 2:
            raise RuntimeError("Expected 2D grid for PNG render")

        # Resize-ish by simple block average toward resolution
        h, w = a.shape
        # Normalize to 0-255 using percentiles to avoid outliers
        finite = a[np.isfinite(a)]
        if finite.size == 0:
            raise RuntimeError("Empty grid")
        lo, hi = np.percentile(finite, [5, 95])
        if hi <= lo:
            hi = lo + 1.0
        norm = (a - lo) / (hi - lo)
        norm = np.clip(norm, 0, 1)
        # Simple turbo-ish colormap via HSV
        img = np.zeros((h, w, 4), dtype=np.uint8)
        img[..., 0] = (norm * 255).astype(np.uint8)  # R
        img[..., 1] = ((1 - np.abs(norm - 0.5) * 2) * 200).astype(np.uint8)  # G
        img[..., 2] = ((1 - norm) * 255).astype(np.uint8)  # B
        img[..., 3] = np.where(np.isfinite(a), 180, 0).astype(np.uint8)

        im = Image.fromarray(img, mode="RGBA")
        im = im.resize((resolution, max(1, int(resolution * h / max(w, 1)))), Image.BILINEAR)
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        return buf.getvalue()
