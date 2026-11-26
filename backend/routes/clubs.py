from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database import get_db
from models import User
from rate_limit import limiter
from services import clubs

router = APIRouter(tags=["clubs"])
STRICT = ConfigDict(extra="forbid", str_strip_whitespace=True)
COLOR = Field(default=None, max_length=12, pattern=r"^#?[A-Za-z0-9-]{1,11}$")


class ClubCreate(BaseModel):
    model_config = STRICT
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    color: str | None = COLOR


class ClubUpdate(BaseModel):
    model_config = STRICT
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    color: str | None = COLOR
    member_limit: int | None = Field(default=None, ge=2, le=25)

    @model_validator(mode="after")
    def name_not_null(self):
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("A name is required")
        if "member_limit" in self.model_fields_set and self.member_limit is None:
            raise ValueError("A member limit is a number from 2 to 25")
        return self


class JoinRequest(BaseModel):
    model_config = STRICT
    token: str = Field(min_length=1, max_length=100)


class InviteCreate(BaseModel):
    model_config = STRICT
    expires_in_days: int = Field(default=clubs.INVITE_DAYS, ge=1, le=60)
    max_uses: int | None = Field(default=None, ge=1, le=1000)


class RoleChange(BaseModel):
    model_config = STRICT
    role: Literal["admin", "member"]


class Sharing(BaseModel):
    model_config = STRICT
    share_progress: StrictBool


class BookCreate(BaseModel):
    model_config = STRICT
    book_id: int = Field(ge=1)
    status: Literal["current", "upcoming", "past"] = "upcoming"
    starts_on: date | None = None
    ends_on: date | None = None


class BookUpdate(BaseModel):
    model_config = STRICT
    status: Literal["current", "upcoming", "past"] | None = None
    starts_on: date | None = None
    ends_on: date | None = None


class BookAdvance(BaseModel):
    model_config = STRICT
    next_club_book_id: int | None = Field(default=None, ge=1)


class CheckpointCreate(BaseModel):
    model_config = STRICT
    unit: Literal["pages", "percent"]
    value: int = Field(ge=0, le=100000)
    due_on: date | None = None
    label: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def percent_range(self):
        if self.unit == "percent" and self.value > 100:
            raise ValueError("A percent is 0 to 100")
        return self


class PostCreate(BaseModel):
    model_config = STRICT
    body: str = Field(min_length=1, max_length=2000)
    anchor_unit: Literal["pages", "percent"] | None = None
    anchor_value: int | None = Field(default=None, ge=0, le=100000)

    @model_validator(mode="after")
    def both_or_neither(self):
        if (self.anchor_unit is None) != (self.anchor_value is None):
            raise ValueError("Give both anchor_unit and anchor_value, or neither")
        if self.anchor_unit == "percent" and self.anchor_value > 100:
            raise ValueError("A percent is 0 to 100")
        return self


class PostEdit(BaseModel):
    model_config = STRICT
    body: str = Field(min_length=1, max_length=2000)


class ReportRequest(BaseModel):
    model_config = STRICT
    reason: str | None = Field(default=None, max_length=200)


class Review(BaseModel):
    model_config = STRICT
    action: Literal["restore", "delete"]


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"


# --- clubs and joining ---------------------------------------------------------------------------------------------------------

