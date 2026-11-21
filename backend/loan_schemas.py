"""Request and response shapes for lending (T75)."""
from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator


class LoanBrief(BaseModel):
    """The open loan as it rides along with a library entry."""
    id: UUID
    direction: Literal["lent", "borrowed"]
    person_name: str
    started_on: date
    due_on: date | None = None
    overdue: bool = False
    said_back: bool = False          # the borrower tapped "I've given it back" on the link (lent loans only)
    has_link: bool = False           # a live share link exists (the token itself is never in these payloads)


class LoanView(LoanBrief):
    entry_id: int
    ended_on: date | None = None


class LoanCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID
    direction: Literal["lent", "borrowed"]
    person_name: str = Field(min_length=1, max_length=80)
    entry_id: int | None = Field(default=None, ge=1)
    book_id: int | None = Field(default=None, ge=1)       # borrowed only: put the catalogue book on the shelf (not owned) as well
    due_on: date | None = None
    started_on: date | None = None

    @model_validator(mode="after")
    def one_target(self):
        if (self.entry_id is None) == (self.book_id is None):
            raise ValueError("Give either entry_id or book_id")
        if self.book_id is not None and self.direction != "borrowed":
            raise ValueError("book_id is only for a borrowed book")
        return self


class LoanPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    person_name: str | None = Field(default=None, min_length=1, max_length=80)
    due_on: date | None = None
    ended: StrictBool | None = None

    @model_validator(mode="after")
    def only_closing(self):
        if self.ended is False:
            raise ValueError("A closed loan cannot be reopened")
        if "person_name" in self.model_fields_set and self.person_name is None:
            raise ValueError("A name is required")
        return self


class ShareLink(BaseModel):
    url: str


class PublicLoan(BaseModel):
    """What the borrower's link shows: the one book and the lender's first name. Never the borrower's name."""
    state: Literal["open", "closed"]
    title: str | None = None
    authors: list[str] = []
    cover_url: str | None = None
    lender_first_name: str | None = None
    started_on: date
    due_on: date | None = None
    said_back: bool = False
