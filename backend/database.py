from pathlib import Path
from typing import Generator

from pydantic import Field, field_validator
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
    is_dev: bool = Field(default=True, alias="IS_DEV")
    cookie_domain: str | None = Field(
        default=None,
        alias="COOKIE_DOMAIN"
    )

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