from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, Query, Response
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database import get_db
from models import User
from services import profile as service

router = APIRouter(tags=["profile"])
PUBLIC_CACHE = "public, max-age=60"  # no stale-while-revalidate: going private must show within a minute
PROFILE_FIELDS = {"display_name", "bio", "handle", "profile_public", "prompted"}


@router.get("/me/profile")
def get_profile(current_user: User = Depends(get_current_user)):
    return service.profile_view(current_user)


@router.patch("/me/profile")
def patch_profile(changes: dict = Body(...), current_user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    return service.update_profile(db, current_user, {key: value for key, value in changes.items() if key in PROFILE_FIELDS})


@router.get("/me/stats")
def get_stats(year: int | None = Query(None, ge=1900, le=2200), current_user: User = Depends(get_current_user),
              db: Session = Depends(get_db)):
    return service.year_stats(db, current_user.id, year or datetime.now(timezone.utc).year)


@router.get("/me/lists")
def get_lists(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.my_lists(db, current_user.id)


@router.post("/me/lists", status_code=201)
def post_list(body: dict = Body(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.create_list(db, current_user, body.get("name"), body.get("description"), body.get("is_public", False))


@router.get("/me/lists/{list_id}")
def get_list(list_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.owner_list(db, current_user, list_id)


@router.patch("/me/lists/{list_id}")
def patch_list(list_id: int, body: dict = Body(...), current_user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    return service.edit_list(db, current_user, list_id,
                             {key: value for key, value in body.items() if key in {"name", "description", "is_public"}})


@router.delete("/me/lists/{list_id}", status_code=204)
def remove_list(list_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    service.delete_list(db, current_user, list_id)
    return Response(status_code=204)


@router.post("/me/lists/{list_id}/books", status_code=204)
def post_list_book(list_id: int, body: dict = Body(...), current_user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    book_id = body.get("book_id")
    if not isinstance(book_id, int) or isinstance(book_id, bool):
        raise service.fail(422, "book_id_invalid")
    service.add_book(db, current_user, list_id, book_id)
    return Response(status_code=204)


@router.delete("/me/lists/{list_id}/books/{book_id}", status_code=204)
def delete_list_book(list_id: int, book_id: int, current_user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    service.remove_book(db, current_user, list_id, book_id)
    return Response(status_code=204)


@router.put("/me/lists/{list_id}/order", status_code=204)
def put_order(list_id: int, body: dict = Body(...), current_user: User = Depends(get_current_user),
              db: Session = Depends(get_db)):
    ids = body.get("book_ids")
    if not isinstance(ids, list) or not all(isinstance(item, int) and not isinstance(item, bool) for item in ids):
        raise service.fail(422, "order_mismatch")
    service.reorder(db, current_user, list_id, ids)
    return Response(status_code=204)


@router.get("/u/{handle}")
def public_profile(handle: str, response: Response, db: Session = Depends(get_db)):
    payload = service.public_profile(db, handle)
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return payload


@router.get("/u/{handle}/lists/{list_id}")
def public_list(handle: str, list_id: int, response: Response, db: Session = Depends(get_db)):
    payload = service.public_list(db, handle, list_id)
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return payload
