"""Shared WindBorne upstream throttle: at most one network fetch every N seconds.

Free trial is 5 req/min and 2,000 total — default min interval is 5 minutes.

IMPORTANT: ``run()`` never sleeps by default. Chat/API requests return memory or
disk snapshots immediately so the UI/AI does not hang for minutes.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import pickle
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger("wb_gate")


class RateLimitedFetch(Exception):
    """No fresh fetch allowed yet and no usable cache/stale payload."""

    def __init__(self, retry_after: float, message: str = "WindBorne fetch gated"):
        self.retry_after = float(retry_after)
        super().__init__(message)


def _default_disk_dir() -> Path:
    env = os.getenv("WB_DISK_CACHE_DIR", "").strip()
    if env:
        return Path(env)
    # backend/.cache/weathermesh (stable across PM2 restarts)
    return Path(__file__).resolve().parent.parent / ".cache" / "weathermesh"


class WindBorneFetchGate:
    """Process-wide gate + memory TTL cache + on-disk WeatherMesh snapshots."""

    def __init__(
        self,
        min_interval_seconds: Optional[float] = None,
        disk_dir: Optional[Path] = None,
    ):
        self.min_interval = float(
            min_interval_seconds
            if min_interval_seconds is not None
            else os.getenv("WB_MIN_REQUEST_INTERVAL_SEC", "300") or "300"
        )
        # Keep last-good payloads longer than the rate window so AI/UI stay fast.
        self.stale_ttl = float(os.getenv("WB_STALE_CACHE_TTL_SEC", "86400") or "86400")
        self.disk_enabled = os.getenv("WB_DISK_CACHE", "true").lower() in (
            "true",
            "1",
            "yes",
        )
        self.disk_dir = Path(disk_dir) if disk_dir else _default_disk_dir()
        self._lock = asyncio.Lock()
        self._last_fetch_at = 0.0
        self._cache: Dict[str, Tuple[float, Any]] = {}
        self._stale: Dict[str, Tuple[float, Any]] = {}
        if self.disk_enabled:
            try:
                self.disk_dir.mkdir(parents=True, exist_ok=True)
                self._load_meta()
                self._hydrate_index()
            except Exception as e:
                logger.warning("[wb_gate] disk cache init failed: %s", e)

    def _meta_path(self) -> Path:
        return self.disk_dir / "_meta.pkl"

    def _index_path(self) -> Path:
        return self.disk_dir / "_index.pkl"

    def _key_path(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.disk_dir / f"{digest}.pkl"

    def _load_meta(self) -> None:
        path = self._meta_path()
        if not path.exists():
            return
        try:
            with path.open("rb") as f:
                meta = pickle.load(f)
            self._last_fetch_at = float(meta.get("last_fetch_at") or 0.0)
        except Exception:
            pass

    def _save_meta(self) -> None:
        if not self.disk_enabled:
            return
        try:
            with self._meta_path().open("wb") as f:
                pickle.dump({"last_fetch_at": self._last_fetch_at}, f)
        except Exception as e:
            logger.warning("[wb_gate] meta save failed: %s", e)

    def _hydrate_index(self) -> None:
        """Load disk index of keys → expires into memory map (values lazy-loaded)."""
        path = self._index_path()
        if not path.exists():
            return
        try:
            with path.open("rb") as f:
                index = pickle.load(f)
            if not isinstance(index, dict):
                return
            now = time.time()
            for key, expires in index.items():
                if not isinstance(key, str):
                    continue
                exp = float(expires)
                if exp > now and key not in self._stale:
                    # Placeholder — real value loaded on demand from disk
                    self._stale[key] = (exp, _DISK_LAZY)
        except Exception as e:
            logger.warning("[wb_gate] index hydrate failed: %s", e)

    def _update_index(self, key: str, expires: float) -> None:
        if not self.disk_enabled:
            return
        try:
            index: Dict[str, float] = {}
            path = self._index_path()
            if path.exists():
                with path.open("rb") as f:
                    raw = pickle.load(f)
                    if isinstance(raw, dict):
                        index = {str(k): float(v) for k, v in raw.items()}
            index[key] = float(expires)
            # Prune expired
            now = time.time()
            index = {k: v for k, v in index.items() if v > now}
            with path.open("wb") as f:
                pickle.dump(index, f)
        except Exception as e:
            logger.warning("[wb_gate] index update failed: %s", e)

    def _disk_write(self, key: str, value: Any, expires: float) -> None:
        if not self.disk_enabled:
            return
        try:
            payload = {"key": key, "expires": expires, "value": value, "saved_at": time.time()}
            with self._key_path(key).open("wb") as f:
                pickle.dump(payload, f)
            self._update_index(key, expires)
        except Exception as e:
            logger.warning("[wb_gate] disk write failed key=%s err=%s", key[:80], e)

    def _disk_read(self, key: str) -> Optional[Any]:
        if not self.disk_enabled:
            return None
        path = self._key_path(key)
        if not path.exists():
            return None
        try:
            with path.open("rb") as f:
                payload = pickle.load(f)
            expires = float(payload.get("expires") or 0)
            if time.time() > expires:
                try:
                    path.unlink(missing_ok=True)  # type: ignore[call-arg]
                except TypeError:
                    try:
                        path.unlink()
                    except Exception:
                        pass
                return None
            value = payload.get("value")
            # Refresh memory
            self._stale[key] = (expires, value)
            return value
        except Exception as e:
            logger.warning("[wb_gate] disk read failed key=%s err=%s", key[:80], e)
            return None

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
        if value is _DISK_LAZY:
            return self._disk_read(key)
        return value

    def stale_get(self, key: str) -> Optional[Any]:
        item = self._stale.get(key)
        if item:
            expires, value = item
            if time.time() > expires:
                self._stale.pop(key, None)
            elif value is _DISK_LAZY:
                loaded = self._disk_read(key)
                if loaded is not None:
                    return loaded
            else:
                return value
        return self._disk_read(key)

    def stale_get_related(self, cache_key: str) -> Optional[Any]:
        """Exact stale/disk hit, else newest still-valid entry in the same family."""
        exact = self.stale_get(cache_key)
        if exact is not None:
            return exact

        family = self._family_prefix(cache_key)
        # Also try family alias file directly
        family_hit = self.stale_get(family)
        if family_hit is not None:
            return family_hit

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
            # Scan disk index for family matches
            best_key = self._disk_best_family_key(family)
            if best_key is None:
                return None
        return self.stale_get(best_key)

    def _disk_best_family_key(self, family: str) -> Optional[str]:
        if not self.disk_enabled:
            return None
        path = self._index_path()
        if not path.exists():
            return None
        try:
            with path.open("rb") as f:
                index = pickle.load(f)
            if not isinstance(index, dict):
                return None
            now = time.time()
            best_key = None
            best_expires = -1.0
            for key, expires in index.items():
                exp = float(expires)
                if exp <= now:
                    continue
                if key == family or str(key).startswith(family + ":"):
                    if exp >= best_expires:
                        best_expires = exp
                        best_key = str(key)
            return best_key
        except Exception:
            return None

    def list_cached_families(self) -> List[str]:
        """Human-facing list of WeatherMesh families available from memory/disk."""
        now = time.time()
        families = set()
        for key, (expires, _) in list(self._stale.items()):
            if expires > now:
                families.add(self._family_prefix(key))
        if self.disk_enabled and self._index_path().exists():
            try:
                with self._index_path().open("rb") as f:
                    index = pickle.load(f)
                for key, expires in (index or {}).items():
                    if float(expires) > now:
                        families.add(self._family_prefix(str(key)))
            except Exception:
                pass
        return sorted(families)

    def cache_set(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        life = float(ttl if ttl is not None else self.min_interval)
        now = time.time()
        expire_fresh = now + life
        expire_stale = now + max(life, self.stale_ttl)
        self._cache[key] = (expire_fresh, value)
        self._stale[key] = (expire_stale, value)
        self._disk_write(key, value, expire_stale)
        # Family alias so a later valid_time / bbox miss can still reuse this payload
        family = self._family_prefix(key)
        if family and family != key:
            self._stale[family] = (expire_stale, value)
            self._disk_write(family, value, expire_stale)

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
            "disk_cache_enabled": self.disk_enabled,
            "disk_cache_dir": str(self.disk_dir),
            "cached_families": self.list_cached_families()[:20],
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

        - Prefer fresh memory cache.
        - Else memory/disk stale (exact or related family).
        - If rate window open, fetch upstream and persist to disk.
        - If rate window closed and nothing cached: raise (never sleep in chat).
        """
        if not force:
            cached = self.cache_get(cache_key)
            if cached is not None:
                return cached, True
            stale_hit = self.stale_get_related(cache_key)
            if stale_hit is not None and self.seconds_until_allowed() > 0:
                return stale_hit, True

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
                    available = self.list_cached_families()
                    hint = ""
                    if available:
                        hint = f" Cached families available: {', '.join(available[:8])}."
                    raise RateLimitedFetch(
                        wait,
                        f"WeatherMesh rate window active; retry in {wait:.0f}s "
                        f"(no saved snapshot for this field yet).{hint}",
                    )

            result = await fetcher()
            self._last_fetch_at = time.time()
            self._save_meta()
            self.cache_set(cache_key, result, ttl=ttl)
            return result, False


class _DiskLazySentinel:
    pass


_DISK_LAZY = _DiskLazySentinel()

# Singleton shared by cyclone + gridded + optional future WB calls
wb_fetch_gate = WindBorneFetchGate()
