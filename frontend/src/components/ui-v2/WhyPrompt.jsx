import { useEffect, useId, useRef, useState } from "react";
import { updateLibraryEntry } from "../../api/reading.js";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { useReader } from "./readerState.js";
import { Button } from "./primitives.jsx";

// Offered once, right after a book is saved as Want to read. It never blocks or undoes the save.
export default function WhyPrompt({ bookId, entry, onClose }) {
  const library = useUserBooks();
  const reader = useReader();
  const [text, setText] = useState(""), [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const field = useRef(null);
  const id = useId();
  useEffect(() => { field.current?.focus(); }, []);
  async function submit(event) {
    event.preventDefault();
    if (!text.trim() || pending) return;
    setPending(true); setFailed(false);
    try {
      // The version moves when the save lands; use the newest one this page knows.
      await updateLibraryEntry(entry.id, { expected_version: library.booksById[bookId]?.version ?? entry.version, save_note: text.trim() });
      reader.announce("Save reason saved.");
      onClose();
    } catch { setFailed(true); setPending(false); }
  }
  return <form className="bv-why" onSubmit={submit} aria-busy={pending} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <label htmlFor={id}>Why this one? (only you see this)</label>
    <textarea id={id} ref={field} rows={3} maxLength={500} value={text} aria-describedby={`${id}-count`} onChange={event => setText(event.target.value)} />
    <small id={`${id}-count`} className="bv-editor-caption">Private to you · {text.length} / 500</small>
    {failed && <p className="bv-field-error" role="alert">We couldn’t save that. Try again.</p>}
    <div className="bv-form-actions"><Button type="submit" disabled={pending || !text.trim()}>{pending ? "Saving…" : "Save"}</Button><Button variant="quiet" disabled={pending} onClick={onClose}>Skip</Button></div>
  </form>;
}
