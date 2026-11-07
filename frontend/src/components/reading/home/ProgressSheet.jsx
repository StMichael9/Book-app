import { useState } from "react";
import { updateReadingAttempt } from "../../../api/reading.js";
import { useReadingCommand } from "../../../hooks/useReadingCommand.js";
import { Button, NativeDialog, TextLink } from "../../ui-v2/primitives.jsx";
import { progressOf } from "./homeLogic.js";

// Update progress without leaving Home: a Page / % choice, one number and one Save. Finishing and notes live in the book's
// own reading page, so the two links go there.
export default function ProgressSheet({ read, onClose, onSaved }) {
  const { entry, attempt, book } = read;
  const last = progressOf(attempt);
  const total = attempt.total_pages || null;
  const [unit, setUnit] = useState(attempt.progress_unit === "percent" || !total ? (attempt.progress_unit || "pages") : "pages");
  const [value, setValue] = useState(last && last.percent === (unit === "percent") ? String(last.value) : "");
  const command = useReadingCommand("Your progress couldn’t be saved. Please try again.");
  const number = value === "" ? null : Number(value);
  const max = unit === "percent" ? 100 : total;
  const invalid = number == null || !Number.isInteger(number) || number < 0 || (max != null && number > max);
  const hint = number == null || invalid ? "" : unit === "percent" ? (total ? `about page ${Math.round(total * number / 100)} of ${total}` : "") : total ? `of ${total} · ${Math.round(100 * number / total)}%` : "";
  const submit = event => {
    event.preventDefault();
    if (invalid) return;
    command.run(() => updateReadingAttempt(attempt.id, { expected_version: entry.version, progress_unit: unit, progress_value: number }), result => onSaved(result));
  };
  return <NativeDialog open onClose={onClose} title={book.title} className="bv-sheet bv-progress-sheet">
    <form onSubmit={submit} aria-busy={command.pending}>
      <div className="bv-progress-unit" role="group" aria-label="Track by">
        {[["pages", "Page"], ["percent", "%"]].map(([key, text]) => <button key={key} type="button" aria-pressed={unit === key} onClick={() => { setUnit(key); setValue(last && last.percent === (key === "percent") ? String(last.value) : ""); }}>{text}</button>)}
      </div>
      {last && <p className="bv-help">Last time: {last.label}</p>}
      <div className="bv-field">
        <label htmlFor="bv-progress-value">{unit === "percent" ? "Percent read" : "Page you’re on"}</label>
        <input id="bv-progress-value" type="number" inputMode="numeric" min="0" max={max ?? undefined} step="1" value={value} onChange={event => setValue(event.target.value)} autoFocus />
        {hint && <p className="bv-help" role="status">{hint}</p>}
      </div>
      {command.error && <p className="bv-field-error" role="alert">{command.error}</p>}
      <Button type="submit" className="bv-progress-save" disabled={command.pending || invalid}>{command.pending ? "Saving…" : "Save progress"}</Button>
      <div className="bv-progress-links"><TextLink to={`/my-books/${entry.id}`}>I finished it</TextLink><TextLink to={`/my-books/${entry.id}`}>Add a note</TextLink></div>
    </form>
  </NativeDialog>;
}
