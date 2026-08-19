from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db      # the dependency I already built
from models import Book
from schemas import BookSchema
from services import search

router = APIRouter()


@router.get("/books", response_model=list[BookSchema])
def get_books(
    db: Session = Depends(get_db),
    book: str = None,
    author: str = None,
    tag: str = None,
):
    # No filters -> book/author/tag all stay None -> search.search_books()
    # applies none of its .where() clauses -> equivalent to the old
    # get_all_books(). Any filters provided behave exactly like the old
    # basic_search_books().
    return search.search_books(db, book=book, author=author, tag=tag)


@router.get("/books/{book_id}", response_model=BookSchema)
def get_book(book_id: int, db: Session = Depends(get_db)):
     query = select(Book).where(Book.id == book_id)
     result = db.execute(query)
     book = result.scalars().one_or_none()

     if not book:
         raise HTTPException(status_code=404, detail="Book not found")
     return book