import { useEffect, useId, useRef, useState } from "react";
import { ListPlus } from "lucide-react";
import { addListBook, createList, getLists, removeListBook } from "../../api/profile.js";
import { Button } from "../ui-v2/primitives.jsx";

const limitText = code => code === "list_limit";

// Which of the reader's lists a catalogue book is on, with a check for each; toggling adds or removes it at once.
export default function AddToList({ book }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ lists: null, error: false });
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState(""), [creating, setCreating] = useState(false), [name, setName] = useState("");
  const trigger = useRef(null);
  const panel = useId();
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    getLists(book.id).then(lists => { if (active) setState({ lists, error: false }); }, () => { if (active) setState({ lists: null, error: true }); });
    return () => { active = false; };
  }, [open, attempt, book.id]);
  const wrapper = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (wrapper.current && !wrapper.current.contains(event.target)) { setOpen(false); setCreating(false); setMessage(""); trigger.current?.focus({ preventScroll: true }); } };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const lists = state.lists;
  const update = (id, has_book) => setState(current => ({ ...current, lists: current.lists.map(item => item.id === id ? { ...item, has_book, book_count: item.book_count + (has_book ? 1 : -1) } : item) }));
  async function toggle(item) {
    const adding = !item.has_book;
    setMessage(""); update(item.id, adding);
    try { await (adding ? addListBook(item.id, book.id) : removeListBook(item.id, book.id)); } catch (error) {
      update(item.id, !adding);
      setMessage(limitText(error?.detail?.code) ? "This list is full (500 books)." : "We couldn’t change that list. Please try again.");
    }
  }
  async function create(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setMessage("");
    try {
      const created = await createList(name.trim());
      await addListBook(created.id, book.id);
      setState(current => ({ ...current, lists: [...(current.lists || []), { ...created, has_book: true, book_count: 1, covers: [] }] }));
      setName(""); setCreating(false);
    } catch (error) { setMessage(limitText(error?.detail?.code) ? "You’ve reached 50 lists." : "We couldn’t make that list. Please try again."); }
  }
  function close() { setOpen(false); setCreating(false); setMessage(""); trigger.current?.focus(); }
  return <div className="bv-add-list" ref={wrapper} onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); close(); } }}>
    <Button ref={trigger} variant="quiet" aria-expanded={open} aria-controls={open ? panel : undefined} onClick={() => open ? close() : setOpen(true)}><ListPlus aria-hidden="true" />Add to list</Button>
    {open && <div id={panel} className="bv-add-list-panel" role="group" aria-label={`Add ${book.title} to a list`}>
      {state.error ? <p role="alert">We couldn’t load your lists. <Button variant="quiet" onClick={() => { setState({ lists: null, error: false }); setAttempt(value => value + 1); }}>Try again</Button></p>
        : !lists ? <p role="status" className="bv-muted">Loading your lists…</p>
        : <>{lists.length > 0 && <ul>{lists.map(item => <li key={item.id}><label><input type="checkbox" checked={Boolean(item.has_book)} onChange={() => toggle(item)} /><span>{item.name}</span></label></li>)}</ul>}
          {creating ? <form onSubmit={create}><div className="bv-field"><label htmlFor={`${panel}-name`}>List name</label><input id={`${panel}-name`} value={name} maxLength={80} autoFocus onChange={event => setName(event.target.value)} /></div>
            <div className="bv-form-actions"><Button type="submit" disabled={!name.trim()}>Create and add</Button><Button variant="quiet" onClick={() => { setCreating(false); setName(""); }}>Cancel</Button></div></form>
            : <Button variant="quiet" onClick={() => setCreating(true)}>New list…</Button>}</>}
      {message && <p className="bv-field-error" role="alert">{message}</p>}
    </div>}
  </div>;
}
