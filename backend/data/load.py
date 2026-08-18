from database import SessionLocal
from models import Author, Book, Tag, TagType
import pandas as pd 

load = pd.read_json('data/json_data/books_combined.json')

print(load.head())
print(load.info())

db = SessionLocal()

# Combined into a single loop
for row in load.itertuples():
    # 1. Process Author
    author = db.query(Author).filter_by(name=row.author).first()
    if not author:
        author = Author(name=row.author)
        db.add(author)
        print(author.name)

    # 2. Process Tags
    book_tags_for_this_row = []
    for genre_name in row.genre:
        tag = db.query(Tag).filter_by(name=genre_name, type=TagType.genre).first()
        if not tag:
            tag = Tag(name=genre_name, type=TagType.genre)
            db.add(tag)
            print(tag.name)
        book_tags_for_this_row.append(tag)

    # 3. Process Book
    year = int(row.first_publish_year) if pd.notna(row.first_publish_year) else None

    book = db.query(Book).filter_by(title=row.title, published_year=year).first()
    if not book:
        book = Book(title=row.title, published_year=year)
        book.authors.append(author)
        for tag in book_tags_for_this_row:
            book.tags.append(tag)
        db.add(book)
        print(book.title)

db.commit()
db.close()
