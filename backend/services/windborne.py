import os
import time
import math
import logging
from typing import Dict, Any, Optional, List
import httpx
from datetime import datetime, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
    base_dir = Path(__file__).resolve().parent.parent
    load_dotenv(base_dir / ".env")
    load_dotenv(base_dir.parent / ".env")
except ImportError:
    pass

logger = logging.getLogger("windborne_service")
logging.basicConfig(level=logging.INFO)


class WindBorneClient:
    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        if not api_key:
            base_dir = Path(__file__).resolve().parent.parent
            for p in [
                base_dir / ".env",
                base_dir / ".env.local",
                base_dir.parent / ".env",
                base_dir.parent / ".env.local",
            ]:
                if p.exists():
                    with open(p, "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if line and not line.startswith("#") and "=" in line:
                                k, v = line.split("=", 1)
                                k, v = k.strip(), v.strip().strip("'\"")
                                if k and not os.getenv(k):
                                    os.environ[k] = v
        self.api_key = (
            api_key
            or os.getenv("WB_API_KEY")
            or os.getenv("WINDBORNE_TOKEN")
            or os.getenv("WINDBORNE_API_KEY")
            or ""
        )
        self.base_url = (
            base_url or os.getenv("WINDBORNE_BASE_URL") or "https://api.windbornesystems.com"
        ).rstrip("/")
        # In-memory TTL cache: {cache_key: (data, expire_timestamp)}
        # Only successful WindBorne responses are cached (never Open-Meteo fallback).
        self._cache: Dict[str, tuple] = {}
        self._cache_ttl = 300  # 5 minutes

    def _get_headers(self) -> Dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": "Windborne-Visualization-App/1.0",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def check_auth(self) -> Dict[str, Any]:
        """Check API key status against WindBorne authentication endpoint."""
        url = f"{self.base_url}/debug/v1/auth_status"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers=self._get_headers())
                if resp.status_code == 200:
                    data = resp.json()
                    is_authed = isinstance(data, dict) and (
                        data.get("authed") is True or data.get("authenticated") is True
                    )
                    return {
                        "authenticated": is_authed,
                        "provider": "WindBorne WeatherMesh",
                        "details": data if isinstance(data, dict) else {},
                    }
                if resp.status_code in (401, 403):
                    return {
                        "authenticated": False,
                        "provider": "WindBorne WeatherMesh",
                        "error": "UNAUTHORIZED",
                        "message": "Invalid or expired WindBorne API key.",
                    }
                return {
                    "authenticated": False,
                    "provider": "WindBorne WeatherMesh",
                    "error": f"HTTP_{resp.status_code}",
                    "message": f"Auth check returned status {resp.status_code}",
                }
        except httpx.TimeoutException:
            logger.error("Authentication check timed out")
            return {
                "authenticated": False,
                "provider": "WindBorne WeatherMesh",
                "error": "TIMEOUT",
                "message": "Authentication check timed out.",
            }
        except Exception as e:
            logger.error(f"Authentication check failed: {type(e).__name__}")
            return {
                "authenticated": False,
                "provider": "WindBorne WeatherMesh",
                "error": "CONNECTION_ERROR",
                "message": "Could not connect to WindBorne API authentication endpoint.",
            }

    def _clean_cache(self):
        now = time.time()
        expired = [k for k, (_v, exp) in self._cache.items() if exp < now]
        for k in expired:
            del self._cache[k]

    async def get_forecast(self, lat: float, lon: float) -> Dict[str, Any]:
        """
        Official WindBorne WeatherMesh point forecast:
        GET {base}/forecasts/v1/mm/point_forecast?coordinates=<lat>,<lon>
        Bearer auth via WB_API_KEY. Open-Meteo only on real failure.
        """
        rounded_lat = round(lat, 2)
        rounded_lon = round(lon, 2)
        # Provider-aware cache key so Open-Meteo can never be served as WindBorne.
        cache_key = f"weather:windborne:{rounded_lat}:{rounded_lon}"

        self._clean_cache()
        now = time.time()
        if cache_key in self._cache:
            cached_data, expire_time = self._cache[cache_key]
            if expire_time > now and isinstance(cached_data, dict):
                provider = cached_data.get("provider", "")
                if provider.startswith("WindBorne"):
                    logger.info(
                        f"[WindBorne] coordinates={rounded_lat},{rounded_lon} cache=hit provider={provider}"
                    )
                    return cached_data
                # Stale/wrong provider in cache — drop it
                del self._cache[cache_key]

        endpoint = f"{self.base_url}/forecasts/v1/mm/point_forecast"
        params = {"coordinates": f"{lat},{lon}"}
        headers = self._get_headers()

        logger.info(f"[WindBorne] coordinates={lat},{lon}")
        logger.info(f"[WindBorne] endpoint={endpoint}")

        if not self.api_key:
            logger.warning("[WindBorne] error=missing WB_API_KEY")
            logger.info("[WindBorne] activating Open-Meteo fallback")
            return await self._fetch_open_meteo_fallback(lat, lon)

        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                resp = await client.get(endpoint, params=params, headers=headers)
                logger.info(f"[WindBorne] status={resp.status_code}")

                if resp.status_code == 200:
                    try:
                        response_json = resp.json()
                    except Exception as parse_err:
                        logger.warning(f"[WindBorne] error=invalid JSON: {parse_err}")
                        logger.info("[WindBorne] activating Open-Meteo fallback")
                        return await self._fetch_open_meteo_fallback(lat, lon)

                    try:
                        normalized = self._normalize_response(response_json, lat, lon)
                    except Exception as norm_err:
                        logger.warning(
                            f"[WindBorne] error=normalize failed: {type(norm_err).__name__}: {norm_err}"
                        )
                        logger.info("[WindBorne] activating Open-Meteo fallback")
                        return await self._fetch_open_meteo_fallback(lat, lon)

                    if isinstance(normalized, dict) and "error" in normalized:
                        logger.warning(
                            f"[WindBorne] error={normalized.get('error')} {normalized.get('message')}"
                        )
                        logger.info("[WindBorne] activating Open-Meteo fallback")
                        return await self._fetch_open_meteo_fallback(lat, lon)

                    model = normalized.get("model", "WeatherMesh")
                    logger.info(f"[WindBorne] provider=WeatherMesh model={model}")
                    # Cache only confirmed WindBorne successes
                    self._cache[cache_key] = (normalized, now + self._cache_ttl)
                    return normalized

                # Explicit failure statuses → fallback
                body_preview = (resp.text or "")[:200].replace("\n", " ")
                logger.warning(f"[WindBorne] status={resp.status_code}")
                logger.warning(f"[WindBorne] error={body_preview}")
                logger.info("[WindBorne] activating Open-Meteo fallback")
                return await self._fetch_open_meteo_fallback(lat, lon)

        except httpx.TimeoutException:
            logger.warning("[WindBorne] status=timeout")
            logger.warning("[WindBorne] error=request timed out")
            logger.info("[WindBorne] activating Open-Meteo fallback")
            return await self._fetch_open_meteo_fallback(lat, lon)
        except httpx.RequestError as e:
            logger.warning("[WindBorne] status=network_error")
            logger.warning(f"[WindBorne] error={type(e).__name__}: {e}")
            logger.info("[WindBorne] activating Open-Meteo fallback")
            return await self._fetch_open_meteo_fallback(lat, lon)
        except Exception as e:
            logger.warning(f"[WindBorne] status=exception")
            logger.warning(f"[WindBorne] error={type(e).__name__}: {e}")
            logger.info("[WindBorne] activating Open-Meteo fallback")
            return await self._fetch_open_meteo_fallback(lat, lon)

    def _extract_hourly_records(self, data: Any) -> List[Dict[str, Any]]:
        """
        Official response shape (verified live):
        {
          "forecast_zero": "...",
          "initialization_time": "...",
          "forecasts": [ [ {hourly record}, ... ] ]   # nested: one series per coordinate
        }
        Each hourly record includes:
          latitude, longitude, time, temperature_2m, dewpoint_2m, pressure_msl,
          precipitation, wind_speed_10m, wind_speed_100m,
          wind_u_10m, wind_v_10m, wind_u_100m, wind_v_100m, station_id
        """
        if isinstance(data, list):
            if data and isinstance(data[0], dict):
                return data
            if data and isinstance(data[0], list):
                return [r for r in data[0] if isinstance(r, dict)]
            return []

        if not isinstance(data, dict):
            return []

        forecasts = data.get("forecasts")
        if isinstance(forecasts, list) and forecasts:
            # Nested series: forecasts[0] is the hourly list for the requested point
            if isinstance(forecasts[0], list):
                return [r for r in forecasts[0] if isinstance(r, dict)]
            if isinstance(forecasts[0], dict):
                return [r for r in forecasts if isinstance(r, dict)]

        for key in ("forecast", "points", "records", "data", "hourly"):
            val = data.get(key)
            if isinstance(val, list) and val and isinstance(val[0], dict):
                return [r for r in val if isinstance(r, dict)]

        # Single record dict with expected fields
        if "temperature_2m" in data or "time" in data:
            return [data]

        return []

    def _normalize_response(
        self, data: Any, requested_lat: float, requested_lon: float
    ) -> Dict[str, Any]:
        """
        Normalize official WindBorne point_forecast JSON into the UI weather contract.
        Selects the hourly record closest to current UTC time.
        """
        records = self._extract_hourly_records(data)
        if not records:
            logger.warning("[WindBorne] No forecast records found in JSON response")
            return {
                "error": "EMPTY_FORECAST",
                "message": "WindBorne API returned an empty forecast dataset.",
            }

        current_time_ms = time.time() * 1000
        best_record = records[0]
        best_diff = float("inf")

        for rec in records:
            if not isinstance(rec, dict):
                continue
            rec_time_ms = self._parse_timestamp_ms(rec.get("time"))
            if rec_time_ms is None:
                continue
            diff = abs(rec_time_ms - current_time_ms)
            if diff < best_diff:
                best_diff = diff
                best_record = rec

        # Exact WindBorne field names (verified from live response)
        temp_2m = self._extract_num(best_record, ["temperature_2m"])
        dewpoint_2m = self._extract_num(best_record, ["dewpoint_2m"])
        pressure_msl = self._extract_num(best_record, ["pressure_msl"])
        precip = self._extract_num(best_record, ["precipitation"])
        wind_spd = self._extract_num(best_record, ["wind_speed_10m"])

        # No direct wind_direction in this endpoint — derive from u/v when present
        wind_dir = self._extract_num(best_record, ["wind_direction_10m"])
        u_10m = self._extract_num(best_record, ["wind_u_10m"])
        v_10m = self._extract_num(best_record, ["wind_v_10m"])

        if wind_dir is None and u_10m is not None and v_10m is not None:
            # Meteorological wind direction: direction FROM which wind blows
            wind_dir = round((math.atan2(-u_10m, -v_10m) * 180.0 / math.pi) % 360.0, 1)

        # Humidity is not in the payload; derive from T/Td when both exist, else null
        humidity = self._extract_num(
            best_record, ["relative_humidity_2m", "humidity", "relative_humidity"]
        )
        if humidity is None and temp_2m is not None and dewpoint_2m is not None:
            try:
                t, td = float(temp_2m), float(dewpoint_2m)
                # August-Roche-Magnus approximation
                rh = 100.0 * (
                    math.exp((17.625 * td) / (243.04 + td))
                    / math.exp((17.625 * t) / (243.04 + t))
                )
                humidity = round(min(max(rh, 0.0), 100.0), 1)
            except Exception:
                humidity = None

        forecast_time_str = best_record.get("time")
        if not isinstance(forecast_time_str, str) or not forecast_time_str:
            forecast_time_str = None

        res_lat = self._extract_num(best_record, ["latitude"])
        res_lon = self._extract_num(best_record, ["longitude"])
        if res_lat is None:
            res_lat = requested_lat
        if res_lon is None:
            res_lon = requested_lon

        # Model identifier is not in the point_forecast payload; use WeatherMesh.
        model = "WeatherMesh"
        if isinstance(data, dict):
            for key in ("model", "model_id", "model_name"):
                if isinstance(data.get(key), str) and data[key].strip():
                    model = data[key].strip()
                    break

        return {
            "provider": "WindBorne WeatherMesh",
            "model": model,
            "coordinates": {
                "latitude": round(float(res_lat), 4),
                "longitude": round(float(res_lon), 4),
            },
            "current": {
                "temperature": round(temp_2m, 1) if temp_2m is not None else None,
                "dewpoint": round(dewpoint_2m, 1) if dewpoint_2m is not None else None,
                "humidity": humidity,
                "windSpeed": round(wind_spd, 1) if wind_spd is not None else None,
                "windDirection": round(wind_dir, 1) if wind_dir is not None else None,
                "pressure": round(pressure_msl, 1) if pressure_msl is not None else None,
                "precipitation": round(precip, 2) if precip is not None else None,
            },
            "forecastTime": forecast_time_str,
            "initializationTime": (
                data.get("initialization_time") if isinstance(data, dict) else None
            ),
            "forecastZero": data.get("forecast_zero") if isinstance(data, dict) else None,
        }

    def _extract_num(self, data: Dict[str, Any], keys: List[str]) -> Optional[float]:
        for k in keys:
            if k in data and data[k] is not None:
                try:
                    return float(data[k])
                except (ValueError, TypeError):
                    pass
        return None

    def _parse_timestamp_ms(self, val: Any) -> Optional[float]:
        if val is None:
            return None
        if isinstance(val, (int, float)):
            return val * 1000 if val < 1e11 else float(val)
        if isinstance(val, str):
            try:
                dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
                return dt.timestamp() * 1000
            except ValueError:
                pass
        return None

    async def _fetch_open_meteo_fallback(self, lat: float, lon: float) -> Dict[str, Any]:
        """Open-Meteo only as genuine fallback — never cached as WindBorne."""
        url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={lat}&longitude={lon}&"
            f"current=temperature_2m,relative_humidity_2m,apparent_temperature,"
            f"precipitation,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover"
        )
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    curr = data.get("current", {})
                    return {
                        "provider": "Open-Meteo (Fallback)",
                        "model": "open-meteo-v1",
                        "coordinates": {"latitude": lat, "longitude": lon},
                        "current": {
                            "temperature": curr.get("temperature_2m"),
                            "apparentTemperature": curr.get("apparent_temperature"),
                            "humidity": curr.get("relative_humidity_2m"),
                            "windSpeed": curr.get("wind_speed_10m"),
                            "windDirection": curr.get("wind_direction_10m"),
                            "cloudCover": curr.get("cloud_cover"),
                            "pressure": curr.get("surface_pressure"),
                            "precipitation": curr.get("precipitation"),
                        },
                        "forecastTime": curr.get("time") or None,
                    }
        except Exception as err:
            logger.error(f"[Open-Meteo Fallback] Request failed: {type(err).__name__}")

        return {
            "error": "WEATHER_PROVIDER_UNAVAILABLE",
            "message": "Weather data is currently unavailable.",
            "status_code": 503,
        }
