import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { addClubBook, createClub, createInvite, revokeInvite, updateClub } from "../../api/clubs.js";
import { getBookSuggestions } from "../../api/suggest.js";
import { BookCover, Button, NativeDialog } from "../ui-v2/primitives.jsx";
import { localToday } from "../reading/localToday.js";
import { ADD_A_BOOK, ADD_TO_CLUB, CLUB_SIZE, LINK_COPIED, READ_IT_NEXT, READ_IT_NOW, SAVE, SHARE_INVITE_LINK, SIZE_CHOICES, SIZE_HELP, START_HELP, STOP_THIS_LINK, inviteLine } from "./clubCopy.js";
import { CLUB_COLORS, clubColor, codeOf, shortDate } from "./clubFormat.js";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";

// Leave club and Remove from club ask first: these are the two things that need a new invite to undo.
// `text` may be a sentence with a link in it; `danger` makes the confirm button the red one, for things that can't be undone.
export function ConfirmSheet({ title, text, confirmLabel, cancelLabel = "Cancel", danger = false, onConfirm, onClose, pending = false, error = "" }) {
  return <NativeDialog open onClose={() => { if (!pending) onClose(); }} title={title} className="bv-club-sheet">
    <p className="bv-club-confirm">{text}</p>
    {error && <p className="bv-field-error" role="alert">{error}</p>}
    <div className="bv-form-actions"><Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={pending}>{confirmLabel}</Button><Button variant="quiet" onClick={onClose} disabled={pending}>{cancelLabel}</Button></div>
  </NativeDialog>;
}

// Start a club (a name, nothing else: the description and colour come later in Edit club) or edit one (name, description, colour).
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
      const data = editing ? { name: name.trim(), description: about.trim() || null, color } : { name: name.trim() };
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
      {!editing && <p className="bv-club-help">{START_HELP}</p>}
      {editing && <>
        <div className="bv-field"><label htmlFor="bv-club-about">What’s it about? (optional)</label><textarea id="bv-club-about" rows={3} maxLength={500} value={about} onChange={event => setAbout(event.target.value)} /></div>
        <fieldset className="bv-club-swatches"><legend>Colour</legend>
          {CLUB_COLORS.map(([value, text]) => <label key={value} className="bv-club-swatch" style={{ "--swatch": value }}>
            <input type="radio" name="bv-club-color" value={value} checked={color === value} onChange={() => setColor(value)} /><span aria-hidden="true">{color === value && <Check />}</span><span className="bv-sr-only">{text}</span></label>)}
        </fieldset></>}
      {error && <p className="bv-field-error" role="alert">{error}</p>}
      <div className="bv-form-actions"><Button type="submit" disabled={pending}>{pending ? "Saving…" : editing ? "Save" : "Create club"}</Button></div>
    </form>
  </NativeDialog>;
}

// Club size (owners): 10, 15, 20 or 25 places, never fewer than the members already in the club. Only offered when the server sends member_limit.
export function ClubSizeSheet({ club, onClose, onSaved }) {
  const [size, setSize] = useState(club.member_limit), [pending, setPending] = useState(false), [error, setError] = useState("");
  async function save(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError("");
    try { await updateClub(club.id, { member_limit: size }); onSaved(); } catch { setError(SAVE_FAILED); setPending(false); }
  }
  return <NativeDialog open onClose={() => { if (!pending) onClose(); }} title={CLUB_SIZE} className="bv-club-sheet">
    <form onSubmit={save} noValidate aria-busy={pending}>
      <div className="bv-club-choice" role="radiogroup" aria-label={CLUB_SIZE}>
        {SIZE_CHOICES.map(choice => <label key={choice}><input type="radio" name="bv-club-size" value={choice} disabled={choice < club.member_count} checked={size === choice} onChange={() => setSize(choice)} /><span>{choice}</span></label>)}
      </div>
      <p className="bv-club-help">{SIZE_HELP}</p>
      {error && <p className="bv-field-error" role="alert">{error}</p>}
      <div className="bv-form-actions"><Button type="submit" disabled={pending || size === club.member_limit}>{SAVE}</Button></div>
    </form>
  </NativeDialog>;
}

