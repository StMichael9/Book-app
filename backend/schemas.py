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


class BookSuggestion(BaseModel):
    """One title type-ahead suggestion: no description, no tags, just enough for a dropdown row."""
    id: int
    title: str
    authors: list[str] = []
    cover_url: str | None = None
    year: int | None = None


class BookSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    subtitle: str | None = None
    description: str | None = None
    published_year: int | None = None
    cover_image_url: str | None = None
    page_count: int | None = None
    isbn13: str | None = None
    english_title: str | None = None
    authors: list[AuthorSchema] = []
    tags: list[TagSchema] = []
    owned_count: int | None = None
    want_count: int | None = None

    @field_validator("tags", mode="before")
    @classmethod
    def show_only_existing_v2_tags(cls, value):
        if not isinstance(value, list):
            return value
        return [tag for tag in value if (
            tag.get("visible_in_v2", True) if isinstance(tag, dict)
            else getattr(tag, "visible_in_v2", True)
        )]

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


class AuthorPageSchema(BaseModel):
    id: int
    name: str
    bio: str | None = None
    photo_url: str | None = None
    book_count: int = 0


class ShelfFlags(BaseModel):
    entry_id: int
    status: str | None = None
    is_owned: bool = False
    is_wanted: bool = False


class AuthorBookSchema(BookSchema):
    """A catalogue book card plus the signed-in reader's shelf flags (null when signed out or not on a shelf)."""
    shelf: ShelfFlags | None = None
