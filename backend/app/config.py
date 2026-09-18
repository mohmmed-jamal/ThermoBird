"""
Configuration management for ThermoBird.
Uses Pydantic Settings for environment variable validation and type safety.
"""
from functools import lru_cache
from typing import Optional, List
from pydantic import field_validator, EmailStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    # Application
    APP_NAME: str = "ThermoBird"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"  # development | production

    # API
    API_V1_PREFIX: str = "/api/v1"

    # CORS — comma-separated in env var, split via property below
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"
    ALLOWED_HOSTS: str = "localhost,127.0.0.1"

    # Database
    DATABASE_URL: str = "postgresql://USER:PASSWORD@localhost:5432/thermobird"
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10
    DATABASE_POOL_TIMEOUT: int = 30
    DATABASE_POOL_RECYCLE: int = 3600
    DATABASE_ECHO: bool = False

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_MAX_CONNECTIONS: int = 50
    REDIS_SOCKET_TIMEOUT: int = 5
    REDIS_SOCKET_CONNECT_TIMEOUT: int = 5

    # Simulation Limits
    MAX_COMPONENTS_PER_SIMULATION: int = 50
    MAX_CONNECTIONS_PER_SIMULATION: int = 100
    MAX_SIMULATIONS_PER_USER: int = 100
    SIMULATION_TIMEOUT_SECONDS: int = 300

    # CoolProp
    COOLPROP_CACHE_SIZE: int = 10000
    COOLPROP_THREADS: int = 4

    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"
    LOG_FILE: Optional[str] = None

    @field_validator("LOG_LEVEL")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        v_upper = v.upper()
        if v_upper not in valid_levels:
            raise ValueError(f"LOG_LEVEL must be one of {valid_levels}")
        return v_upper

    # Email
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM_EMAIL: Optional[EmailStr] = None
    SMTP_FROM_NAME: Optional[str] = None

    # File Upload
    MAX_UPLOAD_SIZE_MB: int = 10
    ALLOWED_UPLOAD_EXTENSIONS: str = ".json,.csv,.txt"

    # Cache TTL (seconds)
    CACHE_TTL_SHORT: int = 300
    CACHE_TTL_MEDIUM: int = 3600
    CACHE_TTL_LONG: int = 86400

    # Monitoring
    ENABLE_METRICS: bool = True
    METRICS_PORT: int = 9090

    # Sentry
    SENTRY_DSN: Optional[str] = None
    SENTRY_TRACES_SAMPLE_RATE: float = 0.1

    @field_validator("SENTRY_TRACES_SAMPLE_RATE")
    @classmethod
    def validate_sample_rate(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError("SENTRY_TRACES_SAMPLE_RATE must be between 0.0 and 1.0")
        return v

    # Testing
    TESTING: bool = False
    TEST_DATABASE_URL: Optional[str] = None

    # Performance
    ENABLE_GZIP: bool = True
    GZIP_MINIMUM_SIZE: int = 1000

    # Feature Flags
    ENABLE_WEBSOCKETS: bool = True
    ENABLE_BACKGROUND_TASKS: bool = True
    ENABLE_DEBUG_ROUTES: bool = False

    # Pagination
    DEFAULT_PAGE_SIZE: int = 20
    MAX_PAGE_SIZE: int = 100

    # Workers
    WORKER_CONCURRENCY: int = 4
    WORKER_PREFETCH_MULTIPLIER: int = 4

    # ---------- computed properties ----------

    @property
    def database_url_async(self) -> str:
        """Return async-compatible database URL (postgresql+asyncpg://)."""
        if self.DATABASE_URL.startswith("postgresql://"):
            return self.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
        return self.DATABASE_URL

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT.lower() == "development"

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse comma-separated CORS_ORIGINS into a list."""
        if isinstance(self.CORS_ORIGINS, list):
            return self.CORS_ORIGINS
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def allowed_hosts_list(self) -> List[str]:
        """Parse comma-separated ALLOWED_HOSTS into a list."""
        if isinstance(self.ALLOWED_HOSTS, list):
            return self.ALLOWED_HOSTS
        return [h.strip() for h in self.ALLOWED_HOSTS.split(",") if h.strip()]

    @property
    def allowed_extensions_list(self) -> List[str]:
        return [e.strip() for e in self.ALLOWED_UPLOAD_EXTENSIONS.split(",") if e.strip()]


@lru_cache()
def get_settings() -> Settings:
    """Load and cache settings (reads .env once)."""
    return Settings()


# Convenience instance for direct imports
settings = get_settings()
