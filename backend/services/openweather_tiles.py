"""OpenWeatherMap tile proxy with RPM limiting and short-lived cache."""

from __future__ import annotations

import os
import time
from typing import Dict, Optional, Tuple

import httpx

from services.rate_limit import SlidingWindowRateLimiter

LAYER_PATHS = {
    "clouds": "clouds_new",
    "temp": "temp_new",
    "wind": "wind_new",
}

# Cap tile depth so MapLibre requests fewer tiles under a tight RPM budget
OPENWEATHER_TILE_MAX_ZOOM = 6


class OpenWeatherTileProxy:
    def __init__(self) -> None:
        self.api_key = (
            os.getenv("OPENWEATHER_KEY")
            or os.getenv("NEXT_PUBLIC_OPENWEATHER_KEY")
            or ""
        ).strip()
        rpm = int(os.getenv("OPENWEATHER_RPM_LIMIT", "50") or "50")
        # Stay under a typical 60 RPM plan ceiling
        self.rpm_limit = max(1, min(rpm, 60))
        self.limiter = SlidingWindowRateLimiter(max_per_minute=self.rpm_limit)
        self._cache: Dict[str, Tuple[float, bytes, str]] = {}
        self._cache_ttl = float(os.getenv("OPENWEATHER_TILE_CACHE_TTL", "600") or "600")
        self._cache_max = int(os.getenv("OPENWEATHER_TILE_CACHE_MAX", "256") or "256")

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def status(self) -> dict:
        return {
            "enabled": self.enabled,
            "rpm_limit": self.rpm_limit,
            "rate": self.limiter.snapshot(),
            "max_zoom": OPENWEATHER_TILE_MAX_ZOOM,
            "cache_entries": len(self._cache),
        }

    def _cache_get(self, key: str) -> Optional[Tuple[bytes, str]]:
        item = self._cache.get(key)
        if not item:
            return None
        expires, body, content_type = item
        if time.time() > expires:
            self._cache.pop(key, None)
            return None
        return body, content_type

    def _cache_set(self, key: str, body: bytes, content_type: str) -> None:
        if len(self._cache) >= self._cache_max:
            # Drop oldest by expiry
            oldest = min(self._cache.items(), key=lambda kv: kv[1][0])[0]
            self._cache.pop(oldest, None)
        self._cache[key] = (time.time() + self._cache_ttl, body, content_type)

    async def fetch_tile(self, layer: str, z: int, x: int, y: int) -> Tuple[bytes, str]:
        if not self.enabled:
            raise PermissionError("OpenWeatherMap key not configured")
        if layer not in LAYER_PATHS:
            raise ValueError(f"Unsupported layer: {layer}")
        if z < 0 or z > OPENWEATHER_TILE_MAX_ZOOM:
            raise ValueError(f"Zoom must be 0–{OPENWEATHER_TILE_MAX_ZOOM}")

        cache_key = f"{layer}/{z}/{x}/{y}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached

        await self.limiter.acquire()

        # Re-check cache after waiting for a rate slot (another request may have filled it)
        cached = self._cache_get(cache_key)
        if cached:
            return cached

        layer_path = LAYER_PATHS[layer]
        url = (
            f"https://tile.openweathermap.org/map/{layer_path}/{z}/{x}/{y}.png"
            f"?appid={self.api_key}"
        )
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url)
            if resp.status_code == 429:
                raise RuntimeError("OpenWeatherMap upstream rate limit (429)")
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "image/png")
            body = resp.content

        self._cache_set(cache_key, body, content_type)
        return body, content_type
