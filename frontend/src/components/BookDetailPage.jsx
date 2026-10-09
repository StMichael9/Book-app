import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getBookById } from "../api/books.js";
import BookStatusControl from "./BookStatusControl.jsx";
import ShareBookButton from "./ShareBookButton.jsx";

export default function BookDetailPage() {
  const { bookId } = useParams();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    const loadBook = async () => {
      setLoading(true);
      setError("");
      try {
        const nextBook = await getBookById(bookId);
        if (!ignore) setBook(nextBook);
      } catch (loadError) {
        if (!ignore) {
          setError(loadError.message || "Unable to load this book.");
          setBook(null);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    if (bookId) loadBook();
    return () => {
      ignore = true;
    };
  }, [bookId]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center rounded-2xl border border-stone-800/10 dark:border-stone-200/10 bg-[var(--surface)] p-12 text-sm font-semibold tracking-wider uppercase text-[var(--muted)]">
        Loading book details…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-sm font-medium text-red-600 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (!book) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-stone-800/10 dark:border-stone-200/10 bg-[var(--surface)] p-12 text-center">
        <p className="font-serif text-2xl font-bold text-[var(--text)]">
          This book could not be found.
        </p>
        <span className="text-sm text-[var(--muted)]">
          Try another title or head back to browse.
        </span>
      </div>
    );
  }

  const coverText =
    (book.title || "Book")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "BK";
  const authors =
    book.authors?.map((author) => author.name).filter(Boolean) || [];
  const hasPublishedYear =
    book.published_year !== null && book.published_year !== undefined;
  const hasPageCount =
    book.page_count !== null && book.page_count !== undefined;

  return (
    <article className="book-detail" aria-labelledby="book-detail-title">
      <Link className="book-detail__back" to="/browse">
        <span aria-hidden="true">←</span>
        Back to browse
      </Link>

      <div className="book-detail__layout">
        <div className="book-detail__cover-column">
          <div className="book-detail__cover">
            {book.cover_image_url ? (
              <img src={book.cover_image_url} alt={`Cover of ${book.title}`} />
            ) : (
              <div
                className="book-detail__cover-fallback"
                aria-label={`No cover available for ${book.title}`}
                role="img"
              >
                {coverText}
              </div>
            )}
          </div>
        </div>

        <div className="book-detail__information">
          <header className="book-detail__heading">
            <p className="book-detail__eyebrow">Book details</p>
            <h1 id="book-detail-title">{book.title}</h1>
            {book.subtitle && (
              <p className="book-detail__subtitle">{book.subtitle}</p>
            )}
          </header>

          {(authors.length > 0 || hasPublishedYear || hasPageCount) && (
            <dl className="book-detail__metadata">
              {authors.length > 0 && (
                <div>
                  <dt>Author{authors.length > 1 ? "s" : ""}</dt>
                  <dd>{authors.join(", ")}</dd>
                </div>
              )}
              {hasPublishedYear && (
                <div>
                  <dt>Published</dt>
                  <dd>{book.published_year}</dd>
                </div>
              )}
              {hasPageCount && (
                <div>
                  <dt>Pages</dt>
                  <dd>{book.page_count}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="book-detail__status">
            <BookStatusControl bookId={book.id} />
            <ShareBookButton book={book} />
          </div>

          {book.description && (
            <section
              className="book-detail__description"
              aria-labelledby="book-detail-description"
            >
              <h2 id="book-detail-description">Synopsis</h2>
              <p>{book.description}</p>
            </section>
          )}

          {book.tags?.length > 0 && (
            <section
              className="book-detail__tags"
              aria-labelledby="book-detail-tags"
            >
              <h2 id="book-detail-tags">Subjects</h2>
              <div>
                {book.tags.map((tag) => (
                  <span key={tag.id}>{tag.name}</span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </article>
  );
}
