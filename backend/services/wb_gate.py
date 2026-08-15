"""Shared WindBorne upstream throttle: at most one network fetch every N seconds.

Free trial is 5 req/min and 2,000 total — default min interval is 5 minutes.

IMPORTANT: ``run()`` never sleeps by default. Chat/API requests return cache or
stale/related data immediately so the UI/AI does not hang for minutes.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Callable, Dict, Optional, Tuple


class RateLimitedFetch(Exception):
    """No fresh fetch allowed yet and no usable cache/stale payload."""

    def __init__(self, retry_after: float, message: str = "WindBorne fetch gated"):
        self.retry_after = float(retry_after)
        super().__init__(message)


class WindBorneFetchGate:
    """Process-wide gate + TTL cache for WindBorne HTTP responses."""

    def __init__(self, min_interval_seconds: Optional[float] = None):
        self.min_interval = float(
            min_interval_seconds
            if min_interval_seconds is not None
            else os.getenv("WB_MIN_REQUEST_INTERVAL_SEC", "300") or "300"
        )
        # Keep last-good payloads longer than the rate window so AI/UI stay fast.
        self.stale_ttl = float(os.getenv("WB_STALE_CACHE_TTL_SEC", "7200") or "7200")
        self._lock = asyncio.Lock()
        self._last_fetch_at = 0.0
        self._cache: Dict[str, Tuple[float, Any]] = {}
        self._stale: Dict[str, Tuple[float, Any]] = {}

    def _family_prefix(self, cache_key: str) -> str:
        """Stable family for related lookups: grid:model:var or tc:model:..."""
        parts = (cache_key or "").split(":")
        if not parts:
            return cache_key
        if parts[0] == "grid" and len(parts) >= 3:
            return ":".join(parts[:3])  # grid:wm-6:temperature_2m
        if parts[0] == "tc" and len(parts) >= 2:
            return ":".join(parts[:2])  # tc:wm-6
        if len(parts) >= 2:
            return ":".join(parts[:2])
        return cache_key

    def cache_get(self, key: str) -> Optional[Any]:
        item = self._cache.get(key)
        if not item:
            return None
        expires, value = item
        if time.time() > expires:
            self._cache.pop(key, None)
            return None
        return value

    def stale_get(self, key: str) -> Optional[Any]:
        item = self._stale.get(key)
        if not item:
            return None
        expires, value = item
        if time.time() > expires:
            self._stale.pop(key, None)
            return None
        return value

    def stale_get_related(self, cache_key: str) -> Optional[Any]:
        """Exact stale hit, else newest still-valid entry in the same family.

        Example: request grid:wm-6:wind_speed_10m:2026-08-16T... while gated
        → reuse any prior wind_speed_10m snapshot instead of failing chat.
        """
        exact = self.stale_get(cache_key)
        if exact is not None:
            return exact

        family = self._family_prefix(cache_key)
        now = time.time()
        best_key = None
        best_expires = -1.0
        for key, (expires, _value) in list(self._stale.items()):
            if now > expires:
                self._stale.pop(key, None)
                continue
            if key == family or key.startswith(family + ":"):
                if expires >= best_expires:
                    best_expires = expires
                    best_key = key
        if best_key is None:
            return None
        return self._stale[best_key][1]

    def cache_set(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        life = float(ttl if ttl is not None else self.min_interval)
        now = time.time()
        expire_fresh = now + life
        expire_stale = now + max(life, self.stale_ttl)
        self._cache[key] = (expire_fresh, value)
        self._stale[key] = (expire_stale, value)
        # Family alias so a later valid_time / bbox miss can still reuse this payload
        family = self._family_prefix(key)
        if family and family != key:
            self._stale[family] = (expire_stale, value)

    def seconds_until_allowed(self) -> float:
        if self._last_fetch_at <= 0:
            return 0.0
        return max(0.0, self.min_interval - (time.time() - self._last_fetch_at))

    def status(self) -> dict:
        now = time.time()
        wait = self.seconds_until_allowed()
        return {
            "min_interval_seconds": self.min_interval,
            "seconds_until_next_allowed_fetch": round(wait, 1),
            "cache_entries": len(self._cache),
            "stale_entries": len(self._stale),
            "last_fetch_age_seconds": None
            if self._last_fetch_at <= 0
            else round(now - self._last_fetch_at, 1),
            "stale_ttl_seconds": self.stale_ttl,
        }

    async def run(
        self,
        cache_key: str,
        fetcher: Callable[[], Any],
        *,
        ttl: Optional[float] = None,
        force: bool = False,
        block: bool = False,
    ) -> Tuple[Any, bool]:
        """
        Returns (value, from_cache).

        - Prefer fresh cache.
        - If rate window is open, fetch upstream.
        - If rate window is closed: return exact stale, else related family stale.
        - Only ``block=True`` waits (background refresh jobs). Never use block in chat.
        """
        if not force:
            cached = self.cache_get(cache_key)
            if cached is not None:
                return cached, True

        async with self._lock:
            if not force:
                cached = self.cache_get(cache_key)
                if cached is not None:
                    return cached, True

            wait = self.seconds_until_allowed()
            if self._last_fetch_at > 0 and wait > 0 and not force:
                if block:
                    await asyncio.sleep(wait)
                else:
                    stale = self.stale_get_related(cache_key)
                    if stale is not None:
                        return stale, True
                    raise RateLimitedFetch(
                        wait,
                        f"WindBorne rate window active; retry in {wait:.0f}s "
                        "(no previous WeatherMesh snapshot in memory yet).",
                    )

            result = await fetcher()
            self._last_fetch_at = time.time()
            self.cache_set(cache_key, result, ttl=ttl)
            return result, False


# Singleton shared by cyclone + gridded + optional future WB calls
wb_fetch_gate = WindBorneFetchGate()
