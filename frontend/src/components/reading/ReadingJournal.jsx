import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { getReadingHistory, updateReadingAttempt } from "../../api/reading.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { useRequest } from "../ui-v2/data.js";
import { Button, EmptyState } from "../ui-v2/primitives.jsx";
import { currentProgress, pageOf, percentOf } from "./progressInput.js";
import { formatDay } from "./readingDates.js";
import { addNote, editNote, noteMeta, notesOf } from "./readingNotes.js";
import { ReactionRow } from "./ThumbsPrompt.jsx";

const stateWord = { finished: "finished", dnf: "stopped", reading: "reading", paused: "paused" };

// The progress bar: a solid green fill on a quiet track. Decorative; the text line under it carries the facts.
export function ForeEdge({ attempt }) {
  const progress = currentProgress(attempt);
  const percent = progress ? percentOf(progress, attempt.total_pages) : null;
  if (!attempt) return null;
  return <div className="bv-trackbar" aria-hidden="true">{percent != null && <span className="bv-trackbar-fill" style={{ width: `${percent}%` }} />}</div>;
}

// "Page 52 of 360 · 14%" on the left, "started 13 Nov" on the right. The page total itself is corrected under About this book.
export function ProgressLine({ attempt }) {
  if (!attempt) return null;
  const progress = currentProgress(attempt), total = attempt.total_pages || null;
  const percent = progress ? percentOf(progress, total) : null, page = progress ? pageOf(progress, total) : null;
  const started = formatDay(attempt.started_on);
  const left = progress && (progress.unit === "pages"
    ? <><strong>Page {progress.value}</strong>{total ? ` of ${total}` : ""}{percent != null ? ` · ${percent}%` : ""}</>
    : <><strong>{progress.value}%</strong>{page != null ? `, about page ${page} of ${total}` : ""}</>);
  if (!left && !started) return null;
  return <div className="bv-progress-line"><p>{left || <span />}</p>{started && <p>started {started}</p>}</div>;
}

// The page total, corrected in place. It lives under About this book, so the number is no longer a bare link beside the bar.
export function PageCountEdit({ entry, attempt, readOnly, onSaved }) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState("");
  const command = useReadingCommand("Your progress couldn’t be saved. Please try again.");
  const total = attempt?.total_pages || null;
  if (!attempt || !total) return null;
  function save(event) {
    event.preventDefault();
    const pages = Number(value);
    if (!Number.isInteger(pages) || pages < 1) return;
    command.run(() => updateReadingAttempt(attempt.id, { expected_version: entry.version, total_pages: pages }), result => { setEditing(false); onSaved?.(result); });
  }
  return <div className="bv-page-count">
    <Button variant="quiet" className="bv-inline-action" disabled={readOnly} aria-label={`Edit the page total, ${total} pages`} onClick={() => { setValue(String(total)); setEditing(true); }}>{total} pages</Button>
    {editing && <form className="bv-progress-total-edit" onSubmit={save}>
      <label className="bv-sr-only" htmlFor="bv-page-total">Page total</label>
      <input id="bv-page-total" type="text" inputMode="numeric" autoComplete="off" autoFocus value={value} onChange={event => setValue(event.target.value)} />
      <Button type="submit" disabled={command.pending}>Save</Button><Button variant="quiet" onClick={() => setEditing(false)}>Cancel</Button>
      {command.error && <p role="alert" className="bv-field-error">{command.error}</p>}
    </form>}
  </div>;
}

// Notes show as one card each, newest first, drawn only from readingNotes.js. A card's "date · page" line shows only when that data exists.
const firstWords = text => { const words = text.split(/\s+/).slice(0, 6).join(" "); return words.length > 48 ? `${words.slice(0, 48)}…` : words; };

