from database import SessionLocal
from models import Author, Book, Tag, TagType
import pandas as pd


load = pd.read_json("json_data/books_combined.json")

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
        tag = (
            db.query(Tag)
            .filter_by(name=genre_name, type=TagType.genre)
            .first()
        )

        if not tag:
            tag = Tag(name=genre_name, type=TagType.genre)
            db.add(tag)
            print(tag.name)

        book_tags_for_this_row.append(tag)


    # 3. Build cover image URL
    cover_image_url = None

    if pd.notna(row.cover_id):
        cover_image_url = (
            f"https://covers.openlibrary.org/b/id/{int(row.cover_id)}-L.jpg"
        )

    # 3b. Description, straight from the pipeline's Works API fetch.
    # Same "may legitimately be missing" handling as everything else here.
    description = row.description if pd.notna(row.description) else None


    # 4. Process Book
    year = (
        int(row.first_publish_year)
        if pd.notna(row.first_publish_year)
        else None
    )

    book = (
        db.query(Book)
        .join(Book.authors)
        .filter(
            Book.title == row.title,
            Author.name == row.author
        )
        .first()
    )

    if not book:
        book = Book(
            title=row.title,
            published_year=year,
            cover_image_url=cover_image_url,
            description=description
        )

        book.authors.append(author)

        for tag in book_tags_for_this_row:
            book.tags.append(tag)

        db.add(book)
        print(book.title)
    else:
        # Existing books (already loaded before cover_image_url/description
        # existed) would otherwise never get these backfilled, since this
        # branch previously did nothing for books that already exist.
        if not book.cover_image_url and cover_image_url:
            book.cover_image_url = cover_image_url
            print(f"Backfilled cover for: {book.title}")

        if not book.description and description:
            book.description = description
            print(f"Backfilled description for: {book.title}")


db.commit()
db.close()