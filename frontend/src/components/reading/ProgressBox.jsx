import { useEffect, useId, useRef, useState } from "react";
import { updateReadingAttempt } from "../../api/reading.js";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { Button } from "../ui-v2/primitives.jsx";
import { localToday } from "./localToday.js";
import "../../styles/ui-v2/reading-page.css";
import { SEND_PROGRESS_DAY, UNREADABLE, isLast, pageOf, parseProgress, savedLine } from "./progressInput.js";

// One box for "where am I": type a page or a percent, then Save. It works on Home's Reading now cards and at the top of a book's
// page (where the button says "Save page" and a green tick confirms it). It saves progress only; thoughts live in Notes.
// Nothing opens over the page and nothing locks.
const CONFIRM_MS = 4000;
export default function ProgressBox({ entry, attempt, title, onPage = false, minVersion = 0, readOnly = false, onSaved, onFinished, onNotYet }) {
  const id = useId();
  const [value, setValue] = useState(""), [total, setTotal] = useState("");
  const [asking, setAsking] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState(""), [prompt, setPrompt] = useState(false);
  const field = useRef(null), totalField = useRef(null);
  const command = useReadingCommand("Your progress couldn’t be saved. Please try again.");
  const finish = useReadingCommand("Your progress couldn’t be saved. Please try again.");
  // A save returns the newest version of the book's entry; the next save (or Yes, finished) must send that one.
  const [savedVersion, setSavedVersion] = useState(0), [savedAt, setSavedAt] = useState(0);
  const version = Math.max(entry.version, savedVersion, minVersion);
  const known = attempt.total_pages || null;
  const typed = parseProgress(value);
  const hint = typed?.unit === "percent" && known ? `about page ${pageOf(typed, known)}` : "";
  const label = title ? `Page or % for ${title}` : "Page or %";

  function submit(event) {
    event.preventDefault();
    const text = value.trim();
    if (!text) { setError(UNREADABLE); field.current?.focus(); return; }
    const progress = parseProgress(text);
    if (!progress) { setError(UNREADABLE); field.current?.focus(); return; }
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
      progress_unit: progress.unit, progress_value: progress.value, ...(pages && !known ? { total_pages: pages } : {}),
      ...(SEND_PROGRESS_DAY ? { on: localToday() } : {}),
    }), result => {
      setSavedVersion(result.entry?.version ?? 0);
      setValue(""); setTotal(""); setAsking(false);
      setStatus(onPage ? (progress.unit === "pages" ? `Saved page ${progress.value}` : `Saved ${progress.value}%`) : savedLine(progress, pages)); setSavedAt(Date.now());
      setPrompt(isLast(progress, pages));
      // `finishing` is true when this save reached the last page, so the "Finished the book?" step follows it in the box.
      onSaved?.(result, { finishing: isLast(progress, pages) });
    });
  }
  // On the book's page the confirmation fades after a few seconds (the fade itself is CSS, and off for reduced motion).
  useEffect(() => {
    if (!onPage || !savedAt) return undefined;
    const timer = setTimeout(() => setStatus(""), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [onPage, savedAt]);
  function yes() {
    const today = localToday();
    const ended_on = attempt.started_on && attempt.started_on > today ? attempt.started_on : today;
    finish.run(() => updateReadingAttempt(attempt.id, { expected_version: version, state: "finished", ended_on }), result => { setPrompt(false); onFinished?.(result); });
  }
  const statusLine = <p role="status" className="bv-progress-status" key={onPage ? savedAt : undefined}>{status && onPage ? <><span aria-hidden="true">✓ </span>{status}</> : status}</p>;
  return <form className={`bv-progress-box${onPage ? " bv-progress-box--page" : ""}`} onSubmit={submit} noValidate aria-busy={command.pending}>
    <div className="bv-progress-row">
      <input ref={field} id={`${id}-value`} type="text" inputMode="decimal" autoComplete="off" placeholder="Page or %" aria-label={label} value={value} disabled={readOnly}
        aria-invalid={error ? "true" : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onChange={event => { setValue(event.target.value); setError(""); }} />
      <Button type="submit" disabled={readOnly || command.pending}>{command.pending ? "Saving…" : onPage ? "Save page" : "Save"}</Button>
      {onPage && statusLine}
    </div>
    {hint && !error && <p id={`${id}-hint`} className="bv-help">{hint}</p>}
    {error && <p id={`${id}-error`} className="bv-field-error">{error}</p>}
    {asking && <div className="bv-field bv-progress-total"><label htmlFor={`${id}-total`}>How many pages in your copy?</label>
      <input ref={totalField} id={`${id}-total`} type="text" inputMode="numeric" autoComplete="off" value={total} onChange={event => setTotal(event.target.value)} /></div>}
    {(command.error || finish.error) && <p role="alert" className="bv-field-error">{command.error || finish.error}</p>}
    {!onPage && statusLine}
    {prompt && <div className="bv-finished-prompt" role="group" aria-label="Finished the book?"><span>Finished the book?</span>
      <Button disabled={finish.pending} onClick={yes}>Yes, finished</Button><Button variant="quiet" onClick={() => { setPrompt(false); onNotYet?.(); }}>Not yet</Button></div>}
  </form>;
}
