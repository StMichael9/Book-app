import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { addCheckpoint, addClubBook, createClub, createInvite, deleteCheckpoint, revokeInvite, updateClub, updateClubBook } from "../../api/clubs.js";
import { getBookSuggestions } from "../../api/suggest.js";
import { Button, NativeDialog } from "../ui-v2/primitives.jsx";
import { CLUB_COLORS, clubColor, codeOf, positionLabel, shortDate } from "./clubFormat.js";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";

// Start a club, or edit one: the same three fields.
export function ClubFormSheet({ open, onClose, club, onSaved }) {
  const editing = Boolean(club);
  const [name, setName] = useState(club?.name || ""), [about, setAbout] = useState(club?.description || ""), [color, setColor] = useState(clubColor(club));
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    if (!name.trim()) { setError("Give the club a name."); return; }
    setPending(true); setError("");
    try {
      const data = { name: name.trim(), description: about.trim() || null, color };
      const saved = editing ? await updateClub(club.id, data) : await createClub(data);
      onSaved(saved);
    } catch (failure) {
      setError(codeOf(failure) === "too_many_clubs" ? "You’ve reached the limit for clubs you own." : SAVE_FAILED);
      setPending(false);
    }
  }
  return <NativeDialog open={open} onClose={() => { if (!pending) onClose(); }} title={editing ? "Edit club" : "Start a club"} className="bv-club-sheet">
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <div className="bv-field"><label htmlFor="bv-club-name">Club name</label><input id="bv-club-name" value={name} maxLength={80} autoComplete="off" onChange={event => { setName(event.target.value); setError(""); }} /></div>
      <div className="bv-field"><label htmlFor="bv-club-about">What’s it about? (optional)</label><textarea id="bv-club-about" rows={3} maxLength={500} value={about} onChange={event => setAbout(event.target.value)} /></div>
      <fieldset className="bv-club-swatches"><legend>Colour</legend>
        {CLUB_COLORS.map(([value, text]) => <label key={value} className="bv-club-swatch" style={{ "--swatch": value }}>
          <input type="radio" name="bv-club-color" value={value} checked={color === value} onChange={() => setColor(value)} /><span aria-hidden="true">{color === value && <Check />}</span><span className="bv-sr-only">{text}</span></label>)}
      </fieldset>
      {error && <p className="bv-field-error" role="alert">{error}</p>}
      <div className="bv-form-actions"><Button type="submit" disabled={pending}>{pending ? "Saving…" : editing ? "Save" : "Create club"}</Button></div>
    </form>
  </NativeDialog>;
}

// Invite: makes a link when asked, copies it, and lets an owner or admin stop it.
export function InviteSheet({ open, onClose, clubId }) {
  const [invite, setInvite] = useState(null), [copied, setCopied] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(""), [shown, setShown] = useState(false);
  async function copy() {
    if (pending) return;
    setPending(true); setError("");
    try {
      const made = invite || await createInvite(clubId);
      setInvite(made);
      try { await navigator.clipboard.writeText(made.url); setCopied(true); setShown(false); } catch { setShown(true); setCopied(false); }
    } catch { setError("The link couldn’t be made. Please try again."); }
    setPending(false);
  }
  async function stop() {
    if (!invite || pending) return;
    setPending(true); setError("");
    try { await revokeInvite(clubId, invite.id); setInvite(null); setCopied(false); setShown(false); onClose(); } catch { setError(SAVE_FAILED); }
    setPending(false);
  }
  return <NativeDialog open={open} onClose={onClose} title="Invite" className="bv-club-sheet">
    <div className="bv-club-invite">
      <Button onClick={copy} disabled={pending}>{copied ? <><Check aria-hidden="true" />Copied</> : "Copy invite link"}</Button>
      {shown && invite && <input className="bv-club-link" readOnly value={invite.url} aria-label="Invite link" onFocus={event => event.target.select()} />}
      {invite && <Button variant="quiet" onClick={stop} disabled={pending}>Stop this link</Button>}
      {error && <p className="bv-field-error" role="alert">{error}</p>}
    </div>
  </NativeDialog>;
}

