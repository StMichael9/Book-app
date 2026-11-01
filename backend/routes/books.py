from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query
from sqlalchemy import exists, select, func
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import joinedload, Session

from database import get_db
from models import Book, User, UserBook, UserBookStatus
from schemas import BookSchema
from services import catalogue_cache, search
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


def _with_details():
    # Authors, subjects and alternate titles come back in the same statement as the books themselves.
    return (joinedload(Book.authors), joinedload(Book.tags), joinedload(Book.title_aliases))


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
    # Anonymous pages are the same for everyone, so they are kept for a minute; signed-in pages are personalised.
    cache_key = ("list", tuple(sorted(request.query_params.multi_items()))) if current_user is None else None
    if cache_key is not None and (hit := catalogue_cache.get(cache_key)) is not None:
        return hit
    service = search.SearchService(db)
    query = service.search_books(
        book=book,
        author=author,
        tags=tag,
        current_user=current_user,
        exclude_owned=exclude_owned,
        shelf_status=shelf_status,
    )
    # Page the ids first (with the total counted in the same statement), then load just those books. Selecting full
    # rows before OFFSET evaluates the correlated Own/Want counters for skipped rows on deep catalogue pages.
    rows = db.execute(
        query.with_only_columns(Book.id, func.count().over().label("total"))
        .limit(params.size).offset((params.page - 1) * params.size)
    ).all()
    if rows:
        total = rows[0].total
    elif params.page == 1:
        total = 0
    else:  # a page past the end carries no rows to read the total from
        total = db.execute(select(func.count()).select_from(
            query.with_only_columns(Book.id).order_by(None).subquery())).scalar_one()
    ids = [row.id for row in rows]
    if not ids:
        result = Page.create(items=[], total=total, params=params)
    else:
        books = db.execute(select(Book).where(Book.id.in_(ids)).options(*_with_details())).unique().scalars().all()
        by_id = {item.id: item for item in books}
        result = Page.create(items=[BookSchema.model_validate(by_id[book_id]) for book_id in ids], total=total, params=params)
    if cache_key is not None:
        catalogue_cache.put(cache_key, jsonable_encoder(result), catalogue_cache.LIST_TTL)
    return result


@router.get("/books/{book_id}/description")
def book_description(book_id: int, response: Response, db: Session = Depends(get_db)):
    """A catalogue book's description (Open Library data), separate so cards and lists stay light."""
    row = db.execute(select(Book.description).where(Book.id == book_id)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Book not found")
    text = row[0].strip() if row[0] and row[0].strip() else None
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return {"text": text, "source": "openlibrary" if text else None}


@router.get("/books/{book_id}", response_model=BookSchema)
@limiter.limit("30/minute")
def get_book(
    request: Request,
    response: Response,
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    cache_key = ("book", book_id) if current_user is None else None
    if cache_key is not None and (hit := catalogue_cache.get(cache_key)) is not None:
        cache_if_anonymous(response, current_user)
        return hit
    book = db.execute(
        select(Book).where(Book.id == book_id).options(*_with_details())
    ).unique().scalar_one_or_none()

    # Discovery shows only complete books, but never break a reader's own saved book.
    if book and not book.is_listed and not (current_user and db.scalar(select(exists().where(
            UserBook.book_id == book.id, UserBook.user_id == current_user.id)))):
        book = None

    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    cache_if_anonymous(response, current_user)
    if cache_key is not None:
        catalogue_cache.put(cache_key, BookSchema.model_validate(book).model_dump(mode="json"), catalogue_cache.BOOK_TTL)
    return book
