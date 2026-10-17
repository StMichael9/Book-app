from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database import get_db, settings
from models import User
from rate_limit import limiter
from reading_schemas import EntryDetail, EntryUpdate, FlagUpdate, LibraryFacet, LibraryLookup, LibraryPage
from services.library import LibraryService, library_needs_v3, reading_enabled, require_reading
from services.reading import ReadingService

router = APIRouter(prefix="/me")


def reading_user(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_reading(current_user.id, db)
    return current_user


def writing_user(current_user: User = Depends(get_current_user)):
    require_reading(current_user.id, write=True)
    return current_user


@router.get("/reading-capabilities")
@limiter.limit("60/minute")
def capabilities(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    writable = reading_enabled(current_user.id)
    return {"enabled": writable or library_needs_v3(db, current_user.id), "writable": writable, "contract_version": 1,
            "milestone": "M5" if settings.library_import_enabled else "M4", "features": {"library": True, "reading_actions": True,
            "private_context": True, "reading_export": True, "privacy_controls": True, "next_read": True,
            "library_import": writable and settings.library_import_enabled}}


@router.get("/library", response_model=LibraryPage)
@limiter.limit("60/minute")
def library_page(request: Request, q: str = Query(default="", max_length=200),
                 facet: LibraryFacet = "all", limit: int = Query(default=25, ge=1, le=100),
                 cursor: str | None = Query(default=None, max_length=1024),
                 label: str = Query(default="", max_length=120),
                 current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    return LibraryService(db).page(current_user.id, q=q, facet=facet, limit=limit, cursor=cursor, label=label)


@router.post("/library/lookup")
@limiter.limit("90/minute")
def lookup(request: Request, data: LibraryLookup, current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    return {"items": LibraryService(db).lookup(current_user.id, data.book_ids)}


@router.put("/library/books/{book_id}", response_model=EntryDetail)
@limiter.limit("60/minute")
def ensure_entry(request: Request, book_id: int, data: FlagUpdate,
                 current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    return LibraryService(db).ensure(current_user.id, book_id, data)


@router.get("/library/private-matches")
@limiter.limit("60/minute")
def private_matches(request: Request, title: str = Query(min_length=1, max_length=500),
                    current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    return {"items": ReadingService(db).private_matches(current_user.id, title)}


@router.get("/library/{entry_id}", response_model=EntryDetail)
@limiter.limit("90/minute")
def entry_detail(request: Request, entry_id: int, current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    return LibraryService(db).detail(current_user.id, entry_id)


@router.patch("/library/{entry_id}", response_model=EntryDetail)
@limiter.limit("60/minute")
def update_entry(request: Request, entry_id: int, data: EntryUpdate,
                 current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    return LibraryService(db).update(current_user.id, entry_id, data)
