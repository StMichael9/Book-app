from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user_optional
from database import get_db
from models import User
from pydantic import BaseModel
from rate_limit import limiter
from routes.books import cache_if_anonymous
from schemas import AuthorBookSchema, AuthorPageSchema, ShelfFlags
from services import authors

router = APIRouter()


class AuthorBooksPage(BaseModel):
    items: list[AuthorBookSchema]
    total: int
    page: int
    size: int
    pages: int


@router.get("/authors/{author_id}", response_model=AuthorPageSchema)
@limiter.limit("60/minute")
def get_author(request: Request, response: Response, author_id: int, db: Session = Depends(get_db)):
    """One author: name, bio (Open Library, when it has one), photo URL and the number of catalogue books. Public."""
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=600"
    return authors.get_author(db, author_id)


@router.get("/authors/{author_id}/books", response_model=AuthorBooksPage)
@limiter.limit("60/minute")
def get_author_books(request: Request, response: Response, author_id: int, page: int = Query(1, ge=1, le=10_000),
                     db: Session = Depends(get_db), current_user: User | None = Depends(get_current_user_optional)):
    cache_if_anonymous(response, current_user)
    result = authors.author_books(db, author_id, page, current_user)
    items = []
    for book, shelf in result["items"]:
        item = AuthorBookSchema.model_validate(book)
        item.shelf = ShelfFlags.model_validate(shelf) if shelf else None
        items.append(item)
    result["items"] = items
    return result
