import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ActionLink, BookCover, EnglishTitle, ShelfActions } from "../ui-v2/primitives.jsx";
import { authorLabel } from "../ui-v2/data.js";
import "../../styles/ui-v2/reading-home.css";

const readingLabels = { reading: "Reading", paused: "Paused", finished: "Finished", dnf: "Stopped" };
const entryBook = entry => entry.book || { title: entry.private_title, cover_image_url: entry.private_catalogue?.cover_image_url, authors: entry.private_author ? [{ name: entry.private_author }] : [] };

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
    <Link to={`/my-books/${entry.id}`} state={{ entry }} tabIndex={-1} aria-hidden="true"><BookCover book={book} priority /></Link>
    <div><p className="bv-reading-state">Reading{!entry.book ? " · Private book" : ""}</p>
      <h3><Link to={`/my-books/${entry.id}`} state={{ entry }}>{book.title}</Link></h3>
      <p className="bv-author">{authorLabel(book)}</p>
      {progress && <p className="bv-reading-progress">{progress}</p>}
      {progress && progressMax > 0 && attempt.progress_value >= 0 && attempt.progress_value <= progressMax && <progress className="bv-reading-meter" value={attempt.progress_value} max={progressMax} aria-label={`Reading progress for ${book.title}`} />}
      <ActionLink to={`/my-books/${entry.id}`} state={{ entry }} aria-label={`Continue your reading: ${book.title}`}>Continue reading</ActionLink>
    </div>
  </article>;
}

// Plain text wraps between words, so a separator never starts a line on narrow cards.
function StatusLine({ labels }) {
  const [lead = "Saved", ...rest] = labels;
  return <p className="bv-personal-book-state"><strong>{lead}</strong>{rest.length > 0 && <span>{` · ${rest.join(" · ")}`}</span>}</p>;
}

export function LibraryEntryCard({ entry, priority, readingActions, buyUrl, navigationState, onOpen }) {
  const book = entryBook(entry);
  const destination = readingActions ? `/my-books/${entry.id}` : entry.book ? `/book/${entry.book.id}` : null;
  // The entry travels with the click, so the workspace can draw the book's identity before its own request returns.
  navigationState = readingActions ? { ...navigationState, entry } : navigationState;
  return <article className="bv-book-card bv-personal-book">
    {destination ? <Link className="bv-book-link" to={destination} state={navigationState} onClick={onOpen} tabIndex={-1} aria-label={`Open ${book.title}`}><BookCover book={book} priority={priority} /></Link> : <BookCover book={book} priority={priority} />}
    <h3>{destination ? <Link to={destination} state={navigationState} onClick={onOpen}>{book.title}</Link> : book.title}</h3>
    <EnglishTitle book={book} />
    <p className="bv-author">{authorLabel(book)}</p>
    {/* One status line on every card: the reading state leads, then the independent shelves. */}
    {entry.book && !readingActions ? <ShelfActions book={book} compact /> : <StatusLine labels={[readingLabels[entry.reading_state], entry.is_wanted && "Want to read", entry.is_owned && "Owned", !entry.book && "Private book"].filter(Boolean)} />}
    {buyUrl && <a className="bv-buy-link" href={buyUrl} target="_blank" rel="noopener noreferrer sponsored">Find on Bookshop ↗</a>}
  </article>;
}
