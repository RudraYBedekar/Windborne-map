"""Simple async sliding-window rate limiter (requests per minute)."""

from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Deque


class SlidingWindowRateLimiter:
    """Allow at most `max_per_minute` acquisitions in any rolling 60s window."""

    def __init__(self, max_per_minute: int = 50, window_seconds: float = 60.0):
        self.max_per_minute = max(1, int(max_per_minute))
        self.window_seconds = float(window_seconds)
        self._times: Deque[float] = deque()
        self._lock = asyncio.Lock()

    def snapshot(self) -> dict:
        now = time.monotonic()
        active = sum(1 for t in self._times if now - t < self.window_seconds)
        return {
            "max_per_minute": self.max_per_minute,
            "used_last_minute": active,
            "remaining": max(0, self.max_per_minute - active),
        }

    async def try_acquire(self) -> bool:
        """Consume one slot if available; otherwise return False immediately."""
        async with self._lock:
            now = time.monotonic()
            while self._times and now - self._times[0] >= self.window_seconds:
                self._times.popleft()
            if len(self._times) < self.max_per_minute:
                self._times.append(now)
                return True
            return False

    async def acquire(self) -> None:
        """Block until a slot is available, then consume one."""
        while True:
            if await self.try_acquire():
                return
            async with self._lock:
                now = time.monotonic()
                wait = (
                    self.window_seconds - (now - self._times[0]) + 0.02
                    if self._times
                    else 0.05
                )
            await asyncio.sleep(max(wait, 0.05))


class KeyedRateLimiter:
    """Per-key sliding windows (e.g. client IP)."""

    def __init__(self, max_per_minute: int = 10, window_seconds: float = 60.0):
        self.max_per_minute = max(1, int(max_per_minute))
        self.window_seconds = float(window_seconds)
        self._limiters: dict[str, SlidingWindowRateLimiter] = {}
        self._lock = asyncio.Lock()

    async def try_acquire(self, key: str) -> bool:
        async with self._lock:
            limiter = self._limiters.get(key)
            if limiter is None:
                limiter = SlidingWindowRateLimiter(
                    max_per_minute=self.max_per_minute,
                    window_seconds=self.window_seconds,
                )
                self._limiters[key] = limiter
                # Bound growth of idle keys
                if len(self._limiters) > 5000:
                    self._limiters = dict(list(self._limiters.items())[-2500:])
        return await limiter.try_acquire()
