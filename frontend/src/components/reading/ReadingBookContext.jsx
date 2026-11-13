import { useId, useLayoutEffect, useRef, useState } from "react";
import { getBookById } from "../../api/books.js";
import { getBookDescription, getEntryDescription } from "../../api/descriptions.js";
import DescriptionBody from "../ui-v2/DescriptionBody.jsx";
import { useDescription } from "../ui-v2/useDescription.js";
import { Button, TextLink } from "../ui-v2/primitives.jsx";
import { formatYear, useRequest } from "../ui-v2/data.js";
import { useGenres } from "../ui-v2/useGenres.js";
import "../../styles/ui-v2/reading-workspace.css";

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
  return <><p ref={paragraph} id={id} className={`bv-private-text bv-description-full bv-reading-synopsis${!expanded ? " bv-reading-synopsis--short" : ""}`}>{text}</p>
    {(clipped || expanded) && <Button variant="quiet" className="bv-synopsis-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? "Show less" : "Show more"}</Button>}</>;
}

export function ReadingBookDetails({ bookId, description, entryId }) {
  const request = useRequest(() => getBookById(bookId), `book:${bookId}`, Boolean(bookId));
  const { labelFor } = useGenres();
  const genreLabels = (request.data?.tags || []).map(tag => labelFor(tag.name)).filter(Boolean).slice(0, 4);
  const answer = useDescription(() => bookId ? getBookDescription(bookId) : getEntryDescription(entryId), bookId ? `book:${bookId}` : `entry:${entryId}`, Boolean(bookId || entryId));
  // The server picks the source. Until it answers the page keeps what it has; a failed answer falls back to exactly that.
  const answered = answer.status === "ok", own = bookId ? request.data?.description : description;
  // Markdown stars are stripped from our own text; a Google description is shown exactly as it came.
  const raw = answered ? answer.data.text : own, text = answered && answer.data.source === "google" ? raw : raw?.replace(/\*/g, ""), google = answered && answer.data.source === "google" && Boolean(text);
  // A private book shows its description when there is one, and nothing at all otherwise.
  if (!bookId && !text) return null;
  const shown = google ? <DescriptionBody text={text} link={answer.data.link} /> : text ? <Synopsis text={text} /> : answer.status === "error" && bookId ? <p className="bv-muted">A description isn’t available for this book yet.</p> : null;
  return <section className="bv-workspace-about" aria-label="About this book">
    {!bookId ? shown
      : request.loading ? <p role="status" className="bv-muted">Loading book details…</p>
      : request.error ? <div><p className="bv-muted">The synopsis couldn’t load. Your reading is still available.</p><Button variant="quiet" onClick={request.retry}>Try book details again</Button></div>
      : <>
        {genreLabels.length > 0 && <p className="bv-book-subjects">{genreLabels.join(" · ")}</p>}
        {(request.data.published_year != null || request.data.page_count > 0) && <p className="bv-help">
          {request.data.published_year != null && `Published ${formatYear(request.data.published_year)}`}{request.data.published_year != null && request.data.page_count > 0 && " · "}{request.data.page_count > 0 && `About ${request.data.page_count} pages · your copy may differ`}
        </p>}
        {shown}
      </>}
    {bookId && <TextLink to={`/book/${bookId}`}>Full book details</TextLink>}
  </section>;
}
