import { useEffect, useRef, useState } from "react";
import { createLoan, updateLoan } from "../../api/loans.js";
import { BookCover, Button, NativeDialog } from "../ui-v2/primitives.jsx";
import { errorText } from "../ui-v2/data.js";
import "../../styles/ui-v2/lending.css";

const COPY = {
  lent: { title: "Lend this book", who: "Who’s borrowing it?", due: "Due back (optional)", save: "Lend" },
  borrowed: { title: "I borrowed this", who: "Who lent it to you?", due: "Give back by (optional)", save: "Save" },
};

function BookLine({ book }) {
  return <div className="bv-loan-book"><div className="bv-loan-book-cover"><BookCover book={{ title: book.title, cover_image_url: book.cover_image_url, authors: book.authors || [] }} size="small" decorative /></div>
    <p className="bv-muted">{book.title}</p></div>;
}

// Lend, Borrow and Edit share one form. The request id is made when the sheet opens, so a retry sends the same one.
export function LoanSheet({ mode, loan, book, entryId, bookId, onClose, onSaved, onShare }) {
  const direction = loan?.direction || mode, copy = COPY[direction];
  const [name, setName] = useState(loan?.person_name || ""), [due, setDue] = useState(loan?.due_on || "");
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(null);
  const requestId = useRef(crypto.randomUUID()), nameField = useRef(null);
  // The dialog opens on its close button; the first field is where a reader starts.
  useEffect(() => { nameField.current?.focus(); }, []);
  const editing = Boolean(loan), title = editing ? "Edit" : copy.title;
  async function submit(event) {
    event.preventDefault();
    const person = name.trim();
    if (!person || pending) return;
    setPending(true); setError("");
    try {
      if (editing) {
        const body = {};
        if (person !== loan.person_name) body.person_name = person;
        if ((due || null) !== (loan.due_on || null)) body.due_on = due || null;
        if (Object.keys(body).length) await updateLoan(loan.id, body);
        await onSaved(); onClose();
        return;
      }
      const created = await createLoan({ request_id: requestId.current, direction, person_name: person, ...(due ? { due_on: due } : {}),
        ...(entryId ? { entry_id: entryId } : { book_id: bookId }) });
      await onSaved(created);
      if (direction === "lent") setSaved(created); else onClose();
    } catch (failure) { setError(errorText(failure, "Please try again.")); } finally { setPending(false); }
  }
  if (saved) return <NativeDialog open onClose={onClose} title={title} className="bv-lend-sheet">
    <BookLine book={book} />
    <div className="bv-loan-after"><p className="bv-loan-name">Lent to {saved.person_name}</p><p className="bv-muted">Want {saved.person_name} to have a link to it?</p>
      <div className="bv-loan-actions"><Button onClick={() => { onClose(); onShare(saved, "send"); }}>Send {saved.person_name} a link</Button><Button variant="quiet" onClick={onClose}>Not now</Button></div></div>
  </NativeDialog>;
  return <NativeDialog open onClose={() => { if (!pending) onClose(); }} title={title} className="bv-lend-sheet">
    <BookLine book={book} />
    <form onSubmit={submit} noValidate>
      <div className="bv-field"><label htmlFor="bv-loan-name">{copy.who}</label>
        <input id="bv-loan-name" value={name} maxLength={80} autoComplete="off" ref={nameField} onChange={event => setName(event.target.value)} aria-describedby={direction === "lent" ? "bv-loan-private" : undefined} /></div>
      <div className="bv-field"><label htmlFor="bv-loan-due">{copy.due}</label><input id="bv-loan-due" type="date" value={due} onChange={event => setDue(event.target.value)} /></div>
      {direction === "lent" && <p id="bv-loan-private" className="bv-help">Only you can see this name.</p>}
      {error && <p role="alert" className="bv-field-error">{error}</p>}
      <div className="bv-dialog-actions bv-loan-foot"><Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending || !name.trim()}>{editing ? "Save" : copy.save}</Button></div>
    </form>
  </NativeDialog>;
}

// Without Web Share the message is shown to copy.
export function MessageSheet({ title, text, onClose }) {
  const [copied, setCopied] = useState(false), field = useRef(null);
  async function copy() {
    try { await navigator.clipboard.writeText(text); } catch { field.current?.select(); document.execCommand?.("copy"); }
    setCopied(true);
  }
  return <NativeDialog open onClose={onClose} title={title} className="bv-lend-sheet">
    <div className="bv-field"><textarea ref={field} className="bv-loan-message" readOnly rows={5} value={text} aria-label={title} onFocus={event => event.currentTarget.select()} /></div>
    <div className="bv-dialog-actions bv-loan-foot"><Button onClick={copy}>{copied ? "Copied" : "Copy message"}</Button></div>
    <p className="bv-sr-only" role="status">{copied ? "Copied" : ""}</p>
  </NativeDialog>;
}
