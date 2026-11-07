import { Link } from "react-router-dom";
import { BookCover, Button } from "../../ui-v2/primitives.jsx";
import { coverBook } from "./homeLogic.js";

// The one book card on Home: Up next and Can't decide? share it. Left-aligned, no box, one Start button.
// On a phone the cards in Can't decide? become one compact row each (cover left, details and Start right).
export default function PickCard({ card, href, label, startText = "Start reading", onStart, pending, disabled, children }) {
  return <article className="bv-next-card">
    <div className="bv-next-cover"><BookCover book={coverBook(card)} /></div>
    <div className="bv-next-body">
      <h3>{href ? <Link to={href}>{card.title}</Link> : card.title}</h3>
      <p className="bv-author" title={card.authors.join(", ") || undefined}>{card.authors.join(", ") || "Author not listed"}</p>
      {(label ?? card.label) && <p className="bv-next-label">{label ?? card.label}</p>}
      <Button variant="secondary" disabled={disabled} aria-label={`Start reading ${card.title}`} onClick={() => onStart(card)}>{pending ? "Opening…" : startText}</Button>
      {children}
    </div>
  </article>;
}
