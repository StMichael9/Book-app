import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, BookOpen, Bookmark, Check, Search, X } from "lucide-react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { bookshopAffiliateUrl } from "../../api/affiliate.js";
import { useReader } from "./readerState.js";
import { authorLabel } from "./data.js";

export function Button({ children, variant = "primary", className = "", ...props }) {
  return <button type="button" className={`bv-button bv-button--${variant} ${className}`} {...props}>{children}</button>;
}

export function ActionLink({ children, to, variant = "primary", ...props }) {
  return <Link className={`bv-button bv-button--${variant}`} to={to} {...props}>{children}</Link>;
}

export function TextLink({ children, to, ...props }) {
  return <Link className="bv-text-link" to={to} {...props}>{children}</Link>;
}

export function EmptyState({ title, children, action, error = false, icon: Icon = Search }) {
  return <section className="bv-empty" aria-label={title}>
    <div className="bv-medallion"><Icon aria-hidden="true" /></div>
    <h2>{title}</h2>
    <div className="bv-muted" {...(error ? { role: "alert" } : {})}>{children}</div>
    {action && <div className="bv-empty-actions">{action}</div>}
  </section>;
}

export function BookCover({ book, priority = false }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const failed = failedUrl === book.cover_image_url;
  return <div className="bv-cover">
    {book.cover_image_url && !failed ? <img
      src={book.cover_image_url} alt={`Cover of ${book.title || "this book"}`}
      loading={priority ? "eager" : "lazy"} decoding="async" onError={() => setFailedUrl(book.cover_image_url)}
    /> : <div className="bv-cover-fallback" role="img" aria-label={`Cover unavailable for ${book.title || "this book"}`}>
      <BookOpen aria-hidden="true" /><strong>{book.title || "Untitled book"}</strong>
      <span>{authorLabel(book)}</span><small>Cover unavailable</small>
    </div>}
  </div>;
}

export function ShelfActions({ book, compact = false, hideError = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const library = useUserBooks();
  const reader = useReader();
  const status = library.booksById[book.id]?.status;
  const busy = reader.busyIds.includes(book.id);
  const blocked = auth.isLoading || (auth.isAuthenticated && (!reader.libraryReady || library.loading || Boolean(library.error)));
  const known = !blocked;
  const helperId = useId();
  async function saveToShelf(value) {
    const success = await reader.saveBook(book, value);
    const params = new URLSearchParams(location.search);
    if (success && location.pathname === `/book/${book.id}` && ["want", "owned"].includes(params.get("save"))) {
      params.delete("save");
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
  }
  return <div className={`bv-shelf-controls ${compact ? "bv-shelf-controls--compact" : ""}`}>
    <div className="bv-shelf-actions" role="group" aria-label={`Shelf for ${book.title}`}>
      {["want", "owned"].map((value) => {
        const selected = known && status === value;
        const Icon = selected ? Check : value === "want" ? Bookmark : BookOpen;
        return <Button key={value}
          variant={selected ? "saved" : compact || value === "owned" ? "secondary" : "primary"}
          disabled={busy || blocked} aria-pressed={Boolean(selected)} aria-describedby={helperId}
          aria-label={`${selected ? "Remove" : "Add"} ${book.title} ${selected ? "from" : "to"} ${value === "owned" ? "Own" : "Want"}`}
          onClick={() => saveToShelf(value)}>
          <Icon aria-hidden="true" />
          {busy ? "Saving…" : value === "want" ? selected ? "Wanted" : compact ? "Want" : "Want this" : selected ? "Owned" : compact ? "Own" : "I own this"}
        </Button>;
      })}
    </div>
    <span id={helperId} className={compact ? "bv-sr-only" : "bv-help"}>
      {busy ? "Updating your shelf…" : blocked ? "Checking your saved books before making changes." : status ?
        "Choose the other shelf to move this book. Select it again to remove it." : "Want it, or already own it? Choose a shelf for this book."}
    </span>
    {!hideError && reader.saveErrors[book.id] && <p className="bv-field-error" role="alert">{reader.saveErrors[book.id]}</p>}
  </div>;
}

export function BookCard({ book, priority, buyUrl }) {
  const location = useLocation();
  const state = { browseFrom: location.pathname === "/browse" ? location.pathname + location.search : "/browse" };
  return <article className="bv-book-card">
    <Link className="bv-book-link" to={`/book/${book.id}`} state={state} aria-label={`View ${book.title}`}><BookCover book={book} priority={priority} /></Link>
    <h3><Link to={`/book/${book.id}`} state={state}>{book.title || "Untitled book"}</Link></h3>
    <p className="bv-author">{authorLabel(book)}</p>
    <ShelfActions book={book} compact />
    {buyUrl && <a className="bv-buy-link" href={buyUrl} target="_blank" rel="noopener noreferrer sponsored">Find on Bookshop <ArrowRight aria-hidden="true" /></a>}
  </article>;
}

export function BookGrid({ books, bookshop = false }) {
  const hasAffiliate = bookshop && books.some((book) => bookshopAffiliateUrl(book));
  return <><div className="bv-book-grid">{books.map((book, index) => <BookCard key={book.id} book={book} priority={index < 5} buyUrl={bookshop ? bookshopAffiliateUrl(book) : null} />)}</div>
    {hasAffiliate && <p className="bv-help">Bookshop links are affiliate links. Bookvane may earn a commission if you purchase through them.</p>}</>;
}

export function BookSkeletons({ count = 5 }) {
  return <div role="status" aria-label="Loading books" aria-busy="true">
    <span className="bv-sr-only">Loading books…</span>
    <div className="bv-book-grid" aria-hidden="true">{Array.from({ length: count }, (_, index) => <div key={index}>
      <div className="bv-skeleton bv-skeleton--cover" /><div className="bv-skeleton bv-skeleton--title" />
      <div className="bv-skeleton bv-skeleton--author" /><div className="bv-skeleton bv-skeleton--action" />
    </div>)}</div>
  </div>;
}

export function PageHeading({ eyebrow, title, children }) {
  return <header className="bv-page-heading">{eyebrow && <p className="bv-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children && <div className="bv-muted">{children}</div>}</header>;
}

export function NativeDialog({ open, onClose, title, children, className = "" }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open) { if (dialog.open) dialog.close(); return undefined; }
    const trigger = document.activeElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previous;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);
  return <dialog ref={ref} className={`bv-dialog ${className}`} aria-labelledby={id}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
        .filter((element) => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (first && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <div className="bv-dialog-heading"><h2 id={id}>{title}</h2>
      <Button variant="quiet" className="bv-icon-button" aria-label={`Close ${title}`} onClick={onClose}><X aria-hidden="true" /></Button>
    </div>{children}
  </dialog>;
}

export function LibraryWarning() {
  const location = useLocation();
  const auth = useAuth();
  const library = useUserBooks();
  return location.pathname !== "/my-books" && auth.isAuthenticated && library.error ? <div className="bv-notice bv-notice--error">
    <AlertCircle aria-hidden="true" /><p role="alert">Your saved books couldn’t load. Try again before changing a shelf.</p>
    <Button variant="secondary" onClick={library.retryLoad}>Try again</Button>
  </div> : null;
}

export function SectionHeading({ title, children, to }) {
  return <div className="bv-section-heading"><div><h2>{title}</h2>{children && <p className="bv-muted">{children}</p>}</div>
    {to && <TextLink to={to}>Browse all <ArrowRight aria-hidden="true" /></TextLink>}
  </div>;
}
