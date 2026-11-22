import { useEffect, useId, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";

// A small "…" menu: a button that opens a list of actions. Escape and a click elsewhere close it; the arrow keys move between items.
// items: [{ label, onSelect, danger? }]. With no items it draws nothing.
export default function ClubMenu({ label, items, className = "" }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null), button = useRef(null), menu = useRef(null), id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const away = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    menu.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  if (!items.length) return null;
  const close = () => { setOpen(false); button.current?.focus(); };
  function onKeyDown(event) {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    const list = [...menu.current.querySelectorAll('[role="menuitem"]')], index = list.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); list[(index + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus(); }
    else if (event.key === "Tab") setOpen(false);
  }
  return <div className={`bv-club-menu${className ? ` ${className}` : ""}`} ref={root} onKeyDown={onKeyDown}>
    <button ref={button} type="button" className="bv-club-menu-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}><Ellipsis aria-hidden="true" /></button>
    {open && <div className="bv-club-menu-list" role="menu" id={id} ref={menu}>
      {items.map(item => <button key={item.label} type="button" role="menuitem" className={item.danger ? "is-danger" : undefined} onClick={() => { setOpen(false); item.onSelect(); }}>{item.label}</button>)}
    </div>}
  </div>;
}
