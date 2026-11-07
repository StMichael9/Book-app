from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from database import get_db
from models import User
from rate_limit import limiter
from routes.library import reading_user, writing_user
from services import up_next

router = APIRouter(prefix="/me", tags=["up-next"])


class UpNextReplace(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entry_ids: list[int]


@router.get("/up-next")
@limiter.limit("60/minute")
def get_up_next(request: Request, current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    return up_next.pins(db, current_user.id)


@router.put("/up-next")
@limiter.limit("60/minute")
def put_up_next(request: Request, data: UpNextReplace, current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    return up_next.replace(db, current_user.id, data.entry_ids)
