import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { getReadingHistory, updateReadingAttempt } from "../../api/reading.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { useRequest } from "../ui-v2/data.js";
import { Button, EmptyState } from "../ui-v2/primitives.jsx";
import { currentProgress, pageOf, percentOf } from "./progressInput.js";
import { formatDay } from "./readingDates.js";

const stateWord = { finished: "finished", dnf: "stopped", reading: "reading", paused: "paused" };
const reactionLabel = { loved: "Loved it", liked: "Liked it", not_for_me: "Not for me" };

// The fore-edge of the book: fine page lines, the read part darker and a bookmark at the place. Decorative; the text line carries the facts.
export function ForeEdge({ attempt }) {
  const progress = currentProgress(attempt);
  const percent = progress ? percentOf(progress, attempt.total_pages) : null;
  if (!attempt) return null;
  return <div className="bv-foreedge" aria-hidden="true">
    {percent != null && <><span className="bv-foreedge-read" style={{ width: `${percent}%` }} /><span className="bv-foreedge-mark" style={{ left: `${percent}%` }} /></>}
  </div>;
}

// "Page 52 of 360 · 14% · started 13 Nov 2026". Tapping the total edits it in place.
export function ProgressLine({ entry, attempt, readOnly, onSaved }) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState("");
  const command = useReadingCommand("Your progress couldn’t be saved. Please try again.");
  if (!attempt) return null;
  const progress = currentProgress(attempt), total = attempt.total_pages || null;
  const percent = progress ? percentOf(progress, total) : null, page = progress ? pageOf(progress, total) : null;
  const started = formatDay(attempt.started_on);
  function save(event) {
    event.preventDefault();
    const pages = Number(value);
    if (!Number.isInteger(pages) || pages < 1) return;
    command.run(() => updateReadingAttempt(attempt.id, { expected_version: entry.version, total_pages: pages }), result => { setEditing(false); onSaved?.(result); });
  }
  const totalControl = total ? <Button variant="quiet" className="bv-inline-action" disabled={readOnly} aria-label={`Edit the page total, ${total} pages`} onClick={() => { setValue(String(total)); setEditing(true); }}>{total}</Button> : null;
  const parts = [
    progress && (progress.unit === "pages" ? <span key="p">Page {progress.value}{total ? <> of {totalControl}</> : ""}</span> : <span key="p">{progress.value}%{page != null ? <>, about page {page} of {totalControl}</> : ""}</span>),
    progress && progress.unit === "pages" && percent != null && <span key="c">{percent}%</span>,
    started && <span key="s">started {started}</span>,
  ].filter(Boolean);
  return <div className="bv-progress-line">
    <p>{parts.map((part, index) => <span key={index}>{index > 0 && " · "}{part}</span>)}</p>
    {editing && <form className="bv-progress-total-edit" onSubmit={save}>
      <label className="bv-sr-only" htmlFor="bv-page-total">Page total</label>
      <input id="bv-page-total" type="text" inputMode="numeric" autoComplete="off" autoFocus value={value} onChange={event => setValue(event.target.value)} />
      <Button type="submit" disabled={command.pending}>Save</Button><Button variant="quiet" onClick={() => setEditing(false)}>Cancel</Button>
      {command.error && <p role="alert" className="bv-field-error">{command.error}</p>}
    </form>}
  </div>;
}

// Everything that happened, newest first, built from what is already saved. Each line has a quiet Edit that opens it in place.
export default function ReadingJournal({ entry, attempt, entryId, workspace, visible, readOnly, onEdit, editor, editing }) {
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
    if (attempt.note) add("note", attempt.updated_at, attempt.note, { kind: "memory", attempt });
    else if (attempt.reaction) add("reaction", attempt.updated_at, reactionLabel[attempt.reaction], { kind: "memory", attempt });
    if (attempt.started_on) add("started", attempt.started_on, "Started", { kind: "progress", attempt });
  }
  // Days with saved progress, from the workspace's `progress_days` (T55): {day, unit, first_value, last_value}, newest first.
  // Missing or empty means no lines ("14 Nov · Page 14 → 52").
  const days = workspace?.progress_days;
  for (const { day: on, unit, first_value: from, last_value: to } of Array.isArray(days) ? days : []) {
    if (from == null || to == null || !on) continue;
    const mark = value => unit === "percent" ? `${value}%` : value;
    add(`day-${on}`, on, unit === "percent" ? `${mark(from)} → ${mark(to)}` : `Page ${from} → ${to}`);
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
    {history.error ? <EmptyState error title="Your history couldn’t load." action={<Button onClick={history.retry}>Try again</Button>}>Your records haven’t changed.</EmptyState> : null}
    {lines.length > 0 && <ul className="bv-journal-list">{lines.map(line => <li key={line.key} className={line.key.startsWith("day-") ? "bv-journal-day" : undefined}>
      {open(line) ? editor : <>
        {line.day && <time dateTime={line.day}>{formatDay(line.day, { journal: true })}</time>}
        <span className="bv-journal-text">{line.text}</span>
        {line.edit && !readOnly && <Button variant="quiet" className="bv-journal-edit" disabled={Boolean(editing)} aria-label={`Edit: ${line.text.slice(0, 60)}`} onClick={() => onEdit(line.edit.kind, line.edit.attempt)}>Edit</Button>}
      </>}
    </li>)}</ul>}
    <div className="bv-form-actions">{cursor && <Button variant="secondary" onClick={() => showHistory()}>First readings</Button>}{history.data?.next_cursor && <Button variant="secondary" onClick={() => showHistory(history.data.next_cursor)}>Older readings</Button>}</div>
  </section>;
}
