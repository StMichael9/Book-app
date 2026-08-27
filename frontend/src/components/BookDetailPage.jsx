import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getBookById } from "../api/books.js";

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

  return (
    <article className="mx-auto max-w-5xl py-6">
      {/* Back Link with Micro-Interaction */}
      <Link
        to="/browse"
        className="group inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted)] transition-colors hover:text-[var(--accent)] mb-8"
      >
        <span className="transition-transform duration-200 group-hover:-translate-x-1">
          ←
        </span>{" "}
        Back to browse
      </Link>

      <div className="grid gap-10 md:grid-cols-12 md:items-start">
        {/* 3D Physical Book Display */}
        <div className="md:col-span-5 lg:col-span-4">
          <div className="group relative aspect-[2/3] w-full overflow-hidden rounded-2xl bg-stone-900/5 shadow-2xl shadow-stone-900/30 dark:shadow-black/60 ring-1 ring-stone-900/10 dark:ring-stone-100/10 transition-transform duration-500 hover:scale-[1.02]">
            {book.cover_image_url ? (
              <img
                src={book.cover_image_url}
                alt={book.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-800 to-stone-900 text-stone-200 font-serif text-5xl font-bold tracking-widest">
                {coverText}
              </div>
            )}
            {/* Realistic Spine Depth Shadow */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/35 via-transparent to-transparent w-5" />
          </div>
        </div>

        {/* Editorial Book Information */}
        <div className="flex flex-col gap-6 md:col-span-7 lg:col-span-8">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-[var(--accent)]">
              Book Details
            </span>
            <h1 className="font-serif text-4xl md:text-5xl font-extrabold tracking-tight text-[var(--text)] mt-1 leading-[1.1]">
              {book.title}
            </h1>
            {book.subtitle && (
              <p className="mt-2 text-xl font-medium text-[var(--muted)] italic">
                {book.subtitle}
              </p>
            )}
          </div>

          {/* Metadata Divider Row */}
          <div className="flex flex-wrap items-center gap-4 border-y border-stone-800/10 dark:border-stone-200/10 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            <span>{book.published_year || "Year unknown"}</span>
            {book.page_count && <span>• {book.page_count} pages</span>}
            <span>
              • By{" "}
              {book.authors?.map((a) => a.name).join(", ") || "Unknown Author"}
            </span>
          </div>

          {/* Tag Badges */}
          {book.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {book.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)]/10 px-3 py-1 text-xs font-medium text-[var(--text)] border border-[var(--accent)]/20 shadow-xs"
                >
                  {tag.name}
                  <small className="text-[10px] text-[var(--muted)] uppercase">
                    {tag.type || "tag"}
                  </small>
                </span>
              ))}
            </div>
          )}

          {/* Book Synopsis */}
          {book.description && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
                Synopsis
              </h3>
              <p className="text-base leading-relaxed text-[var(--text)] opacity-90 font-sans">
                {book.description}
              </p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
