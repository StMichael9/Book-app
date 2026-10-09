from pathlib import Path
from typing import Generator, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine
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

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True
)

SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
