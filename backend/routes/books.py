from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query
from sqlalchemy import exists, select, func
from sqlalchemy.orm import selectinload, Session

from database import get_db
from models import Book, User, UserBook, UserBookStatus
from schemas import BookSchema
from services import search
from rate_limit import limiter
from auth.dependencies import get_current_user_optional

from fastapi_pagination import Page, Params

router = APIRouter()

PUBLIC_CACHE = "public, max-age=60, stale-while-revalidate=300"


def cache_if_anonymous(response: Response, current_user: User | None) -> None:
    # Signed-in responses are personalised (preference order, saved-book access), so only anonymous reads are shareable.
    if current_user is None:
        response.headers["Cache-Control"] = PUBLIC_CACHE
        response.headers["Vary"] = "Cookie"


@router.get("/books", response_model=Page[BookSchema])
@limiter.limit("30/minute")
def get_books(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
    book: str = None,
    author: str = None,
    tag: list[str] = Query(None),
    exclude_owned: bool = False,
    shelf_status: UserBookStatus | None = None,
    params: Params = Depends(),
):
    cache_if_anonymous(response, current_user)
    service = search.SearchService(db)
    query = service.search_books(
        book=book,
        author=author,
        tags=tag,
        current_user=current_user,
        exclude_owned=exclude_owned,
        shelf_status=shelf_status,
    )
    # Page IDs first. Selecting full Book rows before OFFSET evaluates the
    # correlated Own/Want counters for skipped rows on deep catalogue pages.
    id_query = query.with_only_columns(Book.id)
    total = db.execute(
        select(func.count()).select_from(id_query.order_by(None).subquery())
    ).scalar_one()
    ids = db.execute(
        id_query.limit(params.size).offset((params.page - 1) * params.size)
    ).scalars().all()
    if not ids:
        return Page.create(items=[], total=total, params=params)
    books = db.execute(
        select(Book)
        .where(Book.id.in_(ids))
        .options(selectinload(Book.authors), selectinload(Book.tags))
    ).scalars().all()
    by_id = {book.id: book for book in books}
    return Page.create(items=[by_id[book_id] for book_id in ids], total=total, params=params)


@router.get("/books/{book_id}", response_model=BookSchema)
@limiter.limit("30/minute")
def get_book(
    request: Request,
    response: Response,
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
     query = (
         select(Book)
         .where(Book.id == book_id)
         .options(selectinload(Book.authors), selectinload(Book.tags))
     )
     result = db.execute(query)
     book = result.scalars().one_or_none()

     # Discovery shows only complete books, but never break a reader's own saved book.
     if book and not book.is_complete and not (current_user and db.scalar(select(exists().where(
             UserBook.book_id == book.id, UserBook.user_id == current_user.id)))):
         book = None

     if not book:
         raise HTTPException(status_code=404, detail="Book not found")
     cache_if_anonymous(response, current_user)
     return book
