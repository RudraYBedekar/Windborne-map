"""Shared WindBorne upstream throttle: at most one network fetch every N seconds.

Free trial is 5 req/min and 2,000 total — default min interval is 5 minutes.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Callable, Dict, Optional, Tuple


class WindBorneFetchGate:
    """Process-wide gate + TTL cache for WindBorne HTTP responses."""

    def __init__(self, min_interval_seconds: Optional[float] = None):
        self.min_interval = float(
            min_interval_seconds
            if min_interval_seconds is not None
            else os.getenv("WB_MIN_REQUEST_INTERVAL_SEC", "300") or "300"
        )
        self._lock = asyncio.Lock()
        self._last_fetch_at = 0.0
        self._cache: Dict[str, Tuple[float, Any]] = {}

    def cache_get(self, key: str) -> Optional[Any]:
        item = self._cache.get(key)
        if not item:
            return None
        expires, value = item
        if time.time() > expires:
            self._cache.pop(key, None)
            return None
        return value

    def cache_set(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        life = float(ttl if ttl is not None else self.min_interval)
        self._cache[key] = (time.time() + life, value)

    def status(self) -> dict:
        now = time.time()
        wait = max(0.0, self.min_interval - (now - self._last_fetch_at))
        return {
            "min_interval_seconds": self.min_interval,
            "seconds_until_next_allowed_fetch": round(wait, 1),
            "cache_entries": len(self._cache),
            "last_fetch_age_seconds": None
            if self._last_fetch_at <= 0
            else round(now - self._last_fetch_at, 1),
        }

    async def run(
        self,
        cache_key: str,
        fetcher: Callable[[], Any],
        *,
        ttl: Optional[float] = None,
        force: bool = False,
    ) -> Tuple[Any, bool]:
        """
        Returns (value, from_cache).
        Waits until min_interval since last upstream fetch when cache miss.
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

            now = time.time()
            wait = self.min_interval - (now - self._last_fetch_at)
            if self._last_fetch_at > 0 and wait > 0:
                await asyncio.sleep(wait)

            result = await fetcher()
            self._last_fetch_at = time.time()
            self.cache_set(cache_key, result, ttl=ttl)
            return result, False


# Singleton shared by cyclone + gridded + optional future WB calls
wb_fetch_gate = WindBorneFetchGate()