function NoteCard({ note, index, readOnly, saving, editing, onOpen, onSave, onCancel, error }) {
  const [draft, setDraft] = useState(note.text), field = useRef(null);
  useEffect(() => { if (editing) { const node = field.current; node?.focus(); node?.setSelectionRange(node.value.length, node.value.length); } }, [editing]);
  const meta = noteMeta(note);
  if (editing) return <li className="bv-note-card bv-note-card--editing">
    {meta && <p className="bv-note-meta">{meta}</p>}
    <label className="bv-sr-only" htmlFor={`bv-note-edit-${index}`}>Edit note</label>
    <textarea ref={field} id={`bv-note-edit-${index}`} className="bv-note-input" rows={3} maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)}
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }} />
    {error && <p role="alert" className="bv-field-error">{error}</p>}
    <div className="bv-note-actions"><Button variant="quiet" disabled={saving} onClick={onCancel}>Cancel</Button><Button disabled={saving} onClick={() => onSave(draft)}>{saving ? "Saving…" : "Save"}</Button></div>
  </li>;
  const body = <>{meta && <p className="bv-note-meta">{meta}</p>}<p className="bv-note-text">{note.text}</p></>;
  // While changes are paused a note can be read but not opened, so it is not a button.
  if (readOnly) return <li className="bv-note-card bv-note-card--static">{body}</li>;
  return <li className="bv-note-card" role="button" tabIndex={0} aria-label={`Edit note: ${firstWords(note.text)}`}
    onClick={onOpen} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(); } }}>
    <span className="bv-note-hint" aria-hidden="true">Edit ✎</span>
    {body}
  </li>;
}

export function ReadingNotes({ entry, attempt, readOnly, minVersion = 0, onSaved }) {
  const [text, setText] = useState(""), [openIndex, setOpenIndex] = useState(null), [savedVersion, setSavedVersion] = useState(0);
  const command = useReadingCommand("Your note couldn’t be saved. Please try again.");
  const area = useRef(null), listRef = useRef(null);
  if (!attempt) return null;
  const notes = notesOf(attempt), version = Math.max(entry.version, savedVersion, minVersion);
  const save = (write, done) => command.run(() => write(attempt, version), result => {
    setSavedVersion(result.entry?.version ?? 0); done?.(); onSaved?.(result);
  });
  const grow = node => { if (node) { node.style.height = "auto"; node.style.height = `${node.scrollHeight}px`; } };
  function add(event) {
    event.preventDefault();
    const thought = text.trim();
    if (!thought) return;
    save((current, v) => addNote(current, v, thought), () => { setText(""); requestAnimationFrame(() => grow(area.current)); });
  }
  // The cards run newest first.
  const cards = [...notes].reverse();
  function saveCard(id, draft) {
    save((current, v) => editNote(current, v, id, draft), () => {
      setOpenIndex(null);
      requestAnimationFrame(() => listRef.current?.querySelector("[role='button']")?.focus());
    });
  }
  return <section className="bv-notes" aria-labelledby="bv-notes-title">
    <h2 id="bv-notes-title">Notes</h2>
    <p className="bv-help">Only you can see your notes.</p>
    <form className="bv-notes-form" onSubmit={add}>
      <label className="bv-sr-only" htmlFor="bv-note-new">Write a thought about this book</label>
      <textarea ref={area} id="bv-note-new" className="bv-note-input" rows={3} maxLength={2000} placeholder="Write a thought about this book" value={text} disabled={readOnly}
        onChange={event => { setText(event.target.value); grow(event.target); }} />
      {command.error && openIndex == null && <p role="alert" className="bv-field-error">{command.error}</p>}
      <div className="bv-note-actions"><Button type="submit" disabled={readOnly || command.pending || !text.trim()}>Add note</Button></div>
    </form>
    {cards.length > 0 && <ul className="bv-note-list" ref={listRef}>{cards.map(note => <NoteCard key={`${note.id}:${note.text}`} note={note} index={note.id} readOnly={readOnly} saving={command.pending}
      editing={openIndex === note.id} error={openIndex === note.id ? command.error : ""} onOpen={() => setOpenIndex(note.id)}
      onCancel={() => setOpenIndex(null)} onSave={draft => saveCard(note.id, draft)} />)}</ul>}
  </section>;
}

