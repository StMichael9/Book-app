from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db
from routes import books
from fastapi_pagination import add_pagination

app = FastAPI()

app.include_router(books.router)

# Enable fastapi-pagination for the entire FastAPI application.
add_pagination(app)

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}