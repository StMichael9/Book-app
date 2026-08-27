import { useState } from "react";
import { Link } from "react-router-dom";

export default function BookCard({ book }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = (book.title || "BK")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("");

  return (
    <article className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-stone-800/10 dark:border-stone-200/10 bg-[var(--surface)] transition-all duration-300 ease-out hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-stone-900/10 dark:hover:shadow-black/40">
      {/* Cover Image Container */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-stone-900/5 dark:bg-stone-100/5">
        {book.cover_image_url && !imageFailed ? (
          <img
            src={book.cover_image_url}
            alt={book.title}
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-800 to-stone-900 text-stone-200 font-serif text-3xl font-bold tracking-widest">
            {initials}
          </div>
        )}

        {/* Spine Shadow Overlay (Fakes physical book depth) */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/25 via-transparent to-transparent w-4" />
      </div>

      {/* Book Information */}
      <div className="flex flex-1 flex-col justify-between p-5">
        <div>
          <div className="flex items-center justify-between text-xs font-semibold tracking-wider text-[var(--muted)] uppercase mb-1.5">
            <span>{book.published_year || "Unknown"}</span>
            {book.page_count && <span>{book.page_count}p</span>}
          </div>

          <Link to={`/book/${book.id}`} className="group/title">
            <h3 className="font-serif text-xl font-bold leading-snug tracking-tight text-[var(--text)] transition-colors group-hover/title:text-[var(--accent)]">
              {book.title}
            </h3>
          </Link>

          <p className="mt-1 text-sm text-[var(--muted)] font-medium">
            {book.authors?.map((a) => a.name).join(", ") || "Unknown Author"}
          </p>
        </div>

        {/* Tags */}
        {book.tags?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {book.tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center rounded-full bg-[var(--accent)]/10 px-2.5 py-0.5 text-xs font-medium text-[var(--text)] border border-[var(--accent)]/20"
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
