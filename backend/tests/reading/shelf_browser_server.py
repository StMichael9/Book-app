"""Disposable real API fixture for status-shelf regression; never deploy."""
import os
from pathlib import Path
import sys

from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
url = make_url(os.environ['DATABASE_URL'])
if (os.getenv('BOOKVANE_TEST_DB_ISOLATED') != 'yes' or url.host != '127.0.0.1'
        or url.port != 55437 or url.username != 'bookvane_v3_test'
        or url.database != 'bookvane_shelf_browser_test'):
    raise RuntimeError('Requires the fresh, disposable local shelf browser database')

from database import SessionLocal, engine
from models import Book, User
from sqlalchemy import func, select, text

with engine.connect() as connection:
    assert not connection.scalar(text('SELECT rolsuper FROM pg_roles WHERE rolname=current_user'))
    assert connection.scalar(text('SELECT version_num FROM alembic_version')) == 'a17d09c25ef1'
with SessionLocal.begin() as session:
    if session.scalar(select(func.count()).select_from(Book)) or session.scalar(select(func.count()).select_from(User)):
        raise RuntimeError('Fresh synthetic database required; existing records will not be changed')
    session.add(Book(title='Shelf transition regression book'))

if __name__ == '__main__':
    import uvicorn
    uvicorn.run('main:app', host='127.0.0.1', port=8006)
