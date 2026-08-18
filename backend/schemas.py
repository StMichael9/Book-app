from pydantic import BaseModel, ConfigDict
from uuid import UUID


class AuthorSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str


class TagSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    type: str


class BookSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
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