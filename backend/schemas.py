from pydantic import BaseModel, ConfigDict


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