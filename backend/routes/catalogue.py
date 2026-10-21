"""Additive catalogue API; legacy /books, discovery filters and imports unchanged."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from database import get_db, settings
from models import Book, User, UserBook
from rate_limit import limiter
from routes.library import reading_user, writing_user
from reading_schemas import PrivateEntryCreate, EntryDetail
from services.external_catalogue import catalogue, CatalogueUnavailable
from services.library import LibraryService
from services.reading import ReadingService

router = APIRouter(prefix='/me/catalogue')


def token():
    if not settings.external_catalogue_enabled or not settings.external_catalogue_token:
        raise HTTPException(503, detail='The extended catalogue is temporarily unavailable. Your existing library is unchanged.')
    return settings.external_catalogue_token.get_secret_value()


@router.get('/search')
@limiter.limit('20/minute')
def search(request: Request, title: str = Query(default='',max_length=200), author: str = Query(default='',max_length=200),
           current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    if not settings.external_catalogue_enabled:
        return {'items':[], 'available':False, 'more_available':False}
    try:
        items = catalogue.search(title,author,token())
    except ValueError:
        raise HTTPException(422, detail='Please use a shorter title or author search.') from None
    except CatalogueUnavailable:
        return {'items':[], 'available':False, 'more_available':False}
    # Prefer existing Neon identities, regardless of which Neon page is visible.
    existing = set(db.scalars(select(Book.source_id).where(Book.source_id.in_([x['source_id'] for x in items])))) if items else set()
    return {'items':[x for x in items[:30] if x['source_id'] not in existing], 'available':True, 'more_available':len(items)>30}


class Selection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    source_id: str = Field(pattern=r'^/works/OL[1-9][0-9]*W$',max_length=100)
    confirmed: StrictBool


@router.post('/select',response_model=EntryDetail)
@limiter.limit('20/minute')
def select_work(request: Request, data: Selection, current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    if not data.confirmed:
        raise HTTPException(422,detail='Confirm this book before adding it.')
    if not settings.external_catalogue_enabled:
        token()  # Keep feature-off behavior explicit, including retries.
    # Reconcile committed local state before depending on remote availability.
    # This owner lock also serializes two different request IDs for one work.
    db.scalar(select(User.id).where(User.id==current_user.id).with_for_update())
    replay = db.scalar(select(UserBook).where(UserBook.user_id==current_user.id,UserBook.create_request_id==data.request_id))
    if replay:
        metadata = replay.private_catalogue or {}
        if data.source_id not in (metadata.get('work_id'),metadata.get('requested_work_id')):
            raise HTTPException(409,detail='This request identifier already represents a different book.')
        return LibraryService(db).detail(current_user.id,replay.id)

    def existing_identity(source_id):
        # Prefer a reader's existing private record even if the shared catalogue
        # subsequently gains this identity. Never overwrite or silently migrate it.
        private = db.scalar(select(UserBook).where(UserBook.user_id==current_user.id,
            or_(UserBook.private_catalogue['work_id'].astext==source_id,
                UserBook.private_catalogue['requested_work_id'].astext==source_id)))
        if private:
            return LibraryService(db).detail(current_user.id,private.id)
        book_id = db.scalar(select(Book.id).where(Book.source_id==source_id))
        if book_id:
            existing = db.scalar(select(UserBook).where(UserBook.user_id==current_user.id,UserBook.book_id==book_id))
            if existing:
                return LibraryService(db).detail(current_user.id,existing.id)
            from reading_schemas import FlagUpdate
            return LibraryService(db).ensure(current_user.id,book_id,FlagUpdate(is_wanted=True))
        return None

    local = existing_identity(data.source_id)
    if local is not None:
        return local
    try:
        work = catalogue.work(data.source_id,token())
    except CatalogueUnavailable:
        raise HTTPException(503,detail='The catalogue could not confirm this book. Nothing was added. Please try again.') from None
    if not work:
        raise HTTPException(404,detail='This book is not in the ready catalogue.')
    local = existing_identity(work['source_id'])
    if local is not None:
        return local
    if len(work['title'])>500 or len(work['author'] or '')>500:
        raise HTTPException(422,detail='These book details are too long to save safely. Add a private book manually.')
    provenance = {'source':'openlibrary','work_id':work['source_id'],'requested_work_id':data.source_id,
                  'snapshot':work['snapshot'],'cover_image_url':work['cover_image_url']}
    return ReadingService(db).create_private(current_user.id,
        PrivateEntryCreate(request_id=data.request_id,title=work['title'],author=work['author'],is_wanted=True),
        catalogue_metadata=provenance)
