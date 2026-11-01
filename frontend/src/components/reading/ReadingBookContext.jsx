import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { getBookById } from "../../api/books.js";
import { updateLibraryEntry } from "../../api/reading.js";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { BookCover, Button, EnglishTitle, TextLink } from "../ui-v2/primitives.jsx";
import { authorLabel, formatYear, subjectLabel, useRequest } from "../ui-v2/data.js";
import "../../styles/ui-v2/reading-workspace.css";

export function ReadingBookIdentity({ entry, flags, headingRef }) {
  const book = entry.book || { title: entry.private_title, cover_image_url: entry.private_catalogue?.cover_image_url, authors: entry.private_author ? [{ name: entry.private_author }] : [] };
  return <article className="bv-workspace-book" aria-labelledby="bv-reading-book-title">
    <div className="bv-workspace-cover"><BookCover book={book} priority /></div>
    <div className="bv-workspace-identity">
      <h1 id="bv-reading-book-title" tabIndex={-1} ref={headingRef}>{book.title}</h1><EnglishTitle book={book} /><p className="bv-detail-author">{authorLabel(book)}</p>
      {!entry.book && <p className="bv-help">Private book, only in your library.</p>}
      {flags}
    </div>
  </article>;
}

function Synopsis({ text }) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const paragraph = useRef(null);
  const id = useId();
  // The synopsis starts at two lines; offer Show more only when the clamp actually hides text.
  // ResizeObserver reports once on observe, then on every width change.
  useLayoutEffect(() => {
    const node = paragraph.current;
    if (!node || expanded) return undefined;
    const observer = new ResizeObserver(() => setClipped(node.scrollHeight > node.clientHeight + 1));
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, expanded]);
  return <><p ref={paragraph} id={id} className={`bv-private-text bv-reading-synopsis${!expanded ? " bv-reading-synopsis--short" : ""}`}>{text}</p>
    {(clipped || expanded) && <Button variant="quiet" className="bv-synopsis-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? "Show less" : "Show more"}</Button>}</>;
}

// A private book has no catalogue description, so the reader can write their own.
function PrivateDescription({ entry }) {
  const library = useUserBooks(), command = useReadingCommand();
  const [editing, setEditing] = useState(false), [text, setText] = useState("");
  const field = useRef(null), trigger = useRef(null);
  const description = entry.private_description;
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);
  function close() { setEditing(false); requestAnimationFrame(() => trigger.current?.focus()); }
  function submit(event) {
    event.preventDefault();
    command.run(() => updateLibraryEntry(entry.id, { expected_version: entry.version, private_description: text.trim() || null }), updated => { library.readingChanged(updated); close(); });
  }
  if (editing) return <form className="bv-field bv-reading-form" onSubmit={submit} aria-busy={command.pending}>
    <label htmlFor="bv-private-description">Description</label>
    <textarea id="bv-private-description" ref={field} rows={5} maxLength={2000} value={text} onChange={event => setText(event.target.value)} />
    <small className="bv-editor-caption">Private to you · {text.length} / 2000</small>
    {command.error && <div role="alert" className="bv-notice"><p>{command.error} Your text is still here.</p></div>}
    <div className="bv-form-actions"><Button type="submit" disabled={command.pending}>{command.pending ? "Saving…" : "Save description"}</Button><Button variant="quiet" disabled={command.pending} onClick={close}>Cancel</Button></div>
  </form>;
  return <>{description && <Synopsis text={description} />}
    {!library.readOnly && <Button ref={trigger} variant="quiet" onClick={() => { setText(description || ""); setEditing(true); }}>{description ? "Edit description" : "Add a description"}</Button>}</>;
}

export function ReadingBookDetails({ bookId, description, entry }) {
  const request = useRequest(() => getBookById(bookId), `book:${bookId}`, Boolean(bookId));
  return <section className="bv-workspace-about" aria-labelledby="bv-reading-about-title">
    <h3 id="bv-reading-about-title">About this book</h3>
    {!bookId ? (entry ? <PrivateDescription key={entry.id} entry={entry} /> : description ? <Synopsis text={description} /> : null)
      : request.loading ? <p role="status" className="bv-muted">Loading book details…</p>
      : request.error ? <div><p className="bv-muted">The synopsis couldn’t load. Your reading is still available.</p><Button variant="quiet" onClick={request.retry}>Try book details again</Button></div>
      : <>
        {request.data.tags?.length > 0 && <p className="bv-book-subjects">{request.data.tags.slice(0, 4).map(tag => subjectLabel(tag.name)).join(" · ")}</p>}
        {(request.data.published_year != null || request.data.page_count > 0) && <p className="bv-help">
          {request.data.published_year != null && `Published ${formatYear(request.data.published_year)}`}{request.data.published_year != null && request.data.page_count > 0 && " · "}{request.data.page_count > 0 && `About ${request.data.page_count} pages · your copy may differ`}
        </p>}
        {request.data.description ? <Synopsis text={request.data.description} /> : <p className="bv-muted">A description isn’t available for this book yet.</p>}
      </>}
    {bookId && <TextLink to={`/book/${bookId}`}>Full book details</TextLink>}
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
