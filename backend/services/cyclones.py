"""WeatherMesh-6 Tropical Cyclone client (official API fields only)."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

from services.wb_gate import RateLimitedFetch, wb_fetch_gate

logger = logging.getLogger("cyclones_service")

FORECAST_HOURS = (0, 12, 24, 48, 72, 120)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class TropicalCycloneService:
    def __init__(self, http_client: Optional[httpx.AsyncClient] = None):
        self.enabled = os.getenv("CYCLONES_ENABLED", "true").lower() in ("true", "1", "yes")
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
        self.last_error: Optional[str] = None
        self.last_http_status: Optional[int] = None

    def set_http_client(self, client: Optional[httpx.AsyncClient]) -> None:
        self._http = client

    def capability(self) -> dict:
        return {
            "enabled": self.enabled,
            "model": self.model,
            "has_wb_key": bool(self.api_key),
            "endpoint": f"/forecasts/v1/{self.model}/tropical_cyclones",
            "min_request_interval_seconds": wb_fetch_gate.min_interval,
            "forecast_hours": list(FORECAST_HOURS),
            "last_error": self.last_error,
            "last_http_status": self.last_http_status,
            "gate": wb_fetch_gate.status(),
        }

    def _headers(self) -> Dict[str, str]:
        h = {"Accept": "application/json", "User-Agent": "Windborne-CycloneMode/1.0"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    async def _get(self, url: str, params: Optional[dict] = None) -> httpx.Response:
        if self._http is not None:
            return await self._http.get(url, params=params, headers=self._headers())
        async with httpx.AsyncClient(timeout=45.0, follow_redirects=True) as client:
            return await client.get(url, params=params, headers=self._headers())

    async def fetch_cyclones(
        self,
        *,
        include_details: bool = True,
        include_unofficial_ids: bool = False,
        basin: Optional[str] = None,
        force: bool = False,
    ) -> Dict[str, Any]:
        if not self.enabled:
            return {
                "ok": False,
                "error": "CYCLONES_DISABLED",
                "message": "Cyclone mode is disabled (CYCLONES_ENABLED=false).",
                "tropical_cyclones": {},
                "total": 0,
            }
        if not self.api_key:
            return {
                "ok": False,
                "error": "MISSING_API_KEY",
                "message": "WB_API_KEY is required for WeatherMesh tropical cyclones.",
                "tropical_cyclones": {},
                "total": 0,
            }

        params: Dict[str, Any] = {
            "include_details": "true" if include_details else "false",
            "include_unofficial_ids": "true" if include_unofficial_ids else "false",
        }
        if basin:
            params["basin"] = basin

        cache_key = f"tc:{self.model}:{include_details}:{include_unofficial_ids}:{basin or 'ALL'}"
        # Keep cyclone payloads warm longer than the rate window so chat stays instant.
        cache_ttl = max(wb_fetch_gate.min_interval, float(os.getenv("CYCLONE_CACHE_TTL_SEC", "900") or "900"))

        async def fetcher():
            url = f"{self.base_url}/forecasts/v1/{self.model}/tropical_cyclones"
            resp = await self._get(url, params=params)
            self.last_http_status = resp.status_code
            if resp.status_code == 429:
                self.last_error = "RATE_LIMITED"
                raise RuntimeError("WindBorne rate limited (429). Cached data may be stale; retry after 5 minutes.")
            if resp.status_code in (401, 403):
                self.last_error = "UNAUTHORIZED"
                raise PermissionError("WindBorne API key cannot access tropical cyclones.")
            if resp.status_code >= 400:
                self.last_error = f"HTTP_{resp.status_code}"
                raise RuntimeError(f"Tropical cyclone request failed ({resp.status_code}).")
            data = resp.json()
            self.last_error = None
            return data

        try:
            raw, from_cache = await wb_fetch_gate.run(cache_key, fetcher, force=force, ttl=cache_ttl)
        except RateLimitedFetch as e:
            stale = wb_fetch_gate.stale_get(cache_key)
            if stale is not None:
                return self._normalize_payload(
                    stale,
                    from_cache=True,
                    warning=f"Serving cached cyclones; next upstream refresh in {e.retry_after:.0f}s.",
                )
            return {
                "ok": False,
                "error": "RATE_GATED",
                "message": str(e),
                "retry_after_seconds": e.retry_after,
                "tropical_cyclones": {},
                "total": 0,
                "retrievedAt": _utc_now(),
            }
        except Exception as e:
            cached = wb_fetch_gate.cache_get(cache_key) or wb_fetch_gate.stale_get(cache_key)
            if cached is not None:
                return self._normalize_payload(cached, from_cache=True, warning=str(e))
            return {
                "ok": False,
                "error": type(e).__name__,
                "message": str(e),
                "tropical_cyclones": {},
                "total": 0,
                "retrievedAt": _utc_now(),
            }

        return self._normalize_payload(raw, from_cache=from_cache)

    def _normalize_payload(
        self, raw: Dict[str, Any], *, from_cache: bool, warning: Optional[str] = None
    ) -> Dict[str, Any]:
        storms_in = raw.get("tropical_cyclones") or {}
        storms: Dict[str, Any] = {}
        if isinstance(storms_in, dict):
            for cid, storm in storms_in.items():
                if isinstance(storm, dict):
                    storms[str(cid)] = self._normalize_storm(storm)

        out: Dict[str, Any] = {
            "ok": True,
            "provider": "WindBorne WeatherMesh",
            "model": self.model,
            "initialization_time": raw.get("initialization_time"),
            "forecast_zero": raw.get("forecast_zero"),
            "tropical_cyclones": storms,
            "total": raw.get("total") if raw.get("total") is not None else len(storms),
            "from_cache": from_cache,
            "retrievedAt": _utc_now(),
            "min_request_interval_seconds": wb_fetch_gate.min_interval,
        }
        if warning:
            out["warning"] = warning
        return out

    def _normalize_storm(self, storm: Dict[str, Any]) -> Dict[str, Any]:
        path = storm.get("path") if isinstance(storm.get("path"), list) else []
        path_norm = []
        for pt in path:
            if not isinstance(pt, dict):
                continue
            path_norm.append(
                {
                    "valid_at": pt.get("valid_at"),
                    "forecast_hour": pt.get("forecast_hour"),
                    "latitude": pt.get("latitude"),
                    "longitude": pt.get("longitude"),
                    "max_wind_kt": pt.get("max_wind_kt"),
                    "min_mslp_hpa": pt.get("min_mslp_hpa"),
                    "storm_type": pt.get("storm_type"),
                    "contributing_members_count": pt.get("contributing_members_count"),
                }
            )

        landfalls = []
        for lf in storm.get("landfalls") or []:
            if isinstance(lf, dict):
                landfalls.append(
                    {
                        "valid_at": lf.get("valid_at"),
                        "latitude": lf.get("latitude"),
                        "longitude": lf.get("longitude"),
                        "max_wind_kt": lf.get("max_wind_kt"),
                        "min_mslp_hpa": lf.get("min_mslp_hpa"),
                        "storm_type": lf.get("storm_type"),
                        "ensemble_member": lf.get("ensemble_member"),
                    }
                )

        cone = storm.get("cone")
        cone_out = None
        if isinstance(cone, dict):
            geom = cone.get("geometry")
            cone_out = {
                "members_total": cone.get("members_total"),
                "max_forecast_hour": cone.get("max_forecast_hour"),
                "geometry": geom if isinstance(geom, dict) else None,
            }

        genesis = storm.get("genesis")
        genesis_out = None
        if isinstance(genesis, dict):
            genesis_out = {
                "latitude": genesis.get("latitude"),
                "longitude": genesis.get("longitude"),
            }

        return {
            "tropical_cyclone_id": storm.get("tropical_cyclone_id"),
            "storm_name": storm.get("storm_name"),
            "basins": storm.get("basins") if isinstance(storm.get("basins"), list) else [],
            "genesis": genesis_out,
            "start_time": storm.get("start_time"),
            "end_time": storm.get("end_time"),
            "max_wind_kt": storm.get("max_wind_kt"),
            "min_mslp_hpa": storm.get("min_mslp_hpa"),
            "path": path_norm,
            "landfalls": landfalls,
            "cone": cone_out,
        }

    def get_storm(self, payload: Dict[str, Any], cyclone_id: str) -> Optional[Dict[str, Any]]:
        storms = payload.get("tropical_cyclones") or {}
        if not isinstance(storms, dict):
            return None
        cid = (cyclone_id or "").strip().upper()
        for key, storm in storms.items():
            if str(key).upper() == cid or str(storm.get("tropical_cyclone_id", "")).upper() == cid:
                return storm
        return None

    def point_at_hour(self, storm: Dict[str, Any], forecast_hour: int) -> Optional[Dict[str, Any]]:
        path = storm.get("path") or []
        if path:
            exact = [p for p in path if p.get("forecast_hour") == forecast_hour]
            if exact:
                return exact[0]
            ranked = sorted(
                (p for p in path if isinstance(p.get("forecast_hour"), int)),
                key=lambda p: abs(int(p["forecast_hour"]) - forecast_hour),
            )
            if ranked:
                return ranked[0]

        # Early / sparse storms: WeatherMesh may only publish genesis (no mean track yet)
        gen = storm.get("genesis") or {}
        if isinstance(gen.get("longitude"), (int, float)) and isinstance(gen.get("latitude"), (int, float)):
            return {
                "valid_at": storm.get("start_time"),
                "forecast_hour": None,
                "latitude": gen.get("latitude"),
                "longitude": gen.get("longitude"),
                "max_wind_kt": storm.get("max_wind_kt"),
                "min_mslp_hpa": storm.get("min_mslp_hpa"),
                "storm_type": None,
                "position_source": "genesis",
                "track_status": "Track not yet published by WeatherMesh for this storm.",
            }
        return None

    def to_geojson(
        self,
        payload: Dict[str, Any],
        *,
        forecast_hour: int = 0,
        include_ensemble: bool = False,
        selected_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """MapLibre-ready FeatureCollection from normalized cyclone payload."""
        features: List[Dict[str, Any]] = []
        storms = payload.get("tropical_cyclones") or {}
        for cid, storm in storms.items():
            if not isinstance(storm, dict):
                continue
            name = storm.get("storm_name") or cid
            path = storm.get("path") or []

            # Mean track line
            line_coords = []
            for p in path:
                lon, lat = p.get("longitude"), p.get("latitude")
                if isinstance(lon, (int, float)) and isinstance(lat, (int, float)):
                    line_coords.append([lon, lat])
            if len(line_coords) >= 2:
                features.append(
                    {
                        "type": "Feature",
                        "properties": {
                            "feature_type": "mean_path",
                            "tropical_cyclone_id": cid,
                            "storm_name": name,
                            "selected": cid == selected_id,
                        },
                        "geometry": {"type": "LineString", "coordinates": line_coords},
                    }
                )

            # Uncertainty cone
            cone = storm.get("cone") or {}
            geom = cone.get("geometry") if isinstance(cone, dict) else None
            if isinstance(geom, dict) and geom.get("type") in ("Polygon", "MultiPolygon"):
                features.append(
                    {
                        "type": "Feature",
                        "properties": {
                            "feature_type": "uncertainty_cone",
                            "tropical_cyclone_id": cid,
                            "storm_name": name,
                            "members_total": cone.get("members_total"),
                            "max_forecast_hour": cone.get("max_forecast_hour"),
                            "selected": cid == selected_id,
                        },
                        "geometry": geom,
                    }
                )

            # Position at forecast hour (or genesis)
            pt = self.point_at_hour(storm, forecast_hour)
            if pt and isinstance(pt.get("longitude"), (int, float)) and isinstance(pt.get("latitude"), (int, float)):
                features.append(
                    {
                        "type": "Feature",
                        "properties": {
                            "feature_type": "position",
                            "tropical_cyclone_id": cid,
                            "storm_name": name,
                            "forecast_hour": pt.get("forecast_hour"),
                            "max_wind_kt": pt.get("max_wind_kt"),
                            "min_mslp_hpa": pt.get("min_mslp_hpa"),
                            "storm_type": pt.get("storm_type"),
                            "selected": cid == selected_id,
                            "position_source": pt.get("position_source") or "path",
                        },
                        "geometry": {
                            "type": "Point",
                            "coordinates": [pt["longitude"], pt["latitude"]],
                        },
                    }
                )
            else:
                # No usable position at all
                pass

            # Optional: landfall points (not full ensemble paths — those need unofficial IDs)
            if include_ensemble:
                for lf in storm.get("landfalls") or []:
                    if not isinstance(lf, dict):
                        continue
                    lon, lat = lf.get("longitude"), lf.get("latitude")
                    if isinstance(lon, (int, float)) and isinstance(lat, (int, float)):
                        features.append(
                            {
                                "type": "Feature",
                                "properties": {
                                    "feature_type": "landfall",
                                    "tropical_cyclone_id": cid,
                                    "storm_name": name,
                                    "ensemble_member": lf.get("ensemble_member"),
                                    "max_wind_kt": lf.get("max_wind_kt"),
                                },
                                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                            }
                        )

        return {
            "type": "FeatureCollection",
            "features": features,
            "properties": {
                "initialization_time": payload.get("initialization_time"),
                "forecast_zero": payload.get("forecast_zero"),
                "forecast_hour": forecast_hour,
                "provider": payload.get("provider"),
                "model": payload.get("model"),
            },
        }
