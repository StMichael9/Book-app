from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from data.taxonomy import GENRE_KEYS, GENRES
from database import get_db
from models import Tag, TagType

router = APIRouter()


@router.get("/genres")
def get_genres(response: Response, db: Session = Depends(get_db)):
    """The one genre list every picker, filter and label reads: [{id, key, label, group}], where id is the genre's tag id (what
    preferences and next-read take). Public and the same for everyone, so it is cacheable."""
    ids = dict(db.execute(select(Tag.name, Tag.id).where(Tag.type == TagType.genre, Tag.name.in_(GENRE_KEYS))).all())
    response.headers["Cache-Control"] = "public, max-age=3600"
    return [{"id": ids[key], "key": key, "label": label, "group": group} for key, label, group in GENRES if key in ids]
