import re
from pathlib import Path
from typing import Generator, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.exc import DisconnectionError, OperationalError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).parent / ".env",
        extra="ignore"
    )

    database_url: str = Field(alias="DATABASE_URL")
    secret_key: str = Field(alias="SECRET_KEY")
    is_dev: bool = Field(default=False, alias="IS_DEV")
    cookie_domain: str | None = Field(
        default=None,
        alias="COOKIE_DOMAIN"
    )
    cookie_samesite: Literal["lax", "strict", "none"] | None = Field(
        default=None, alias="COOKIE_SAMESITE"
    )
    resend_api_key: str | None = Field(default=None, alias="RESEND_API_KEY")
    password_reset_from: str | None = Field(default=None, alias="PASSWORD_RESET_FROM")
    frontend_base_url: str | None = Field(default=None, alias="FRONTEND_BASE_URL")
    reading_v3_enabled: bool = Field(default=False, alias="READING_V3_ENABLED")
    reading_v3_user_ids: str = Field(default="", alias="READING_V3_USER_IDS")
    admin_emails: str = Field(default="", alias="ADMIN_EMAILS")
    library_import_enabled: bool = Field(default=False, alias="LIBRARY_IMPORT_ENABLED")
    external_catalogue_enabled: bool = Field(default=False, alias="EXTERNAL_CATALOGUE_ENABLED")
    external_catalogue_token: SecretStr | None = Field(default=None, alias="EXTERNAL_CATALOGUE_TOKEN")
    library_import_max_database_mb: int = Field(default=800, ge=100, le=800, alias="LIBRARY_IMPORT_MAX_DATABASE_MB")
    sentry_dsn: str | None = Field(default=None, alias="SENTRY_DSN")
    sentry_environment: str | None = Field(default=None, alias="SENTRY_ENVIRONMENT")

    @field_validator("reading_v3_user_ids")
    @classmethod
    def check_reading_allowlist(cls, value: str) -> str:
        from uuid import UUID
        return ",".join(str(UUID(item.strip())) for item in value.split(",") if item.strip())

    @field_validator("database_url")
    @classmethod
    def check_postgres(cls, v: str) -> str:
        if not v.startswith(
            ("postgresql://", "postgresql+psycopg2://")
        ):
            raise ValueError(
                "DATABASE_URL must be a valid PostgreSQL connection string"
            )
        return v

    @model_validator(mode="after")
    def check_production_security(self):
        if not self.is_dev:
            if len(self.secret_key.encode("utf-8")) < 32:
                raise ValueError("Production SECRET_KEY must be at least 32 bytes")
            if self.frontend_base_url and not self.frontend_base_url.startswith("https://"):
                raise ValueError("Production FRONTEND_BASE_URL must use HTTPS")
        return self


settings = Settings()

# The API runs far from the database (about 60 ms per round trip). Writes are rare and must not fail because the tab sat
# idle, so they ping each connection before use; the ping also recycles anything older than Neon's idle suspend.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_recycle=240,
)

SessionLocal = sessionmaker(bind=engine)

# Reads are many and cheap to repeat, so they skip the ping: connections are recycled before Neon's idle suspend can
# drop them, and a read whose connection died is retried once (ReadSession). They also need no BEGIN/ROLLBACK round
# trips, so they run on an autocommit connection from their own pool.
read_engine = create_engine(
    settings.database_url,
    pool_recycle=240,
).execution_options(isolation_level="AUTOCOMMIT")

# Only routes that never write or stream may use it. Exports stream with server-side cursors, and imports and
# every non-GET request keep ordinary transactions.
AUTOCOMMIT_READS = re.compile(
    r"^/(books(/\d+)?|autocomplete/[a-z/]+|me/(reading-capabilities|library|home|next-read|preferences|books"
    r"|library/\d+(/reading|/attempts)?|reading-attempts/[0-9a-fA-F-]+))$"
)


class ReadSession(Session):
    """A session for read-only requests: if the pooled connection was dropped, ask once more on a fresh one."""

    def execute(self, *args, **kwargs):
        try:
            return super().execute(*args, **kwargs)
        except (OperationalError, DisconnectionError) as error:
            if not (isinstance(error, DisconnectionError) or error.connection_invalidated):
                raise
            self.rollback()  # hands the dead connection back so the pool discards it
            return super().execute(*args, **kwargs)


class Base(DeclarativeBase):
    pass


def get_db(request: Request) -> Generator[Session, None, None]:
    reading = request.method == "GET" and AUTOCOMMIT_READS.match(request.url.path)
    db = ReadSession(bind=read_engine) if reading else SessionLocal()
    try:
        yield db
    finally:
        db.close()
