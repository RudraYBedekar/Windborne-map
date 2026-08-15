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

    async def acquire(self) -> None:
        """Block until a slot is available, then consume one."""
        while True:
            async with self._lock:
                now = time.monotonic()
                while self._times and now - self._times[0] >= self.window_seconds:
                    self._times.popleft()
                if len(self._times) < self.max_per_minute:
                    self._times.append(now)
                    return
                wait = self.window_seconds - (now - self._times[0]) + 0.02
            await asyncio.sleep(max(wait, 0.05))