// Invite people: one button makes the link and shares it (the phone's share sheet, else it is copied), then says when it stops working and how many
// places are left. An owner or admin can stop the link. `left` is the places left in the club (null when it has no limit).
export function InviteSheet({ open, onClose, clubId, left }) {
  const [invite, setInvite] = useState(null), [copied, setCopied] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(""), [shown, setShown] = useState(false);
  async function share() {
    if (pending) return;
    setPending(true); setError("");
    try {
      const made = invite || await createInvite(clubId);
      setInvite(made);
      let done = false;
      if (typeof navigator.share === "function") { try { await navigator.share({ url: made.url }); done = true; } catch (failure) { if (failure?.name === "AbortError") done = true; } }
      if (!done) { try { await navigator.clipboard.writeText(made.url); setCopied(true); setShown(false); } catch { setShown(true); setCopied(false); } }
    } catch { setError("The link couldn’t be made. Please try again."); }
    setPending(false);
  }
  async function stop() {
    if (!invite || pending) return;
    setPending(true); setError("");
    try { await revokeInvite(clubId, invite.id); setInvite(null); setCopied(false); setShown(false); onClose(); } catch { setError(SAVE_FAILED); }
    setPending(false);
  }
  const places = invite?.max_uses != null ? invite.max_uses : left;
  return <NativeDialog open={open} onClose={onClose} title="Invite people" className="bv-club-sheet">
    <div className="bv-club-invite">
      <Button onClick={share} disabled={pending}>{SHARE_INVITE_LINK}</Button>
      <p className="bv-club-note" role="status">{copied ? LINK_COPIED : ""}</p>
      {invite && <p className="bv-club-help">{inviteLine(shortDate(String(invite.expires_at).slice(0, 10)), places)}</p>}
      {shown && invite && <input className="bv-club-link" readOnly value={invite.url} aria-label="Invite link" onFocus={event => event.target.select()} />}
      {invite && <Button variant="quiet" onClick={stop} disabled={pending}>{STOP_THIS_LINK}</Button>}
      {error && <p className="bv-field-error" role="alert">{error}</p>}
    </div>
  </NativeDialog>;
}

// Add a book, in two steps: find it, then one question: read it now (only when the club isn't reading anything) or read it next.
// After "Read it now" the parent opens the reading plan, filled in for you.
export function AddBookSheet({ open, onClose, clubId, hasCurrent, onAdded }) {
  const [query, setQuery] = useState(""), [results, setResults] = useState([]), [picked, setPicked] = useState(null), [when, setWhen] = useState(hasCurrent ? "next" : "now");
  const [pending, setPending] = useState(false), [error, setError] = useState("");
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
  async function add() {
    if (pending) return;
    const now = when === "now" && !hasCurrent;
    setPending(true); setError("");
    try {
      const added = await addClubBook(clubId, { book_id: picked.id, status: now ? "current" : "upcoming", ...(now ? { starts_on: localToday() } : {}) });
      onAdded({ id: added.id, now });
    } catch (failure) { setError(codeOf(failure) === "too_many_books" ? "This club has as many books as it can hold." : SAVE_FAILED); setPending(false); }
  }
  const shown = query.trim().length >= 2 ? results : [];
  const authorOf = book => (typeof book.authors?.[0] === "string" ? book.authors[0] : book.authors?.[0]?.name);
  return <NativeDialog open={open} onClose={() => { if (!pending) onClose(); }} title={picked ? picked.title : ADD_A_BOOK} className="bv-club-sheet">
    {!picked ? <>
      <div className="bv-field"><label htmlFor="bv-club-find">Search books</label><input id="bv-club-find" type="search" value={query} maxLength={200} autoComplete="off" onChange={event => setQuery(event.target.value)} /></div>
      {shown.length > 0 && <ul className="bv-club-results" aria-label="Books">{shown.map(book => <li key={book.id}><button type="button" onClick={() => setPicked(book)}>
        <BookCover book={{ title: book.title, cover_image_url: book.cover_image_url, authors: [] }} size="small" decorative /><span><strong>{book.title}</strong>{authorOf(book) && <small>{authorOf(book)}</small>}</span></button></li>)}</ul>}
    </> : <>
      <div className="bv-club-choice" role="radiogroup">
        {!hasCurrent && <label><input type="radio" name="bv-club-when" checked={when === "now"} onChange={() => setWhen("now")} /><span>{READ_IT_NOW}</span></label>}
        <label><input type="radio" name="bv-club-when" checked={hasCurrent || when === "next"} onChange={() => setWhen("next")} /><span>{READ_IT_NEXT}</span></label>
      </div>
      <div className="bv-form-actions"><Button disabled={pending} onClick={add}>{ADD_TO_CLUB}</Button></div>
    </>}
    {error && <p className="bv-field-error" role="alert">{error}</p>}
  </NativeDialog>;
}
