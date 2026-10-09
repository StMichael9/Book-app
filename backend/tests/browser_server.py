"""Loopback-only HTTPS integration harness. Never deploy this test server.

Requires a fresh, separately owned disposable database and an explicit opt-in.
Only email delivery is replaced; authentication, cookies and writes use the
real application and PostgreSQL. No external email or catalogue requests.
"""
import os
import sys
from pathlib import Path
from sqlalchemy.engine import make_url

url = make_url(os.environ["DATABASE_URL"])
if (os.environ.get("BOOKVANE_TEST_DB_ISOLATED") != "yes"
        or url.host != "127.0.0.1" or url.port != 55432
        or not url.database or "browser_test" not in url.database
        or url.username != "bookvane_test"):
    raise RuntimeError("Browser harness requires the loopback-only disposable browser_test database")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ssl
import threading
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import jwt
import uvicorn
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import func, select, text

from main import app
from database import SessionLocal, engine, settings
from models import Author, Book, Tag, TagType
from auth.dependencies import get_current_user
from auth import auth

with engine.connect() as connection:
    database, role, superuser = connection.execute(text(
        "SELECT current_database(), current_user, rolsuper FROM pg_roles WHERE rolname=current_user"
    )).one()
    if database != url.database or role != "bookvane_test" or superuser:
        raise RuntimeError("Unexpected database or privileged test role")

with SessionLocal.begin() as session:
    if session.scalar(select(func.count()).select_from(Book)):
        raise RuntimeError("Use a fresh browser_test database; existing books will not be modified")
    fantasy = Tag(name="fantasy", type=TagType.genre)
    mystery = Tag(name="mystery", type=TagType.genre)
    author = Author(name="Local integration fixture")
    session.add_all([Book(title="Local browser integration book", authors=[author], tags=[fantasy, mystery]), fantasy, mystery])

delivered_links = {}


def capture_email(email, link):
    delivered_links[email] = link


auth.send_password_reset_email = capture_email
settings.resend_api_key = "local-test-only-no-external-email"
settings.password_reset_from = "Bookvane <reset@example.com>"
test_header = "local-browser-test-only"


def require_test_header(request: Request):
    if request.headers.get("X-Bookvane-Test") != test_header:
        raise HTTPException(status_code=403)


@app.get("/__test__/reset-link", dependencies=[Depends(require_test_header)])
def reset_link(email: str):
    return {"url": delivered_links.get(email)}


@app.get("/__test__/expire-access", dependencies=[Depends(require_test_header)])
def expire_access(response: Response, user=Depends(get_current_user)):
    token = jwt.encode({"sub": str(user.id), "ver": user.token_version,
        "exp": datetime.now(timezone.utc) - timedelta(seconds=1)}, settings.secret_key, algorithm="HS256")
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none")
    return {"message": "Test access token expired"}


dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if not (dist / "index.html").is_file():
    raise RuntimeError("Build the standard frontend entry before starting the harness")


class Frontend(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(dist), **kwargs)

    def do_GET(self):
        if not Path(self.translate_path(self.path)).is_file():
            self.path = "/index.html"
        super().do_GET()

    def log_message(self, *_args):
        pass


certificate = os.environ["BOOKVANE_TEST_CERT"]
private_key = os.environ["BOOKVANE_TEST_KEY"]
server = ThreadingHTTPServer(("127.0.0.1", 5192), Frontend)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(certificate, private_key)
server.socket = context.wrap_socket(server.socket, server_side=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
uvicorn.run(app, host="127.0.0.1", port=8009, ssl_certfile=certificate, ssl_keyfile=private_key)
