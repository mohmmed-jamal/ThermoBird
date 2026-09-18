"""
TheroBird — Redis client and session cache
Redis is OPTIONAL — all helpers return None/default gracefully if Redis is unavailable.
"""
import json
from typing import Optional
import redis.asyncio as aioredis
from app.config import get_settings

settings = get_settings()

_redis: Optional[aioredis.Redis] = None
_redis_available: bool = True   # flipped to False on first connection failure


async def get_redis() -> Optional[aioredis.Redis]:
    global _redis, _redis_available

    if not _redis_available:
        return None

    try:
        if _redis is None:
            _redis = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        # Ping to verify the connection is alive
        await _redis.ping()
        return _redis
    except Exception:
        _redis = None
        _redis_available = False
        return None


async def close_redis():
    global _redis, _redis_available
    if _redis:
        try:
            await _redis.close()
        except Exception:
            pass
    _redis = None
    _redis_available = True   # reset so next startup retries


# ---------------------------------------------------------------------------
# Property cache helpers
# ---------------------------------------------------------------------------

PROPS_CACHE_TTL = 3600


async def get_cached_properties(
    redis: Optional[aioredis.Redis], fluid: str, pair: str,
    v1: float, v2: float, units: str
) -> Optional[dict]:
    if redis is None:
        return None
    try:
        key = f"props:{fluid}:{pair}:{v1}:{v2}:{units}"
        raw = await redis.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def cache_properties(
    redis: Optional[aioredis.Redis], fluid: str, pair: str,
    v1: float, v2: float, units: str, result: dict
):
    if redis is None:
        return
    try:
        key = f"props:{fluid}:{pair}:{v1}:{v2}:{units}"
        await redis.setex(key, PROPS_CACHE_TTL, json.dumps(result))
    except Exception:
        pass
