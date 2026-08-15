"""Deterministic WeatherMesh regional ranking (top-N locations).

All numeric ranking happens in Python — never in the LLM.
"""

from __future__ import annotations

import logging
import math
import re
from typing import Any, Dict, List, Optional, Tuple

from services import ai_tools
from services.gridded import FORECAST_HOURS, GriddedForecastService, parse_bbox

logger = logging.getLogger("forecast_rank")

# Named regions — inland-leaning boxes so ocean edges don't dominate ranking.
NAMED_REGIONS: Dict[str, Tuple[float, float, float, float]] = {
    # west, south, east, north
    "us": (-124.2, 25.0, -67.0, 49.0),
    "usa": (-124.2, 25.0, -67.0, 49.0),
    "united states": (-124.2, 25.0, -67.0, 49.0),
    "conus": (-124.2, 25.0, -67.0, 49.0),
    "north america": (-124.0, 26.0, -70.0, 52.0),
    "na": (-124.0, 26.0, -70.0, 52.0),
    "europe": (-9.0, 37.0, 28.0, 59.0),
    "eu": (-9.0, 37.0, 28.0, 59.0),
    "asia": (102.0, 22.0, 142.0, 48.0),
    "east asia": (102.0, 22.0, 142.0, 48.0),
}

METRIC_ALIASES = {
    "snowfall": "snowfall",
    "snow": "snowfall",
    "snowiest": "snowfall",
    "precipitation": "precipitation",
    "precip": "precipitation",
    "rain": "precipitation",
    "rainfall": "precipitation",
    "wind": "wind_speed",
    "wind_speed": "wind_speed",
    "winds": "wind_speed",
    "strongest winds": "wind_speed",
    "temperature_high": "temperature_high",
    "hottest": "temperature_high",
    "hot": "temperature_high",
    "heat": "temperature_high",
    "temperature_low": "temperature_low",
    "coldest": "temperature_low",
    "cold": "temperature_low",
    "temperature": "temperature_high",
}


def resolve_named_region(region: Optional[str]) -> Optional[Dict[str, Any]]:
    if not region:
        return None
    key = re.sub(r"\s+", " ", region.strip().lower())
    if key in ("current_map_view", "map", "viewport", "this view", "current view"):
        return {"kind": "viewport"}
    bbox = NAMED_REGIONS.get(key)
    if bbox:
        return {
            "kind": "named",
            "region": key,
            "bbox": bbox,
            "bbox_str": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}",
            "note": None
            if key not in ("north america", "na", "asia", "east asia")
            else (
                "Using a trial-safe subset of the named region (full continent grids exceed "
                "WeatherMesh fetch size limits)."
            ),
        }
    return None


def parse_rank_intent(text: str) -> Optional[Dict[str, Any]]:
    """Detect top-N ranking questions (snow/wind/precip/temp)."""
    q = (text or "").strip().lower()
    if not q:
        return None
    # Cyclone-fleet ranking (strongest storm) is NOT gridded location ranking
    if ai_tools.look_like_cyclone_list_query(q) or (
        ai_tools.look_like_cyclone_query(q)
        and re.search(r"\b(which|what)\s+(cyclone|hurricane|typhoon|storm)\b", q)
    ):
        return None
    rank_keys = (
        "top ",
        "snowiest",
        "strongest wind",
        "strongest winds",
        "coldest",
        "hottest",
        "highest precipitation",
        "most rain",
        "most snowfall",
        "where are the strongest",
        "where is precipitation",
        "rank ",
    )
    if not any(k in q for k in rank_keys):
        # "Show me the top 5 snowiest" covered; also "precipitation highest"
        if not re.search(r"\b(snow|wind|precip|rain|cold|hot|temperature)\b", q):
            return None
        if not re.search(r"\b(top|highest|strongest|coldest|hottest|most)\b", q):
            return None

    metric = None
    for alias, canon in METRIC_ALIASES.items():
        if alias in q:
            metric = canon
            break
    if not metric:
        return None

    limit = 5
    m = re.search(r"\btop\s+(\d{1,2})\b", q)
    if m:
        limit = max(1, min(int(m.group(1)), 10))
    elif re.search(r"\b(\d{1,2})\s+(snowiest|coldest|hottest|strongest)\b", q):
        m2 = re.search(r"\b(\d{1,2})\s+(snowiest|coldest|hottest|strongest)\b", q)
        if m2:
            limit = max(1, min(int(m2.group(1)), 10))

    hours = 24
    hm = re.search(r"(?:next|over|in)\s+(\d{1,3})\s*h(?:ours?)?", q)
    if hm:
        hours = int(hm.group(1))
    elif "48" in q:
        hours = 48
    elif "72" in q:
        hours = 72
    elif "12" in q and "24" not in q:
        hours = 12

    region = None
    for name in (
        "north america",
        "united states",
        "east asia",
        "current map view",
        "this view",
        "current view",
        "europe",
        "asia",
        "conus",
        "usa",
        "us",
    ):
        if name in q:
            region = name
            break
    if "map view" in q or "this view" in q or "current view" in q or "in this view" in q:
        region = "current_map_view"

    return {
        "metric": metric,
        "region": region,
        "forecast_window_hours": hours,
        "limit": limit,
    }