// Everything that happened, newest first, built from what is already saved. Each line has a quiet Edit that opens it in place.
export default function ReadingJournal({ entry, attempt, entryId, workspace, visible, readOnly, onEdit, editor, editing, minVersion = 0, onSaved }) {
  const auth = useAuth(), library = useUserBooks(), location = useLocation();
  const [params, setParams] = useSearchParams();
  const cursor = params.get("history_cursor") || "";
  const history = useRequest(() => getReadingHistory(entryId, cursor), `history:${auth.sessionGeneration}:${entryId}:${cursor}:${library.revision}`, visible);
  function showHistory(next = "") {
    const search = new URLSearchParams(params);
    if (next) search.set("history_cursor", next); else search.delete("history_cursor");
    setParams(search, { state: location.state });
  }
  const lines = [];
  const add = (key, day, text, edit) => lines.push({ key, day: typeof day === "string" ? day.slice(0, 10) : "", text, edit, order: lines.length });
  if (attempt) {
    if (["finished", "dnf"].includes(attempt.state)) add("finished", attempt.ended_on, attempt.state === "dnf" ? "Stopped" : "Finished", { kind: "progress", attempt });
    if (attempt.state === "paused") add("paused", attempt.updated_at, "Paused", { kind: "progress", attempt });
    if (attempt.started_on) add("started", attempt.started_on, "Started", { kind: "progress", attempt });
  }
  // Days with saved progress, from the workspace's `progress_days` (T55): {day, unit, first_value, last_value}, newest first.
  // Missing or empty means no lines ("14 Nov · Page 14 to 52").
  const days = workspace?.progress_days;
  for (const { day: on, unit, first_value: from, last_value: to } of Array.isArray(days) ? days : []) {
    if (from == null || to == null || !on || from === to) continue; // a day with no movement says nothing
    const mark = value => unit === "percent" ? `${value}%` : value;
    add(`day-${on}`, on, unit === "percent" ? `${mark(from)} to ${mark(to)}` : `Page ${from} to ${to}`);
  }
  if (entry?.save_note) add("saved", entry.created_at, `Saved it: ${entry.save_note}`, { kind: "save_note" });
  for (const past of history.data?.items || []) {
    if (past.id === attempt?.id) continue;
    const day = past.ended_on || past.started_on, year = day ? day.slice(0, 4) : "";
    add(`past-${past.id}`, day, `Read before${year ? `: ${year}` : ""}, ${stateWord[past.state] || past.state}`, { kind: "progress", attempt: past });
  }
  lines.sort((a, b) => (b.day || "").localeCompare(a.day || "") || a.order - b.order);
  const open = line => editing && line.edit && editing.kind === line.edit.kind && (line.edit.kind === "save_note" || editing.attempt?.id === line.edit.attempt?.id);
  return <section className="bv-journal" aria-labelledby="bv-journal-title" hidden={!visible}>
    <h2 id="bv-journal-title">Your reading</h2>
    <ReactionRow entry={entry} attempt={attempt} readOnly={readOnly} minVersion={minVersion} onSaved={onSaved} />
    {history.error ? <EmptyState error title="Your history couldn’t load." action={<Button onClick={history.retry}>Try again</Button>}>Your records haven’t changed.</EmptyState> : null}
    {lines.length > 0 && <ul className="bv-journal-list">{lines.map(line => <li key={line.key} className={line.key.startsWith("day-") ? "bv-journal-day" : undefined}>
      {open(line) ? editor : <>
        {line.day && <time dateTime={line.day}>{formatDay(line.day, { journal: true })}</time>}
        <span className="bv-journal-text">{line.text}</span>
        {line.edit && !readOnly && <Button variant="quiet" className="bv-journal-edit bv-inline-action" disabled={Boolean(editing)} aria-label={`Edit: ${line.text.slice(0, 60)}`} onClick={() => onEdit(line.edit.kind, line.edit.attempt)}>Edit</Button>}
      </>}
    </li>)}</ul>}
    <div className="bv-form-actions">{cursor && <Button variant="secondary" onClick={() => showHistory()}>First readings</Button>}{history.data?.next_cursor && <Button variant="secondary" onClick={() => showHistory(history.data.next_cursor)}>Older readings</Button>}</div>
  </section>;
}
