"""Private reading-library contract 1. Public BookSchema remains unchanged."""
from datetime import date, datetime
from uuid import UUID
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator

LibraryFacet = Literal["all", "owned", "want", "reading", "paused", "finished", "dnf"]


class FlagUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_owned: StrictBool | None = None
    is_wanted: StrictBool | None = None
    expected_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def explicit_flags(self):
        flags = self.model_fields_set & {"is_owned", "is_wanted"}
        if not flags or any(getattr(self, key) is None for key in flags):
            raise ValueError("Supply at least one explicit Own or Want boolean")
        return self


class EntryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(strict=True, ge=1)
    is_owned: StrictBool | None = None
    is_wanted: StrictBool | None = None
    save_note: str | None = Field(default=None, max_length=500)

    @field_validator("save_note")
    @classmethod
    def empty_note(cls, value):
        return value if value and value.strip() else None

    @model_validator(mode="after")
    def explicit_changes(self):
        if not (self.model_fields_set - {"expected_version"}):
            raise ValueError("Supply a library change")
        if any(getattr(self, key) is None for key in self.model_fields_set & {"is_owned", "is_wanted"}):
            raise ValueError("Own and Want must be explicit booleans")
        return self


class LibraryLookup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    book_ids: list[Annotated[int, Field(strict=True, ge=1)]] = Field(max_length=50)

    @model_validator(mode="after")
    def valid_ids(self):
        self.book_ids = list(dict.fromkeys(self.book_ids))
        return self


class ReadingRemoval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(strict=True, ge=1)
    confirmed: StrictBool

    @field_validator("confirmed")
    @classmethod
    def require_confirmation(cls, value):
        if not value:
            raise ValueError("Confirm this removal explicitly")
        return value


class LibraryBook(BaseModel):
    id: int
    title: str
    cover_image_url: str | None
    authors: list[dict[str, str | int]]
    page_count: int | None
    isbn13: str | None = None


class LibraryEntry(BaseModel):
    id: int
    book_id: int | None
    book: LibraryBook | None
    private_title: str | None
    private_author: str | None
    is_owned: bool
    is_wanted: bool
    version: int
    reading_state: str | None
    created_at: datetime
    updated_at: datetime


class LibraryPage(BaseModel):
    items: list[LibraryEntry]
    counts: dict[str, int]
    total: int
    next_cursor: str | None


class EntryDetail(LibraryEntry):
    save_note: str | None


class PrivateEntryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID
    title: str = Field(min_length=1, max_length=500)
    author: str | None = Field(default=None, max_length=500)
    is_owned: StrictBool = False
    is_wanted: StrictBool = False


class AttemptValues(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: Literal["reading", "paused", "finished", "dnf"] | None = None
    started_on: date | None = None
    ended_on: date | None = None
    progress_unit: Literal["pages", "percent"] | None = None
    progress_value: int | None = Field(default=None, strict=True, ge=0)
    total_pages: int | None = Field(default=None, strict=True, ge=1)


class AttemptCreate(AttemptValues):
    entry_id: int = Field(strict=True, ge=1)
    expected_version: int = Field(strict=True, ge=1)
    state: Literal["reading", "finished", "dnf"] = "reading"
    edition_id: int | None = Field(default=None, strict=True, ge=1)
    started_via: Literal["library", "discovery", "next_read"] | None = None


class AttemptUpdate(AttemptValues):
    expected_version: int = Field(strict=True, ge=1)
    note: str | None = Field(default=None, max_length=2000)
    reaction: Literal["loved", "liked", "not_for_me"] | None = None

    @field_validator("note")
    @classmethod
    def empty_note(cls, value):
        return value if value and value.strip() else None

    @model_validator(mode="after")
    def has_changes(self):
        if not (self.model_fields_set - {"expected_version"}):
            raise ValueError("Supply a reading change")
        if "state" in self.model_fields_set and self.state is None:
            raise ValueError("Reading state cannot be empty")
        return self


class AttemptView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    state: str
    started_on: date | None
    ended_on: date | None
    progress_unit: str | None
    progress_value: int | None
    total_pages: int | None
    edition_id: int | None
    edition_source_id: str | None
    edition_format: str | None
    created_at: datetime
    updated_at: datetime


class AttemptDetail(AttemptView):
    note: str | None
    reaction: str | None


class ReadingResult(BaseModel):
    entry: EntryDetail
    attempt: AttemptDetail


class ReadingWorkspace(BaseModel):
    entry: EntryDetail
    current_attempt: AttemptDetail | None
    editions: list[dict]


class AttemptPage(BaseModel):
    items: list[AttemptView]
    next_cursor: UUID | None
