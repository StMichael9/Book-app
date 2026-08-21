from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db
from routes import books
from fastapi_pagination import add_pagination

from routes import autocomplete


app = FastAPI()

app.include_router(books.router)
app.include_router(autocomplete.router)
# Enable fastapi-pagination for the entire FastAPI application.
add_pagination(app)

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}