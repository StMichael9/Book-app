import os

from fastapi import FastAPI, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import get_db, settings

from routes import books
from routes import autocomplete
from routes import user_books
from routes import user_preferences
from routes import email_signups

from auth.auth import router as auth_router


from fastapi_pagination import add_pagination
from fastapi.middleware.cors import CORSMiddleware

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from rate_limit import limiter

app = FastAPI()

def _parse_cors_origins() -> list[str]:
    configured_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173")
    return [origin.strip() for origin in configured_origins.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_write_origin(request: Request, call_next):
    # Cross-site production cookies need SameSite=None. CORS alone does not
    # prevent a third-party form from sending a credentialed write request.
    if not settings.is_dev and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        if request.headers.get("origin") not in _parse_cors_origins():
            return JSONResponse(status_code=403, content={"detail": "Untrusted request origin"})
    return await call_next(request)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.include_router(books.router)
app.include_router(autocomplete.router)
app.include_router(auth_router)
app.include_router(user_books.router)
app.include_router(user_preferences.router)
app.include_router(email_signups.router)

# Enable fastapi-pagination for the entire FastAPI application.
add_pagination(app)

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}
