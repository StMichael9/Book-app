from fastapi import APIRouter, Response

from data.taxonomy import GENRES

router = APIRouter()


@router.get("/genres")
def get_genres(response: Response):
    """The one genre list every picker, filter and label reads. Public and the same for everyone, so it is cacheable."""
    response.headers["Cache-Control"] = "public, max-age=3600"
    return [{"key": key, "label": label, "group": group} for key, label, group in GENRES]
