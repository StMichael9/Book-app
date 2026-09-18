from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
from auth.dependencies import get_current_user
from models import User, UserBookStatus
from schemas import SetBookStatusRequest, UserBookSchema
from services.user_books import UserBookService
from rate_limit import limiter

router = APIRouter()


@router.post("/books/{book_id}/status", response_model=UserBookSchema)
@limiter.limit("30/minute")
def set_book_status(
    request: Request,
    book_id: int,
    data: SetBookStatusRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = UserBookService(db)
    result = service.set_status(current_user.id, book_id, data.status)

    if result is None:
        raise HTTPException(status_code=404, detail="Book not found")

    return result


@router.get("/me/books", response_model=list[UserBookSchema])
@limiter.limit("60/minute")
def get_my_books(
    request: Request,
    status: UserBookStatus | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = UserBookService(db)
    return service.get_user_books(current_user.id, status)


@router.delete("/books/{book_id}/status", status_code=204)
@limiter.limit("30/minute")
def delete_book_status(
    request: Request,
    book_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = UserBookService(db)
    deleted = service.delete_status(current_user.id, book_id)

    if not deleted:
        raise HTTPException(status_code=404, detail="Status not found")