@router.post("/me/clubs", status_code=201)
@limiter.limit("10/minute")
def create_club(request: Request, response: Response, data: ClubCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _no_store(response)
    return clubs.create_club(db, user, data.name, data.description, data.color)


@router.get("/me/clubs")
@limiter.limit("60/minute")
def my_clubs(request: Request, response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _no_store(response)
    return {"items": clubs.my_clubs(db, user)}


@router.post("/me/clubs/join")
@limiter.limit("20/minute")
def join_club(request: Request, response: Response, data: JoinRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _no_store(response)
    return clubs.join(db, user, data.token)


@router.get("/club-invites/{token}")
@limiter.limit("30/minute")
def invite_preview(request: Request, response: Response, token: str, db: Session = Depends(get_db)):
    """The join page before signing in: the club's name and size only. An invalid, expired or revoked link is a plain 404."""
    _no_store(response)
    return clubs.invite_preview(db, token)


@router.get("/clubs/{club_id}")
@limiter.limit("90/minute")
def club_detail(request: Request, response: Response, club_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _no_store(response)
    return clubs.detail(db, club_id, user)


@router.patch("/clubs/{club_id}")
@limiter.limit("30/minute")
def club_update(request: Request, club_id: int, data: ClubUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return clubs.update_club(db, club_id, user, data.model_dump(exclude_unset=True))


@router.delete("/clubs/{club_id}", status_code=204)
@limiter.limit("10/minute")
def club_delete(request: Request, club_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    clubs.delete_club(db, club_id, user)
    return Response(status_code=204)


# --- members and invites ------------------------------------------------------------------------------------------------------------

@router.get("/clubs/{club_id}/members")
@limiter.limit("90/minute")
def club_members(request: Request, response: Response, club_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _no_store(response)
    return {"items": clubs.members(db, club_id, user)}


@router.patch("/clubs/{club_id}/me")
@limiter.limit("30/minute")
def my_sharing(request: Request, club_id: int, data: Sharing, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Opt in or out of showing this club your progress on its current book. Off by default."""
    return clubs.set_my_sharing(db, club_id, user, data.share_progress)


@router.patch("/clubs/{club_id}/members/{user_id}")
@limiter.limit("30/minute")
def member_role(request: Request, club_id: int, user_id: UUID, data: RoleChange, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return clubs.change_role(db, club_id, user, user_id, data.role)


@router.delete("/clubs/{club_id}/members/{user_id}", status_code=204)
@limiter.limit("30/minute")
def member_remove(request: Request, club_id: int, user_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    clubs.remove_member(db, club_id, user, user_id)
    return Response(status_code=204)


@router.post("/clubs/{club_id}/leave", status_code=204)
@limiter.limit("30/minute")
def club_leave(request: Request, club_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    clubs.leave(db, club_id, user)
    return Response(status_code=204)


@router.post("/clubs/{club_id}/invites", status_code=201)
@limiter.limit("20/minute")
def invite_create(request: Request, response: Response, club_id: int, data: InviteCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _no_store(response)
    return clubs.create_invite(db, club_id, user, data.expires_in_days, data.max_uses)


@router.get("/clubs/{club_id}/invites")
@limiter.limit("60/minute")
def invite_list(request: Request, response: Response, club_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _no_store(response)
    return {"items": clubs.list_invites(db, club_id, user)}


@router.delete("/clubs/{club_id}/invites/{invite_id}", status_code=204)
@limiter.limit("30/minute")
def invite_revoke(request: Request, club_id: int, invite_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    clubs.revoke_invite(db, club_id, user, invite_id)
    return Response(status_code=204)


# --- books, checkpoints, posts ----------------------------------------------------------------------------------------------------------

@router.post("/clubs/{club_id}/books", status_code=201)
@limiter.limit("30/minute")
def book_add(request: Request, club_id: int, data: BookCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return clubs.add_book(db, club_id, user, data.model_dump())


@router.patch("/clubs/{club_id}/books/{club_book_id}")
@limiter.limit("30/minute")
def book_update(request: Request, club_id: int, club_book_id: int, data: BookUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return clubs.update_book(db, club_id, user, club_book_id, data.model_dump(exclude_unset=True))


@router.post("/clubs/{club_id}/books/{club_book_id}/advance")
@limiter.limit("30/minute")
def book_advance(request: Request, response: Response, club_id: int, club_book_id: int, data: BookAdvance | None = Body(default=None),
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Finish this (current) book and, optionally, start an upcoming one, in one step. Owners and admins only."""
    _no_store(response)
    return clubs.advance_book(db, club_id, user, club_book_id, data.next_club_book_id if data else None)


@router.delete("/clubs/{club_id}/books/{club_book_id}", status_code=204)
@limiter.limit("30/minute")
def book_delete(request: Request, club_id: int, club_book_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    clubs.delete_book(db, club_id, user, club_book_id)
    return Response(status_code=204)


@router.post("/clubs/{club_id}/books/{club_book_id}/checkpoints", status_code=201)
@limiter.limit("30/minute")
def checkpoint_add(request: Request, club_id: int, club_book_id: int, data: CheckpointCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return clubs.add_checkpoint(db, club_id, user, club_book_id, data.model_dump())


@router.delete("/clubs/{club_id}/books/{club_book_id}/checkpoints/{checkpoint_id}", status_code=204)
@limiter.limit("30/minute")
def checkpoint_delete(request: Request, club_id: int, club_book_id: int, checkpoint_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    clubs.delete_checkpoint(db, club_id, user, club_book_id, checkpoint_id)
    return Response(status_code=204)


@router.get("/clubs/{club_id}/books/{club_book_id}/posts")
@limiter.limit("90/minute")
def posts_list(request: Request, response: Response, club_id: int, club_book_id: int, before: int | None = Query(None, ge=1),
               limit: int = Query(clubs.POST_PAGE, ge=1, le=100), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _no_store(response)
    return clubs.list_posts(db, club_id, user, club_book_id, before, limit)


@router.post("/clubs/{club_id}/books/{club_book_id}/posts", status_code=201)
@limiter.limit("30/minute")
def post_create(request: Request, response: Response, club_id: int, club_book_id: int, data: PostCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _no_store(response)
    return clubs.create_post(db, club_id, user, club_book_id, data.body, data.anchor_unit, data.anchor_value)


@router.patch("/clubs/{club_id}/posts/{post_id}")
@limiter.limit("30/minute")
def post_edit(request: Request, club_id: int, post_id: int, data: PostEdit, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return clubs.edit_post(db, club_id, user, post_id, data.body)


@router.delete("/clubs/{club_id}/posts/{post_id}", status_code=204)
@limiter.limit("30/minute")
def post_delete(request: Request, club_id: int, post_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    clubs.delete_post(db, club_id, user, post_id)
    return Response(status_code=204)


@router.post("/clubs/{club_id}/posts/{post_id}/report")
@limiter.limit("20/minute")
def post_report(request: Request, club_id: int, post_id: int, data: ReportRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return clubs.report_post(db, club_id, user, post_id, data.reason)


@router.get("/clubs/{club_id}/reports")
@limiter.limit("60/minute")
def reports_list(request: Request, response: Response, club_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _no_store(response)
    return {"items": clubs.reports(db, club_id, user)}


@router.post("/clubs/{club_id}/posts/{post_id}/review")
@limiter.limit("30/minute")
def post_review(request: Request, club_id: int, post_id: int, data: Review, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return clubs.review_post(db, club_id, user, post_id, data.action)
