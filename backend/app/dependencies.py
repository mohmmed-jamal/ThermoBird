"""
TheroBird v3 — Shared FastAPI Dependencies
Provides: current_user, db session.
"""
from app.database import get_db  # noqa: F401 — re-exported for routes that need a real db session


class AnonymousUser:
    """Lightweight anonymous user object used when auth is disabled.

    This preserves attributes used by endpoints (id, is_active, is_superuser,
    email, full_name, organization) so most routes continue to work without
    requiring authentication. The app is effectively in public/anonymous mode.
    """

    def __init__(self):
        self.id = 0
        self.is_active = True
        self.is_superuser = False
        self.email = "anonymous@thermobird.local"
        self.full_name = "Anonymous"
        self.organization = None


async def get_current_user() -> AnonymousUser:
    """Return an anonymous user for all requests (auth removed).

    Previously this resolved JWTs and loaded a real User from the database.
    For a public deployment we return a fixed AnonymousUser instead, so
    callers can access user-like attributes without requiring login — and,
    just as importantly, without needing a database connection. Routes that
    are pure computation (e.g. the equation solver) can depend on this
    without becoming dependent on Postgres being reachable.
    """
    return AnonymousUser()


async def get_current_user_optional() -> AnonymousUser | None:
    """Optional dependency: return None to indicate no authenticated identity."""
    # Keep behavior minimal: return None to indicate anonymous when optional is used
    return None
