from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from services.autocomplete import AutocompleteService
from schemas import AuthorSchema, TagSchema

router = APIRouter(
    prefix="/autocomplete",
    tags=["Autocomplete"],
)


@router.get("/authors", response_model=list[AuthorSchema])
def autocomplete_authors(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    service = AutocompleteService(db)
    return service.suggest_authors(q)


@router.get("/tags", response_model=list[TagSchema])
def autocomplete_tags(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    service = AutocompleteService(db)
    return service.suggest_tags(q)