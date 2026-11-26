from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from auth.auth import clear_auth_cookies
from auth.dependencies import get_current_user
from database import get_db
from models import User
from rate_limit import limiter
from services import account

router = APIRouter(tags=["account"])


class DeleteAccount(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: Literal["delete"]


@router.delete("/me", status_code=204)
@limiter.limit("5/minute")
def delete_me(request: Request, data: DeleteAccount, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    account.delete_account(db, user)
    response = Response(status_code=204)
    clear_auth_cookies(response)
    return response
