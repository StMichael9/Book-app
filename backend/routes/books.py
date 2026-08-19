from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db      # the dependency I already built
from models import Book
from schemas import BookSchema
from services import search

from fastapi_pagination import Page
from fastapi_pagination.ext.sqlalchemy import paginate

router = APIRouter()


@router.get("/books", response_model=Page[BookSchema])
def get_books(
    db: Session = Depends(get_db),
    book: str = None,
    author: str = None,
    tag: str = None,
):
    query = search.search_books(
        db,
        book=book,
        author=author,
        tag=tag,
    )
    return paginate(db, query)


@router.get("/books/{book_id}", response_model=BookSchema)
def get_book(book_id: int, db: Session = Depends(get_db)):
     query = select(Book).where(Book.id == book_id)
     result = db.execute(query)
     book = result.scalars().one_or_none()

     if not book:
         raise HTTPException(status_code=404, detail="Book not found")
     return book