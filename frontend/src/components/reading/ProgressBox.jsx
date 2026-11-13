import { useId, useRef, useState } from "react";
import { updateReadingAttempt } from "../../api/reading.js";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { Button } from "../ui-v2/primitives.jsx";
import { localToday } from "./localToday.js";
import "../../styles/ui-v2/reading-page.css";
import { SEND_PROGRESS_DAY, UNREADABLE, isLast, pageOf, parseProgress, savedLine } from "./progressInput.js";

// One box for "where am I": type a page or a percent, then Save. It works on Home's Reading now cards and at the top of a book's
// page (where it also takes a thought). Nothing opens over the page and nothing locks.
export default function ProgressBox({ entry, attempt, title, thought = false, readOnly = false, onSaved, onFinished }) {
  const id = useId();
  const [value, setValue] = useState(""), [note, setNote] = useState(""), [total, setTotal] = useState("");
  const [asking, setAsking] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState(""), [prompt, setPrompt] = useState(false);
  const field = useRef(null), totalField = useRef(null);
  const command = useReadingCommand("Your progress couldn’t be saved. Please try again.");
  const finish = useReadingCommand("Your progress couldn’t be saved. Please try again.");
  // A save returns the newest version of the book's entry; the next save (or Yes, finished) must send that one.
  const [savedVersion, setSavedVersion] = useState(0);
  const version = Math.max(entry.version, savedVersion);
  const known = attempt.total_pages || null;
  const typed = parseProgress(value);
  const hint = typed?.unit === "percent" && known ? `about page ${pageOf(typed, known)}` : "";
  const label = title ? `Page or % for ${title}` : "Page or %";

  function submit(event) {
    event.preventDefault();
    const text = value.trim(), thoughtText = note.trim();
    if (!text && !thoughtText) { setError(UNREADABLE); field.current?.focus(); return; }
    const progress = text ? parseProgress(text) : null;
    if (text && !progress) { setError(UNREADABLE); field.current?.focus(); return; }
    let pages = known;
    if (progress?.unit === "pages") {
      if (!pages) {
        // The page total is asked for once, right here.
        const asked = Number(total);
        if (!asking || !Number.isInteger(asked) || asked < 1) { setAsking(true); queueMicrotask(() => totalField.current?.focus()); return; }
        pages = asked;
      }
      if (progress.value > pages) { setError(`Your copy has ${pages} pages.`); field.current?.focus(); return; }
    }
    setError(""); setStatus(""); setPrompt(false);
    command.run(() => updateReadingAttempt(attempt.id, {
      expected_version: version,
      ...(progress ? { progress_unit: progress.unit, progress_value: progress.value, ...(pages && !known ? { total_pages: pages } : {}) } : {}),
      ...(thoughtText ? { note: attempt.note ? `${attempt.note}\n\n${thoughtText}` : thoughtText } : {}),
      ...(SEND_PROGRESS_DAY && progress ? { on: localToday() } : {}),
    }), result => {
      setSavedVersion(result.entry?.version ?? 0);
      setValue(""); setNote(""); setTotal(""); setAsking(false);
      setStatus(progress ? savedLine(progress, pages) : "Saved.");
      setPrompt(Boolean(progress && isLast(progress, pages)));
      onSaved?.(result);
    });
  }
  function yes() {
    const today = localToday();
    const ended_on = attempt.started_on && attempt.started_on > today ? attempt.started_on : today;
    finish.run(() => updateReadingAttempt(attempt.id, { expected_version: version, state: "finished", ended_on }), result => { setPrompt(false); onFinished?.(result); });
  }
  return <form className="bv-progress-box" onSubmit={submit} noValidate aria-busy={command.pending}>
    <div className="bv-progress-row">
      <input ref={field} id={`${id}-value`} type="text" inputMode="decimal" autoComplete="off" placeholder="Page or %" aria-label={label} value={value} disabled={readOnly}
        aria-invalid={error ? "true" : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onChange={event => { setValue(event.target.value); setError(""); }} />
      <Button type="submit" disabled={readOnly || command.pending}>{command.pending ? "Saving…" : "Save"}</Button>
    </div>
    {hint && !error && <p id={`${id}-hint`} className="bv-help">{hint}</p>}
    {error && <p id={`${id}-error`} className="bv-field-error">{error}</p>}
    {asking && <div className="bv-field bv-progress-total"><label htmlFor={`${id}-total`}>How many pages in your copy?</label>
      <input ref={totalField} id={`${id}-total`} type="text" inputMode="numeric" autoComplete="off" value={total} onChange={event => setTotal(event.target.value)} /></div>}
    {thought && <input type="text" className="bv-progress-thought" placeholder="Add a thought" aria-label="Add a thought" maxLength={2000} autoComplete="off" value={note} disabled={readOnly} onChange={event => setNote(event.target.value)} />}
    {(command.error || finish.error) && <p role="alert" className="bv-field-error">{command.error || finish.error}</p>}
    <p role="status" className="bv-progress-status">{status}</p>
    {prompt && <div className="bv-finished-prompt" role="group" aria-label="Finished the book?"><span>Finished the book?</span>
      <Button disabled={finish.pending} onClick={yes}>Yes, finished</Button><Button variant="quiet" onClick={() => setPrompt(false)}>Not yet</Button></div>}
  </form>;
}
