import os
import logging
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import get_db, settings, SessionLocal
from observability import environment_name, init_sentry

from routes import books
from routes import catalogue
from routes import autocomplete
from routes import user_books
from routes import user_preferences
from routes import email_signups
from routes import library
from routes import reading
from routes import library_imports
from routes import events

from auth.auth import router as auth_router


from fastapi_pagination import add_pagination
from fastapi.middleware.cors import CORSMiddleware

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from rate_limit import limiter

@asynccontextmanager
async def app_lifespan(_app):
    # No scheduled worker or paid service. Readers cannot resume/access expired
    # staging even before this bounded physical cleanup gets an opportunity.
    if settings.reading_v3_enabled:
        from sqlalchemy.exc import SQLAlchemyError
        from services.library_imports.workflow import ImportWorkflow
        try:
            with SessionLocal.begin() as maintenance:
                maintenance.execute(text("SET LOCAL statement_timeout = '8s'"))
                maintenance.execute(text("SET LOCAL lock_timeout = '1s'"))
                if maintenance.scalar(text("SELECT to_regclass('library_import_runs') IS NOT NULL")) and maintenance.scalar(text("SELECT pg_try_advisory_xact_lock(513005,3)")):
                    ImportWorkflow(maintenance).cleanup()
        except SQLAlchemyError:
            logging.getLogger(__name__).warning("Import staging cleanup deferred; next import activity can retry.")
    yield


# Error reporting starts only when SENTRY_DSN is set; with no key nothing is initialised and nothing is sent.
init_sentry(settings.sentry_dsn, environment_name(settings))

app = FastAPI(lifespan=app_lifespan)


class PrivateQueryLogFilter(logging.Filter):
    """Keep private library search text out of Uvicorn access logs."""

    def filter(self, record):
        if isinstance(record.args, tuple) and len(record.args) == 5:
            client, method, target, protocol, status = record.args
            if isinstance(target, str) and target.split("?", 1)[0].startswith("/me/"):
                record.args = (client, method, target.split("?", 1)[0], protocol, status)
        return True


access_logger = logging.getLogger("uvicorn.access")
if not any(isinstance(item, PrivateQueryLogFilter) for item in access_logger.filters):
    access_logger.addFilter(PrivateQueryLogFilter())

def _parse_cors_origins() -> list[str]:
    configured_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173" if settings.is_dev else "")
    origins = [origin.strip() for origin in configured_origins.split(",") if origin.strip()]
    if not settings.is_dev:
        if not origins:
            raise ValueError("Production CORS_ORIGINS must explicitly list HTTPS frontend origins")
        for origin in origins:
            parsed = urlsplit(origin)
            if (parsed.scheme != "https" or not parsed.hostname or "*" in origin
                    or parsed.username is not None or parsed.password is not None
                    or parsed.path or parsed.query or parsed.fragment
                    or any(character.isspace() for character in origin)):
                raise ValueError("Production CORS_ORIGINS must contain exact HTTPS origins, not wildcards or URLs with paths")
    return origins


app.add_middleware(library_imports.ImportBodyLimit)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "PUT", "PATCH"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_write_origin(request: Request, call_next):
    # Cross-site production cookies need SameSite=None. CORS alone does not
    # prevent a third-party form from sending a credentialed write request.
    if not settings.is_dev and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        if request.headers.get("origin") not in _parse_cors_origins():
            return JSONResponse(status_code=403, content={"detail": "Untrusted request origin"})
    response = await call_next(request)
    if request.url.path.startswith("/me/"):
        response.headers["Cache-Control"] = "private, no-store"
    return response

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.include_router(books.router)
app.include_router(catalogue.router)
app.include_router(autocomplete.router)
app.include_router(auth_router)
app.include_router(user_books.router)
app.include_router(user_preferences.router)
app.include_router(email_signups.router)
app.include_router(library.router)
app.include_router(reading.router)
app.include_router(library_imports.router)
app.include_router(events.router)
app.include_router(library_imports.sources_router)

# Enable fastapi-pagination for the entire FastAPI application.
add_pagination(app)

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}
