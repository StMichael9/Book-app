import { useId, useState } from "react";
import { getBookById } from "../../api/books.js";
import { BookCover, Button, TextLink } from "../ui-v2/primitives.jsx";
import { authorLabel, subjectLabel, useRequest } from "../ui-v2/data.js";
import "../../styles/ui-v2/reading-workspace.css";

export function ReadingBookIdentity({ entry, flags, headingRef }) {
  const book = entry.book || { title: entry.private_title, cover_image_url: entry.private_catalogue?.cover_image_url, authors: entry.private_author ? [{ name: entry.private_author }] : [] };
  return <article className="bv-workspace-book" aria-labelledby="bv-reading-book-title">
    <div className="bv-workspace-cover"><BookCover book={book} priority /></div>
    <div className="bv-workspace-identity"><p className="bv-eyebrow">{entry.book ? "Your book, your reading" : "Private book · only you"}</p>
      <h1 id="bv-reading-book-title" tabIndex={-1} ref={headingRef}>{book.title}</h1><p className="bv-detail-author">{authorLabel(book)}</p>
      {!entry.book && <p className="bv-help">Only in your library. No description or edition details have been confirmed.</p>}
      {flags}
    </div>
  </article>;
}

function Synopsis({ text }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId(), expandable = text.length > 240;
  return <><p id={id} className={`bv-private-text bv-reading-synopsis${expandable && !expanded ? " bv-reading-synopsis--short" : ""}`}>{text}</p>
    {expandable && <Button variant="quiet" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? "Show less" : "Show more"}</Button>}</>;
}

export function ReadingBookDetails({ bookId }) {
  const request = useRequest(() => getBookById(bookId), `reading-book-details:${bookId}`, Boolean(bookId));
  return <section className="bv-workspace-about" aria-labelledby="bv-reading-about-title">
    <h2 id="bv-reading-about-title">About this book</h2>
    {!bookId ? <p className="bv-muted">No description is available for this private book. You can still keep your reading and memories here.</p>
      : request.loading ? <p role="status" className="bv-muted">Loading book details…</p>
      : request.error ? <div><p className="bv-muted">The synopsis couldn’t load. Your reading is still available.</p><Button variant="quiet" onClick={request.retry}>Try book details again</Button></div>
      : <>
        {request.data.tags?.length > 0 && <div className="bv-book-tags">{request.data.tags.slice(0, 4).map(tag => <span key={tag.id}>{subjectLabel(tag.name)}</span>)}</div>}
        {(request.data.published_year != null || request.data.page_count > 0) && <p className="bv-help">
          {request.data.published_year != null && `Published ${request.data.published_year}`}{request.data.published_year != null && request.data.page_count > 0 && " · "}{request.data.page_count > 0 && `Catalogue: ${request.data.page_count} pages · your copy may differ`}
        </p>}
        {request.data.description ? <Synopsis text={request.data.description} /> : <p className="bv-muted">A description isn’t available for this book yet.</p>}
      </>}
    {bookId && <TextLink to={`/book/${bookId}`}>Full catalogue details</TextLink>}
  </section>;
}

export function ReadingProgress({ attempt, children, statusRef, readOnly }) {
  const label = { reading: "Reading", paused: "Paused", finished: "Finished", dnf: "Stopped" }[attempt?.state] || "Not started";
  const value = attempt?.progress_value;
  const maximum = attempt?.progress_unit === "percent" ? 100 : attempt?.total_pages;
  const validProgress = value != null && maximum > 0 && value >= 0 && value <= maximum;
  const text = value == null ? "Not tracking progress" : attempt.progress_unit === "percent" ? `${value}%` : `Page ${value}${attempt.total_pages ? ` of ${attempt.total_pages}` : ""}`;
  const terminal = ["finished", "dnf"].includes(attempt?.state);
  return <section className="bv-workspace-progress" aria-label="My reading">
    <div className="bv-workspace-progress-heading"><h2>My reading</h2><h3 ref={statusRef} tabIndex={-1} className="bv-reading-state-pill">{label}</h3></div>
    {readOnly && <p role="status" className="bv-notice">Your reading is available to read. Changes are temporarily paused.</p>}
    <div className="bv-workspace-progress-value"><p>{terminal && value != null ? `Last recorded: ${text}` : text}</p>{validProgress && attempt.progress_unit !== "percent" && <strong>{Math.round(value / maximum * 100)}%</strong>}</div>
    {validProgress && <progress value={value} max={maximum} aria-label="Reading progress" aria-valuetext={text} />}
    {children}
    {attempt && <p className="bv-workspace-dates">{attempt.started_on ? `Started ${attempt.started_on}` : "Start date unknown"}{attempt.ended_on ? ` · Ended ${attempt.ended_on}` : ""}</p>}
  </section>;
}
