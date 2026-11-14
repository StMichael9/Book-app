from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from database import get_db
from services.autocomplete import AutocompleteService, suggest_books
from schemas import AuthorSchema, BookSuggestion, TagSchema
from rate_limit import limiter

router = APIRouter(
    prefix="/autocomplete",
    tags=["Autocomplete"],
)


@router.get("/authors", response_model=list[AuthorSchema])
@limiter.limit("60/minute")
def autocomplete_authors(
    request: Request,
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    service = AutocompleteService(db)
    return service.suggest_authors(q)


@router.get("/tags", response_model=list[TagSchema])
@limiter.limit("60/minute")
def autocomplete_tags(
    request: Request,
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    service = AutocompleteService(db)
    return service.suggest_tags(q)


@router.get("/tags/batch", response_model=list[TagSchema])
@limiter.limit("60/minute")
def resolve_tags(
    request: Request,
    name: list[str] = Query(..., min_length=1, max_length=30),
    db: Session = Depends(get_db),
):
    return AutocompleteService(db).resolve_tags(name)


@router.get("/books", response_model=list[BookSuggestion])
@limiter.limit("60/minute")
def autocomplete_books(
    request: Request,
    q: str = Query("", max_length=200),
    limit: int = Query(6),
    db: Session = Depends(get_db),
):
    """Title type-ahead for the header search: [] below 2 characters, at most 8 listed books."""
    return suggest_books(db, q, limit)
