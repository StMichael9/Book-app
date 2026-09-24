import { useState } from "react";
import { Link } from "react-router-dom";
import BookStatusControl from "./BookStatusControl.jsx";

export default function BookCard({ book }) {
  const [imageFailed, setImageFailed] = useState(false);
  const title = book.title || "Untitled book";
  const initials =
    title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() || "")
      .join("") || "BK";
  const tags = Array.isArray(book.tags) ? book.tags : [];
  const visibleTags = tags.slice(0, 2);
  const hiddenTagCount = Math.max(0, tags.length - visibleTags.length);
  const authors =
    book.authors?.map((author) => author.name).join(", ") || "Unknown Author";

  return (
    <article className="book-card-redesign">
      <Link
        to={`/book/${book.id}`}
        className="book-card-redesign__cover-link"
        aria-label={`Open details for ${title}`}
        title={title}
      >
        <div className="book-card-redesign__cover">
          {book.cover_image_url && !imageFailed ? (
            <img
              src={book.cover_image_url}
              alt={`Cover of ${title}`}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div
              className="book-card-redesign__fallback"
              aria-label="No cover available"
            >
              <span className="book-card-redesign__fallback-mark">
                {initials}
              </span>
              <span className="book-card-redesign__fallback-label">
                No cover available
              </span>
            </div>
          )}
          <span className="book-card-redesign__spine" aria-hidden="true" />
        </div>
      </Link>

      <div className="book-card-redesign__body">
        <div className="book-card-redesign__metadata">
          <span>{book.published_year || "Year unknown"}</span>
        </div>

        <Link
          to={`/book/${book.id}`}
          className="book-card-redesign__title-link"
          title={title}
        >
          <h3>{title}</h3>
        </Link>

        <p className="book-card-redesign__author" title={authors}>
          {authors}
        </p>

        {visibleTags.length > 0 && (
          <div className="book-card-redesign__tags" aria-label="Book subjects">
            {visibleTags.map((tag) => (
              <span key={tag.id ?? tag.name}>{tag.name}</span>
            ))}
            {hiddenTagCount > 0 && <span>+{hiddenTagCount} more</span>}
          </div>
        )}

        <BookStatusControl bookId={book.id} compact />
      </div>
    </article>
  );
}
