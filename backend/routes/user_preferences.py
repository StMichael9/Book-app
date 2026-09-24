from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from database import get_db
from auth.dependencies import get_current_user
from models import User
from schemas import SetPreferencesRequest, UserPreferenceSchema
from services.user_preferences import UserPreferenceService
from rate_limit import limiter

router = APIRouter()


@router.post("/me/preferences", response_model=list[UserPreferenceSchema])
@limiter.limit("30/minute")
def set_preferences(
    request: Request,
    data: SetPreferencesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = UserPreferenceService(db)
    return service.set_preferences(current_user.id, data.tag_ids, data.source_text)


@router.get("/me/preferences", response_model=list[UserPreferenceSchema])
@limiter.limit("30/minute")
def get_preferences(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = UserPreferenceService(db)
    return service.get_preferences(current_user.id)