"""
Authentication endpoints removed.

This module previously provided signup/login/refresh/change-password endpoints.
For the public/anonymous deployment all authentication routes have been removed
to ensure there is no user registration or session/token management.

If you see an import of this module, it now intentionally contains no active
endpoints. Any attempt to call these routes will respond with a 404 because
the router is not included in the application. The original code has been
purged to avoid leaving authentication logic in the codebase.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.get("/")
async def auth_removed():
    return {"detail": "Authentication endpoints have been removed in this build."}
