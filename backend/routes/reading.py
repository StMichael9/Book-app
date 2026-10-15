from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from sqlalchemy.orm import Session

from database import engine, get_db
from models import User
from rate_limit import limiter
from reading_schemas import AttemptCreate, AttemptPage, AttemptUpdate, EntryDetail, PrivateEntryCreate, ReadingRemoval, ReadingResult, ReadingWorkspace
from routes.library import reading_user, writing_user
from services.reading import ReadingService

router = APIRouter(prefix="/me")


@router.get("/reading-export")
@limiter.limit("3/minute")
def reading_export(request: Request, current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    from services.reading_export import stream_reading_export
    user_id = current_user.id
    # Authentication only read data. Release its connection before opening the
    # bounded export snapshot so each download needs just one connection.
    db.rollback()
    stream = stream_reading_export(engine, user_id)
    return StreamingResponse(stream, media_type="application/x-ndjson", background=BackgroundTask(stream.close),
        headers={"Content-Disposition": 'attachment; filename="bookvane-reading-data.jsonl"',
                 "X-Content-Type-Options": "nosniff"})


@router.get("/home")
@limiter.limit("60/minute")
def reading_home(request: Request, current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    return ReadingService(db).home(current_user.id)


@router.post("/library/private", response_model=EntryDetail)
@limiter.limit("30/minute")
def private_entry(request: Request, data: PrivateEntryCreate,
                  current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    return ReadingService(db).create_private(current_user.id, data)


@router.get("/library/{entry_id}/reading", response_model=ReadingWorkspace)
@limiter.limit("90/minute")
def reading_workspace(request: Request, entry_id: int,
                      current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    return ReadingService(db).workspace(current_user.id, entry_id)


@router.get("/library/{entry_id}/attempts", response_model=AttemptPage)
@limiter.limit("60/minute")
def reading_history(request: Request, entry_id: int, limit: int = Query(default=25, ge=1, le=100),
                    cursor: UUID | None = None, current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    return ReadingService(db).history(current_user.id, entry_id, limit=limit, cursor=cursor)


@router.put("/reading-attempts/{attempt_id}", response_model=ReadingResult)
@limiter.limit("60/minute")
def create_attempt(request: Request, attempt_id: UUID, data: AttemptCreate,
                   current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    return ReadingService(db).create_attempt(current_user.id, attempt_id, data)


@router.get("/reading-attempts/{attempt_id}", response_model=ReadingResult)
@limiter.limit("60/minute")
def reading_detail(request: Request, attempt_id: UUID,
                   current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    return ReadingService(db).attempt_detail(current_user.id, attempt_id)


@router.patch("/reading-attempts/{attempt_id}", response_model=ReadingResult)
@limiter.limit("60/minute")
def change_attempt(request: Request, attempt_id: UUID, data: AttemptUpdate,
                   current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    return ReadingService(db).update_attempt(current_user.id, attempt_id, data)


@router.delete("/reading-attempts/{attempt_id}", response_model=EntryDetail)
@limiter.limit("60/minute")
def remove_attempt(request: Request, attempt_id: UUID, data: ReadingRemoval,
                   current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    return ReadingService(db).remove_attempt(current_user.id, attempt_id, data)


@router.delete("/library/{entry_id}", status_code=204)
@limiter.limit("30/minute")
def forget_entry(request: Request, entry_id: int, data: ReadingRemoval,
                 current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    ReadingService(db).forget_entry(current_user.id, entry_id, data)
    return Response(status_code=204)