class ForecastRankService:
    def __init__(self, gridded: GriddedForecastService):
        self.gridded = gridded

    def _pick_forecast_hour(self, window_hours: int) -> int:
        target = int(window_hours)
        return min(FORECAST_HOURS, key=lambda h: abs(h - target))

    def _metric_to_variable(self, metric: str) -> Dict[str, Any]:
        """Map user metric → WeatherMesh variable + sort direction."""
        m = (metric or "").strip().lower()
        if m == "snowfall":
            # Official wm-6 variable per docs; do not fake from precip+temp.
            return {
                "variable": "snowfall_3h",
                "units": "mm",
                "label": "3h snowfall",
                "maximize": True,
                "limitation": (
                    "Using WeatherMesh `snowfall_3h` near the selected forecast hour "
                    "(not a summed multi-hour storm total; multi-step sums would exceed trial fetch budget)."
                ),
            }
        if m == "precipitation":
            return {
                "variable": "precipitation",
                "units": "mm",
                "label": "precipitation",
                "maximize": True,
                "limitation": None,
            }
        if m == "wind_speed":
            return {
                "variable": "wind_speed",
                "units": "m/s",
                "label": "10m wind speed",
                "maximize": True,
                "limitation": None,
            }
        if m == "temperature_high":
            return {
                "variable": "temperature_2m",
                "units": "°C",
                "label": "2m temperature",
                "maximize": True,
                "limitation": None,
            }
        if m == "temperature_low":
            return {
                "variable": "temperature_2m",
                "units": "°C",
                "label": "2m temperature",
                "maximize": False,
                "limitation": None,
            }
        raise ValueError(f"Unsupported metric: {metric}")

    async def rank_locations(
        self,
        *,
        metric: str,
        region: Optional[str] = None,
        forecast_window_hours: int = 24,
        limit: int = 5,
        map_bounds: Optional[Dict[str, float]] = None,
        selected_location: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        try:
            spec = self._metric_to_variable(metric)
        except ValueError as e:
            return {"ok": False, "error": "UNSUPPORTED_METRIC", "message": str(e)}

        hour = self._pick_forecast_hour(forecast_window_hours)
        limit = max(1, min(int(limit), 10))

        bbox_str = None
        region_meta: Dict[str, Any] = {"requested": region}

        resolved = resolve_named_region(region) if region else None
        if resolved and resolved.get("kind") == "viewport":
            if map_bounds and all(k in map_bounds for k in ("west", "south", "east", "north")):
                bbox_str = (
                    f"{map_bounds['west']},{map_bounds['south']},"
                    f"{map_bounds['east']},{map_bounds['north']}"
                )
                region_meta["used"] = "current_map_view"
            else:
                return {
                    "ok": False,
                    "error": "NEED_REGION",
                    "message": (
                        "Which region should I check: US, North America, Europe, or Asia?"
                    ),
                    "ask_region": True,
                }
        elif resolved and resolved.get("kind") == "named":
            bbox_str = resolved["bbox_str"]
            region_meta["used"] = resolved["region"]
            if resolved.get("note"):
                region_meta["note"] = resolved["note"]
        elif map_bounds and all(k in map_bounds for k in ("west", "south", "east", "north")):
            bbox_str = (
                f"{map_bounds['west']},{map_bounds['south']},"
                f"{map_bounds['east']},{map_bounds['north']}"
            )
            region_meta["used"] = "current_map_view"
        elif selected_location and selected_location.get("lat") is not None:
            lat = float(selected_location["lat"])
            lon = float(selected_location["lon"])
            # ~10° box around selected place
            bbox_str = f"{lon - 5},{lat - 4},{lon + 5},{lat + 4}"
            region_meta["used"] = "selected_location"
            region_meta["selected_name"] = selected_location.get("name")
        else:
            return {
                "ok": False,
                "error": "NEED_REGION",
                "message": (
                    "Which region should I check: US, North America, Europe, or Asia?"
                ),
                "ask_region": True,
            }

        try:
            west, south, east, north = parse_bbox(bbox_str)
        except ValueError as e:
            # Shrink oversize viewport toward center
            try:
                parts = [float(x) for x in bbox_str.split(",")]
                west, south, east, north = parts
                cx, cy = (west + east) / 2, (south + north) / 2
                west, east = cx - 30, cx + 30
                south, north = cy - 12, cy + 12
                bbox_str = f"{west},{south},{east},{north}"
                west, south, east, north = parse_bbox(bbox_str)
                region_meta["note"] = "Viewport was too large; used a centered subset."
            except Exception:
                return {"ok": False, "error": "VALIDATION", "message": str(e)}

        try:
            # Over-fetch so we can drop ocean / non-city points after geocoding
            ranked, meta = await self.gridded.rank_extrema(
                variable=spec["variable"],
                bbox=bbox_str,
                forecast_hour=hour,
                limit=max(limit * 12, 24),
                maximize=spec["maximize"],
                min_separation_deg=1.2,
            )
        except Exception as e:
            msg = str(e)
            # Snowfall unavailable → do not fake; offer precip
            if spec["variable"] == "snowfall_3h" and (
                "404" in msg or "No gridded" in msg or "Unsupported" in msg
            ):
                return {
                    "ok": False,
                    "error": "SNOWFALL_UNAVAILABLE",
                    "message": (
                        "WeatherMesh did not return `snowfall_3h` for this request. "
                        "I will not invent snowfall from temperature + precipitation. "
                        "I can rank **precipitation** or **wind speed** instead — which do you prefer?"
                    ),
                    "metric": metric,
                    "suggested_metrics": ["precipitation", "wind_speed"],
                }
            return {
                "ok": False,
                "error": type(e).__name__,
                "message": msg or "Gridded ranking failed.",
            }

        locations: List[Dict[str, Any]] = []
        seen_cities: set[str] = set()
        skipped_non_city = 0
        for row in ranked:
            if len(locations) >= limit:
                break
            lat, lon, value = row["latitude"], row["longitude"], row["value"]
            place = await ai_tools.reverse_geocode_city(lat, lon)
            if not place.get("is_city"):
                skipped_non_city += 1
                continue
            label = place.get("location") or place.get("city")
            key = (label or "").lower()
            if not label or key in seen_cities:
                continue
            seen_cities.add(key)
            locations.append(
                {
                    "rank": len(locations) + 1,
                    "location": label,
                    "city": place.get("city"),
                    "state": place.get("state"),
                    "latitude": lat,
                    "longitude": lon,
                    "value": value,
                    "units": spec["units"],
                    "country": place.get("country"),
                }
            )

        if not locations:
            return {
                "ok": False,
                "error": "NO_CITY_MATCHES",
                "message": (
                    "WeatherMesh extremes in this region were mostly over water or remote land. "
                    "I could not resolve enough named cities. Try a smaller region or current map view."
                ),
                "skipped_non_city": skipped_non_city,
            }

        note_bits = [
            "Showing named cities only (ocean / remote grid points excluded).",
        ]
        if spec.get("limitation"):
            note_bits.insert(0, spec["limitation"])

        return {
            "ok": True,
            "metric": metric,
            "variable": meta.get("variable") or spec["variable"],
            "label": spec["label"],
            "units": spec["units"],
            "maximize": spec["maximize"],
            "forecast_window_hours": forecast_window_hours,
            "forecast_hour_used": hour,
            "valid_time": meta.get("valid_time"),
            "initialization_time": meta.get("initialization_time"),
            "bbox": {"west": west, "south": south, "east": east, "north": north},
            "region": region_meta,
            "limitation": " ".join(note_bits),
            "locations": locations,
            "skipped_non_city": skipped_non_city,
            "provider": "WindBorne WeatherMesh",
            "model": self.gridded.model,
            "from_cache": meta.get("from_cache"),
        }