// Add a book: find it, then it becomes the club's current book, or its next one when the club is already reading.
export function AddBookSheet({ open, onClose, clubId, hasCurrent, onSaved }) {
  const [query, setQuery] = useState(""), [results, setResults] = useState([]), [pending, setPending] = useState(false), [error, setError] = useState("");
  const latest = useRef(0);
  useEffect(() => {
    const text = query.trim();
    const id = ++latest.current;
    if (text.length < 2) return undefined;
    const timer = setTimeout(() => {
      getBookSuggestions(text).then(items => { if (id === latest.current) setResults(Array.isArray(items) ? items.filter(item => Number.isSafeInteger(item?.id) && item.title) : []); }, () => { if (id === latest.current) setResults([]); });
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);
  async function pick(book) {
    if (pending) return;
    setPending(true); setError("");
    try { await addClubBook(clubId, { book_id: book.id, status: hasCurrent ? "upcoming" : "current" }); onSaved(); }
    catch (failure) { setError(codeOf(failure) === "too_many_books" ? "This club has as many books as it can hold." : SAVE_FAILED); setPending(false); }
  }
  const shown = query.trim().length >= 2 ? results : [];
  return <NativeDialog open={open} onClose={() => { if (!pending) onClose(); }} title="Add a book" className="bv-club-sheet">
    <div className="bv-field"><label htmlFor="bv-club-find">Search books</label><input id="bv-club-find" type="search" value={query} maxLength={200} autoComplete="off" onChange={event => setQuery(event.target.value)} /></div>
    {shown.length > 0 && <ul className="bv-club-results" aria-label="Books">{shown.map(book => <li key={book.id}><button type="button" disabled={pending} onClick={() => pick(book)}>
      <strong>{book.title}</strong>{book.authors?.[0] && <small>{typeof book.authors[0] === "string" ? book.authors[0] : book.authors[0].name}</small>}</button></li>)}</ul>}
    {error && <p className="bv-field-error" role="alert">{error}</p>}
  </NativeDialog>;
}

// Edit schedule: the checkpoints and end date of the book being read, and the start date of the next one.
export function ScheduleSheet({ open, onClose, clubId, books, onChanged }) {
  const reading = books.find(book => book.status === "current"), upcoming = books.find(book => book.status === "upcoming");
  const [page, setPage] = useState(""), [due, setDue] = useState(""), [ends, setEnds] = useState(reading?.ends_on || ""), [starts, setStarts] = useState(upcoming?.starts_on || "");
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  async function run(work) {
    if (pending) return;
    setPending(true); setError("");
    try { await work(); onChanged(); } catch { setError(SAVE_FAILED); }
    setPending(false);
  }
  const addPoint = event => { event.preventDefault(); const value = Number(page); if (!Number.isInteger(value) || value < 1) return; run(async () => { await addCheckpoint(clubId, reading.id, { unit: "pages", value, due_on: due || null }); setPage(""); setDue(""); }); };
  return <NativeDialog open={open} onClose={onClose} title="Edit schedule" className="bv-club-sheet">
    {reading && <section aria-label="Checkpoints">
      <ul className="bv-club-points">{reading.checkpoints.map(point => <li key={point.id}><span>{positionLabel(point.unit, point.value)}{point.due_on ? ` · ${shortDate(point.due_on)}` : ""}</span>
        <Button variant="quiet" disabled={pending} aria-label={`Remove ${positionLabel(point.unit, point.value)}`} onClick={() => run(() => deleteCheckpoint(clubId, reading.id, point.id))}>Remove</Button></li>)}</ul>
      <form className="bv-club-row-form" onSubmit={addPoint} noValidate>
        <div className="bv-field"><label htmlFor="bv-cp-page">Page</label><input id="bv-cp-page" inputMode="numeric" value={page} onChange={event => setPage(event.target.value)} /></div>
        <div className="bv-field"><label htmlFor="bv-cp-date">Date</label><input id="bv-cp-date" type="date" value={due} onChange={event => setDue(event.target.value)} /></div>
        <Button type="submit" variant="secondary" disabled={pending || !page}>Add</Button>
      </form>
      <div className="bv-club-row-form"><div className="bv-field"><label htmlFor="bv-cp-end">End</label><input id="bv-cp-end" type="date" value={ends} onChange={event => setEnds(event.target.value)} /></div>
        <Button variant="secondary" disabled={pending} onClick={() => run(() => updateClubBook(clubId, reading.id, { ends_on: ends || null }))}>Save</Button></div>
    </section>}
    {upcoming && <div className="bv-club-row-form"><div className="bv-field"><label htmlFor="bv-up-start">{`${upcoming.title} from`}</label><input id="bv-up-start" type="date" value={starts} onChange={event => setStarts(event.target.value)} /></div>
      <Button variant="secondary" disabled={pending} onClick={() => run(() => updateClubBook(clubId, upcoming.id, { starts_on: starts || null }))}>Save</Button></div>}
    {error && <p className="bv-field-error" role="alert">{error}</p>}
  </NativeDialog>;
}
