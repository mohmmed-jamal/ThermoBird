"""
ThermoBird v3 — FastAPI Application Factory
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import HTMLResponse
import logging
import traceback
from datetime import datetime

# Auth endpoints intentionally disabled for anonymous/public mode
# from app.api.v1.auth import router as auth_router
from app.api.v1.properties import router as props_router
from app.api.v1.cycles import router as cycles_router
from app.api.v1.simulations import router as simulations_router
from app.api.v1.equation_solver import router as solver_router
from app.api.v1.solver_scripts import router as solver_scripts_router
from app.api.v1.parametric import router as parametric_router
from app.api.v1.transient import router as transient_router
from app.api.v1.simulation import router as simulation_router
from app.redis_client import get_redis, close_redis
from app.config import get_settings
from app.database import engine, Base, AsyncSessionLocal
from app.models.user import User
from sqlalchemy import text

# Error log storage (in-memory, limited size)
ERROR_LOG = []
MAX_ERRORS = 100

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(name)s | %(levelname)s | %(message)s',
    handlers=[
        logging.StreamHandler(),  # Console output
    ]
)
logger = logging.getLogger(__name__)

def log_error(endpoint: str, error_msg: str, traceback_str: str = ""):
    """Log an error with timestamp."""
    ERROR_LOG.append({
        "timestamp": datetime.now().isoformat(),
        "endpoint": endpoint,
        "error": error_msg,
        "traceback": traceback_str
    })
    # Keep only last MAX_ERRORS
    if len(ERROR_LOG) > MAX_ERRORS:
        ERROR_LOG.pop(0)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Database setup is best-effort: properties, the equation solver, and
    # stateless cycle solving don't touch the database at all, so a Postgres
    # outage shouldn't take the whole API down. Only persistence-backed
    # features (simulations, saved solver scripts, canvas saves) degrade if
    # this fails.
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

            # Databases that predate the auth removal may still have the old
            # `users` table with legacy columns (hashed_password, etc.) marked
            # NOT NULL. create_all() only creates missing tables — it never
            # alters an existing one to match the current (minimal) User model.
            # Relax any such leftover NOT NULL constraints so the anonymous seed
            # row below can insert cleanly. No-op on a fresh database that never
            # had these columns.
            await conn.execute(text("""
                DO $$
                DECLARE
                    col RECORD;
                BEGIN
                    FOR col IN
                        SELECT column_name FROM information_schema.columns
                        WHERE table_name = 'users' AND is_nullable = 'NO'
                        AND column_name <> 'id'
                    LOOP
                        EXECUTE format('ALTER TABLE users ALTER COLUMN %I DROP NOT NULL', col.column_name);
                    END LOOP;
                END $$;
            """))

        # Seed the single anonymous user (id=0) that AnonymousUser/get_current_user
        # maps every request to. Public/anonymous mode has no signup flow to create
        # this row, and owner_id/user_id FKs on Simulation, SolverScript, and
        # CanvasSave are NOT NULL — without this row every create call 500s on a
        # foreign-key violation.
        async with AsyncSessionLocal() as session:
            existing = await session.get(User, 0)
            if existing is None:
                session.add(User(id=0, email="anonymous@thermobird.local"))
                try:
                    await session.commit()
                except Exception:
                    # Don't let a seeding hiccup take down the whole app —
                    # log it and continue; requests that need owner_id=0 will
                    # surface a clear FK error instead of the app never starting.
                    await session.rollback()
                    logger.error("Failed to seed anonymous user (id=0) — see traceback", exc_info=True)
    except Exception:
        logger.error(
            "Database unavailable at startup — continuing without it. "
            "Property lookups, the equation solver, and stateless cycle solving "
            "will still work; saving/loading simulations, solver scripts, and "
            "canvas saves will fail until the database is reachable.",
            exc_info=True,
        )

    await get_redis()
    yield
    try:
        await close_redis()
    except Exception:
        pass
    try:
        await engine.dispose()
    except Exception:
        pass


def create_app() -> FastAPI:
    # Disable interactive docs in production — never expose schema publicly
    docs_url = "/docs" if not settings.is_production else None
    redoc_url = "/redoc" if not settings.is_production else None
    openapi_url = "/openapi.json" if not settings.is_production else None

    app = FastAPI(
        title="ThermoBird API",
        version=settings.APP_VERSION,
        description="Open thermodynamic simulation platform by Quanta Labs.",
        lifespan=lifespan,
        docs_url=docs_url,
        redoc_url=redoc_url,
        openapi_url=openapi_url,
    )

    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.allowed_hosts_list or ["localhost", "127.0.0.1"],
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
    )

    # Error catching middleware
    @app.middleware("http")
    async def catch_errors(request: Request, call_next) -> Response:
        try:
            response = await call_next(request)
            return response
        except Exception as e:
            tb = traceback.format_exc()
            log_error(str(request.url), str(e), tb)
            logging.error(f"Error in {request.url}: {e}\n{tb}")
            raise  # Re-raise to let FastAPI handle it

    # Security headers middleware — applied to every response
    @app.middleware("http")
    async def add_security_headers(request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    app.include_router(props_router,          prefix="/api/v1")
    app.include_router(cycles_router,         prefix="/api/v1")
    app.include_router(simulations_router,    prefix="/api/v1")
    app.include_router(solver_router,         prefix="/api/v1")
    app.include_router(solver_scripts_router, prefix="/api/v1")
    app.include_router(parametric_router,     prefix="/api/v1")
    app.include_router(transient_router,      prefix="/api/v1")
    app.include_router(simulation_router,     prefix="/api/v1")

    @app.get("/health")
    async def health():
        return {"status": "ok", "version": settings.APP_VERSION}

    if settings.ENABLE_DEBUG_ROUTES and not settings.is_production:
        # Error viewer page - local debugging only; never exposed in production
        @app.get("/debug/errors", response_class=HTMLResponse)
        async def view_errors():
            html = """
            <!DOCTYPE html>
            <html>
            <head>
                <title>ThermoBird - Error Log</title>
                <style>
                    body { font-family: monospace; background: #1e1e1e; color: #d4d4d4; padding: 20px; }
                    h1 { color: #f48771; }
                    .error { background: #2d2d2d; padding: 15px; margin: 10px 0; border-left: 4px solid #f48771; }
                    .timestamp { color: #858585; font-size: 0.9em; }
                    .endpoint { color: #4fc1ff; }
                    .message { color: #f48771; white-space: pre-wrap; }
                    .traceback { color: #ce9178; font-size: 0.85em; overflow-x: auto; }
                    .refresh { background: #0e639c; color: white; border: none; padding: 10px 20px; cursor: pointer; }
                    .refresh:hover { background: #1177bb; }
                    .clear { background: #f48771; color: white; border: none; padding: 10px 20px; cursor: pointer; margin-left: 10px; }
                </style>
            </head>
            <body>
                <h1>ThermoBird Error Log</h1>
                <button class="refresh" onclick="location.reload()">Refresh</button>
                <button class="clear" onclick="fetch('/debug/clear-errors').then(()=>location.reload())">Clear</button>
                <p>Total errors: """ + str(len(ERROR_LOG)) + """</p>
                <hr>
            """

            for err in reversed(ERROR_LOG):
                html += f"""
                <div class="error">
                    <div class="timestamp">{err['timestamp']}</div>
                    <div class="endpoint">{err['endpoint']}</div>
                    <div class="message">{err['error']}</div>
                    <pre class="traceback">{err['traceback']}</pre>
                </div>
                """

            html += """
            </body>
            </html>
            """
            return html

        @app.get("/debug/clear-errors")
        async def clear_errors():
            ERROR_LOG.clear()
            return {"message": "Errors cleared"}

        @app.get("/debug/python-info")
        async def python_info():
            import sys
            return {
                "python_executable": sys.executable,
                "python_version": sys.version,
                "path": sys.path[:5],
            }

    return app


app = create_app()
