from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload, Session

from database import get_db
from models import Book, User, UserBookStatus
from schemas import BookSchema
from services import search
from rate_limit import limiter
from auth.dependencies import get_current_user_optional

from fastapi_pagination import Page
from fastapi_pagination.ext.sqlalchemy import paginate

router = APIRouter()


@router.get("/books", response_model=Page[BookSchema])
@limiter.limit("30/minute")
def get_books(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
    book: str = None,
    author: str = None,
    tag: list[str] = Query(None),
    exclude_owned: bool = False,
    shelf_status: UserBookStatus | None = None,
):
    service = search.SearchService(db)
    query = service.search_books(
        book=book,
        author=author,
        tags=tag,
        current_user=current_user,
        exclude_owned=exclude_owned,
        shelf_status=shelf_status,
    )
    return paginate(db, query)


@router.get("/books/{book_id}", response_model=BookSchema)
@limiter.limit("30/minute")
def get_book(request: Request, book_id: int, db: Session = Depends(get_db)):
     query = (
         select(Book)
         .where(Book.id == book_id)
         .options(selectinload(Book.authors), selectinload(Book.tags))
     )
     result = db.execute(query)
     book = result.scalars().one_or_none()

     if not book:
         raise HTTPException(status_code=404, detail="Book not found")
     return book