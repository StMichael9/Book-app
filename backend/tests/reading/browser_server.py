"""Local M1 integration fixture. Never deploy this test process."""
import os
from pathlib import Path
import sys

from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
url = make_url(os.environ["DATABASE_URL"])
if (os.getenv("BOOKVANE_TEST_DB_ISOLATED") != "yes" or url.host != "127.0.0.1" or url.port != 55433
        or url.username != "bookvane_v3_test" or not (url.database or "").endswith("browser_test")):
    raise RuntimeError("M1 integration requires a fresh local browser_test database")

from database import SessionLocal, engine
from models import Author, Book, Tag, TagType, User
from sqlalchemy import func, select, text

with engine.connect() as connection:
    assert not connection.scalar(text("SELECT rolsuper FROM pg_roles WHERE rolname=current_user"))
    assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "f5c12a608de3"
with SessionLocal.begin() as session:
    if session.scalar(select(func.count()).select_from(Book)) or session.scalar(select(func.count()).select_from(User)):
        raise RuntimeError("Browser integration requires fresh empty fixtures; no existing records are modified")
    session.add(Book(title="Local library integration book", authors=[Author(name="Local test author")],
                     tags=[Tag(name="fantasy", type=TagType.genre)]))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8005)
