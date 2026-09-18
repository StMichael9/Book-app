from pydantic import BaseModel, ConfigDict, field_validator
from models import UserBookStatus

MIN_COUNT_TO_DISPLAY = 5


class AuthorSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class TagSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    type: str


class BookSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    subtitle: str | None = None
    description: str | None = None
    published_year: int | None = None
    cover_image_url: str | None = None
    page_count: int | None = None
    authors: list[AuthorSchema] = []
    tags: list[TagSchema] = []
    owned_count: int | None = None
    want_count: int | None = None

    @field_validator("owned_count", "want_count", mode="before")
    @classmethod
    def hide_low_counts(cls, v):
        return None if v is not None and v < MIN_COUNT_TO_DISPLAY else v


class BookSearchResponse(BaseModel):
    items: list[BookSchema]
    total: int



class SetBookStatusRequest(BaseModel):
    status: UserBookStatus


class UserBookSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    book_id: int
    status: UserBookStatus
    book: BookSchema


class SetPreferencesRequest(BaseModel):
    tag_ids: list[int]
    source_text: str | None = None


class UserPreferenceSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    tag_id: int
    source_text: str | None
    tag: TagSchema