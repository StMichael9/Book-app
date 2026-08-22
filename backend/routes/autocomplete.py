from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from database import get_db
from services.autocomplete import AutocompleteService
from schemas import AuthorSchema, TagSchema
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