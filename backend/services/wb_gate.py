"""Shared WindBorne upstream throttle: at most one network fetch every N seconds.

Free trial is 5 req/min and 2,000 total — default min interval is 5 minutes.

IMPORTANT: ``run()`` never sleeps by default. Chat/API requests return cache or
stale data immediately so the UI/AI does not hang for minutes.
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
        self.stale_ttl = float(os.getenv("WB_STALE_CACHE_TTL_SEC", "1800") or "1800")
        self._lock = asyncio.Lock()
        self._last_fetch_at = 0.0
        self._cache: Dict[str, Tuple[float, Any]] = {}
        self._stale: Dict[str, Tuple[float, Any]] = {}

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

    def cache_set(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        life = float(ttl if ttl is not None else self.min_interval)
        now = time.time()
        self._cache[key] = (now + life, value)
        self._stale[key] = (now + max(life, self.stale_ttl), value)

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
        - If rate window is closed: return stale (if any) immediately.
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
                    stale = self.stale_get(cache_key)
                    if stale is not None:
                        return stale, True
                    raise RateLimitedFetch(
                        wait,
                        f"WindBorne rate window active; retry in {wait:.0f}s "
                        "(no cached cyclone/grid data yet).",
                    )

            result = await fetcher()
            self._last_fetch_at = time.time()
            self.cache_set(cache_key, result, ttl=ttl)
            return result, False


# Singleton shared by cyclone + gridded + optional future WB calls
wb_fetch_gate = WindBorneFetchGate()
