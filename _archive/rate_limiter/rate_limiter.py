"""
TheroBird v3 — Rate Limiter Service
Tier-aware enforcement using Redis counters.
"""
from fastapi import HTTPException, status
from app.config import get_settings
from app.redis_client import check_and_increment_daily_sim, check_and_increment_api_rpm

settings = get_settings()

# Default rate limits per tier
# Can be moved to settings later if needed
TIER_LIMITS = {
    "free": {
        "daily_sim": 10,      # 10 simulations per day for free tier
        "rpm": 60             # 60 requests per minute
    },
    "pro": {
        "daily_sim": None,    # Unlimited simulations
        "rpm": 300            # 300 requests per minute
    },
    "institution": {
        "daily_sim": None,    # Unlimited simulations
        "rpm": 1000           # 1000 requests per minute
    },
}


async def enforce_api_rate_limit(redis, user_id: int, tier: str):
    """
    Enforce API rate limiting based on user tier.
    Call on every authenticated API request.
    """
    tier_data = TIER_LIMITS.get(tier, TIER_LIMITS["free"])
    limit = tier_data["rpm"]
    
    if not settings.RATE_LIMIT_ENABLED:
        return  # Rate limiting disabled
    
    allowed, count = await check_and_increment_api_rpm(redis, str(user_id), limit)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "API rate limit exceeded",
                "limit": limit,
                "current": count,
                "message": f"You have exceeded {limit} requests per minute. Please try again later.",
            },
        )


async def enforce_simulation_limit(redis, user_id: int, tier: str):
    """
    Enforce daily simulation limit based on user tier.
    Call before every simulation run.
    """
    tier_data = TIER_LIMITS.get(tier, TIER_LIMITS["free"])
    daily_limit = tier_data["daily_sim"]

    # Pro and Institution have unlimited simulations
    if daily_limit is None:
        return

    if not settings.RATE_LIMIT_ENABLED:
        return  # Rate limiting disabled
    
    allowed, count = await check_and_increment_daily_sim(redis, str(user_id), daily_limit)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "Daily simulation limit reached",
                "limit": daily_limit,
                "current": count,
                "resets": "at midnight UTC",
                "message": f"You have reached your daily limit of {daily_limit} simulations.",
            },
        )
