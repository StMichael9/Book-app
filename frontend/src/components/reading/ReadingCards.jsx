import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ActionLink, BookCover, ShelfActions, TextLink } from "../ui-v2/primitives.jsx";
import { authorLabel } from "../ui-v2/data.js";
import "../../styles/ui-v2/reading-home.css";

const readingLabels = { reading: "Reading", paused: "Paused", finished: "Finished", dnf: "Stopped" };
const entryBook = entry => entry.book || { title: entry.private_title, authors: entry.private_author ? [{ name: entry.private_author }] : [] };

export function SlowReadingNotice({ loading }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) return undefined;
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => { clearTimeout(timer); setSlow(false); };
  }, [loading]);
  return loading && slow ? <p className="bv-notice" role="status">This is taking longer than usual. Your saved books haven’t changed. You can keep this page open or return to it later.</p> : null;
}

export function CurrentReadingCard({ entry, attempt }) {
  const book = entryBook(entry);
  const progress = attempt.progress_value == null ? null : attempt.progress_unit === "percent"
    ? `${attempt.progress_value}%` : `Page ${attempt.progress_value}${attempt.total_pages ? ` of ${attempt.total_pages}` : ""}`;
  const progressMax = attempt.progress_unit === "percent" ? 100 : attempt.total_pages;
  return <article className="bv-current-book">
    <Link to={`/my-books/${entry.id}`} tabIndex={-1} aria-hidden="true"><BookCover book={book} priority /></Link>
    <div><p className="bv-eyebrow">Reading{!entry.book ? " · Private book" : ""}</p>
      <h3><Link to={`/my-books/${entry.id}`}>{book.title}</Link></h3>
      <p className="bv-author">{authorLabel(book)}</p>
      {progress && <p className="bv-reading-progress">{progress}</p>}
      {progress && progressMax > 0 && attempt.progress_value >= 0 && attempt.progress_value <= progressMax && <progress className="bv-reading-meter" value={attempt.progress_value} max={progressMax} aria-label={`Reading progress for ${book.title}`} />}
      <ActionLink to={`/my-books/${entry.id}`} aria-label={`Continue your reading: ${book.title}`}>Continue reading</ActionLink>
    </div>
  </article>;
}

export function LibraryEntryCard({ entry, priority, readingActions, buyUrl }) {
  const book = entryBook(entry);
  const destination = readingActions ? `/my-books/${entry.id}` : entry.book ? `/book/${entry.book.id}` : null;
  return <article className="bv-book-card bv-personal-book">
    {destination ? <Link className="bv-book-link" to={destination} aria-label={`Open ${book.title}`}><BookCover book={book} priority={priority} /></Link> : <BookCover book={book} priority={priority} />}
    <div className="bv-personal-book-state">{readingLabels[entry.reading_state] && <span>{readingLabels[entry.reading_state]}</span>}{!entry.book && <span>Private book</span>}</div>
    <h3>{destination ? <Link to={destination}>{book.title}</Link> : book.title}</h3>
    <p className="bv-author">{authorLabel(book)}</p>
    {entry.book ? <ShelfActions book={book} compact /> : <p className="bv-help">{[entry.is_owned && "Owned", entry.is_wanted && "Wanted"].filter(Boolean).join(" · ") || "Only in your library"}</p>}
    {readingActions && <TextLink to={`/my-books/${entry.id}`} aria-label={`Open your reading: ${book.title}`}>Open your reading</TextLink>}
    {entry.book && readingActions && <TextLink className="bv-catalogue-link" to={`/book/${entry.book.id}`} aria-label={`About this book: ${book.title}`}>About this book</TextLink>}
    {buyUrl && <a className="bv-buy-link" href={buyUrl} target="_blank" rel="noopener noreferrer sponsored">Find on Bookshop ↗</a>}
  </article>;
}
