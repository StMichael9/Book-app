import { useEffect, useState } from "react";
import { BookCover } from "./primitives.jsx";
import { authorLabel } from "./data.js";

// A card for a book that isn't in the catalogue yet. It looks and reads like any other card; picking it makes the book real
// and opens its page (the parent does that), so while it waits the card is busy and cannot be picked again.
export default function WorkCard({ book, busy, error, onOpen, priority = false }) {
  const shown = { ...book, authors: (book.authors || []).map(author => typeof author === "string" ? { name: author } : author) };
  const open = () => { if (!busy) onOpen(book); };
  // Making the book real can take a few seconds; after 2 s the card says so, so the wait never looks broken.
  const [slow, setSlow] = useState(false);
  if (!busy && slow) setSlow(false);
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setTimeout(() => setSlow(true), 2000);
    return () => clearTimeout(timer);
  }, [busy]);
  return <article className="bv-book-card bv-work-card" aria-busy={busy ? "true" : undefined}>
    <button type="button" className="bv-book-link bv-work-cover" tabIndex={-1} aria-label={`View ${book.title}`} disabled={busy} onClick={open}><BookCover book={shown} priority={priority} /></button>
    <h3><button type="button" className="bv-work-title" disabled={busy} onClick={open}>{book.title || "Untitled book"}</button></h3>
    <p className="bv-author">{authorLabel(shown)}</p>
    {busy && slow && <p className="bv-muted" role="status">Opening…</p>}
    {error && <p className="bv-field-error" role="status">{error}</p>}
  </article>;
}
