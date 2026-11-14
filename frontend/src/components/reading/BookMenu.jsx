import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, Ellipsis } from "lucide-react";
import AddToList from "../profile/AddToList.jsx";
import PinToUpNext from "./home/PinToUpNext.jsx";
import "../../styles/ui-v2/library.css";

// The "more" button on a book in My Books, with its two actions: Add to list and Pin to Up next. Both are the book page's own
// controls (same components, same calls); the menu only gives them a place on the card. The button is a sibling of the cover's
// link, never inside it, so using it never opens the book.
// With `shelf` (the book page) the menu also holds the Want to read and I own it toggles; without a catalogue book it has only those.
export default function BookMenu({ bookId, title, shelf, className = "" }) {
  const [open, setOpen] = useState(false), [view, setView] = useState("items"), [status, setStatus] = useState("");
  const root = useRef(null), button = useRef(null), menu = useRef(null), listPanel = useRef(null);
  const id = useId();
  const close = useCallback((refocus = true) => {
    setOpen(false); setView("items"); setStatus("");
    if (refocus) button.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const away = event => { if (!root.current?.contains(event.target)) close(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, close]);
  // The menu is as wide as it needs and stays on screen, wherever the card sits in the grid.
  useLayoutEffect(() => {
    const node = menu.current;
    if (!open || !node) return;
    const anchor = root.current.getBoundingClientRect(), width = node.offsetWidth;
    node.style.left = `${Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16)) - anchor.left}px`;
  }, [open, view]);
  useEffect(() => {
    if (!open) return;
    if (view === "lists") listPanel.current?.focus({ preventScroll: true });
    else menu.current?.querySelector('[role^="menuitem"]')?.focus({ preventScroll: true });
  }, [open, view]);
  const items = () => [...(menu.current?.querySelectorAll('[role^="menuitem"]') || [])];
  function onKeyDown(event) {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (view !== "items") return;
    const list = items(), index = list.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); list[(index + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus(); }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); list[event.key === "Home" ? 0 : list.length - 1]?.focus(); }
    else if (event.key === "Tab") close(false);
  }
  const label = `More actions for ${title}`;
  return <div className={`bv-more${open ? " is-open" : ""}${className ? ` ${className}` : ""}`} ref={root} onKeyDown={onKeyDown}
    onBlur={event => { if (open && event.relatedTarget && !root.current?.contains(event.relatedTarget)) close(false); }}>
    <button ref={button} type="button" className="bv-more-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? close() : setOpen(true)}
      onKeyDown={event => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); } }}>
      <span className="bv-more-dot"><Ellipsis aria-hidden="true" /></span>
    </button>
    {open && <div id={id} ref={menu} className="bv-more-menu" role="menu" aria-label={label}>
      {view === "items" ? <>
        {shelf && [["is_wanted", "Want to read"], ["is_owned", "I own it"]].map(([flag, text]) => <button key={flag} type="button" role="menuitemcheckbox" aria-checked={Boolean(shelf.entry[flag])} className="bv-more-item" disabled={shelf.disabled} onClick={() => shelf.onToggle(flag)}>{shelf.entry[flag] ? <Check aria-hidden="true" /> : <span className="bv-more-blank" aria-hidden="true" />}{text}</button>)}
        {bookId && <button type="button" role="menuitem" className="bv-more-item" onClick={() => setView("lists")}>Add to list</button>}
        {bookId && <PinToUpNext bookId={bookId} menuItem onChange={setStatus} />}
      </> : <div ref={listPanel} tabIndex={-1} className="bv-more-lists">
        <AddToList book={{ id: bookId, title }} menu onChange={setStatus} onClose={close} />
      </div>}
      <p className="bv-more-status bv-help" role="status">{status}</p>
    </div>}
  </div>;
}
