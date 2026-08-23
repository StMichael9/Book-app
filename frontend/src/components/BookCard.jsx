import { useState } from "react";
import { Link } from "react-router-dom";

function coverInitials(book) {
  const source = book.title || book.authors?.[0]?.name || "Book";
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "BK"
  );
}

export default function BookCard({ book }) {
  const [imageFailed, setImageFailed] = useState(false);
  const coverText = coverInitials(book);

  return (
    <article className="book-card">
      <div className="book-cover" aria-label={book.title || "Book cover"}>
        {book.cover_image_url && !imageFailed ? (
          <img
            src={book.cover_image_url}
            alt={book.title || "Book cover"}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span>{coverText}</span>
        )}
      </div>

      <div className="book-body">
        <div className="book-meta-row">
          <span>{book.published_year || "Year unknown"}</span>
          {book.page_count ? <span>{book.page_count} pages</span> : null}
        </div>

        <Link to={`/book/${book.id}`} className="book-title-link">
          <h4>{book.title}</h4>
        </Link>

        {book.subtitle ? (
          <p className="subtitle-line">{book.subtitle}</p>
        ) : null}

        <div className="author-line">
          {book.authors?.length
            ? book.authors.map((author) => author.name).join(", ")
            : "Unknown author"}
        </div>

        {book.tags?.length ? (
          <div className="tag-list">
            {book.tags.map((tag) => (
              <span key={`${book.id}-${tag.id}`} className="tag-chip">
                {tag.name}
                <small>{tag.type || "tag"}</small>
              </span>
            ))}
          </div>
        ) : null}

        {book.description ? (
          <p className="description">{book.description}</p>
        ) : null}
      </div>
    </article>
  );
}
