from pydantic import BaseModel, ConfigDict
from models import UserBookStatus

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


class BookSearchResponse(BaseModel):
    items: list[BookSchema]
    total: int

    

class SetBookStatusRequest(BaseModel):
    status: UserBookStatus


class UserBookSchema(BaseModel):
    id: int
    book_id: int
    status: UserBookStatus
    book: BookSchema  # nested, so the frontend gets full book details, not just the FK

class Config:
    from_attributes = True

class SetPreferencesRequest(BaseModel):
    tag_ids: list[int]
    source_text: str | None = None


class UserPreferenceSchema(BaseModel):
    id: int
    tag_id: int
    source_text: str | None
    tag: TagSchema  # nested, assuming you already have a TagSchema from your search feature

class Config:
    from_attributes = True