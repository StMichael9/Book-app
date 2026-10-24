"""Opt-in public Turso reads plus a fresh synthetic local database; never deploy."""
import os
from pathlib import Path
import sys

from dotenv import dotenv_values
from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
url = make_url(os.environ['DATABASE_URL'])
if (os.getenv('BOOKVANE_TEST_DB_ISOLATED') != 'yes'
        or os.getenv('BOOKVANE_ALLOW_LIVE_PUBLIC_CATALOGUE') != 'yes'
        or url.host != '127.0.0.1' or url.port != 55437 or url.username != 'bookvane_v3_test'
        or url.database != 'bookvane_external_catalogue_live_browser_test'):
    raise RuntimeError('Requires opt-in live public reads and the fresh local catalogue browser database')

# A private, ignored file avoids secrets in command arguments or frontend env.
secret_file = Path(__file__).resolve().parents[2] / '.env.catalogue'
secret = dotenv_values(secret_file).get('EXTERNAL_CATALOGUE_TOKEN')
if not secret:
    raise RuntimeError('Approved database-scoped read-only token is required')
os.environ['EXTERNAL_CATALOGUE_TOKEN'] = secret
os.environ['EXTERNAL_CATALOGUE_ENABLED'] = 'true'
os.environ['RESEND_API_KEY'] = ''

from database import SessionLocal, engine
from models import Book, User
from sqlalchemy import func, select, text

with engine.connect() as connection:
    assert not connection.scalar(text('SELECT rolsuper FROM pg_roles WHERE rolname=current_user'))
    assert connection.scalar(text('SELECT version_num FROM alembic_version')) == 'a17d09c25ef1'
with SessionLocal.begin() as session:
    if session.scalar(select(func.count()).select_from(Book)) or session.scalar(select(func.count()).select_from(User)):
        raise RuntimeError('Fresh synthetic database required; no existing records will be modified')
    session.add(Book(title='Synthetic existing catalogue choice'))

if __name__ == '__main__':
    import uvicorn
    uvicorn.run('main:app', host='127.0.0.1', port=8007)
