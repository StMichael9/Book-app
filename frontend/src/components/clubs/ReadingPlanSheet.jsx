import { useState } from "react";
import { addCheckpoint, deleteCheckpoint, updateClubBook } from "../../api/clubs.js";
import { Button, NativeDialog } from "../ui-v2/primitives.jsx";
import { localToday } from "../reading/localToday.js";
import { addDays, positionLabel, shortDate, splitPlan } from "./clubFormat.js";
import { CANCEL, FINISH_BY, PLAN_HELP, READING_PLAN, SAVE_PLAN, SKIP, SPLIT_INTO, parts as partsLabel, part, endBy, toPage } from "./clubCopy.js";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";
const WEEKS = 4, DEFAULT_PARTS = 4;

// The reading plan of the book being read: "Finish by" and "Split into" give evenly spaced parts, previewed as they will be saved. Right after
// "Read it now" it is filled in for you (four weeks, four parts) and can be skipped; "Save plan" replaces the book's checkpoints and sets its end date.
export default function ReadingPlanSheet({ clubId, book, fresh = false, onClose, onChanged }) {
  const today = localToday();
  const existing = book.checkpoints?.length ? book.checkpoints.length + 1 : DEFAULT_PARTS;
  const [finish, setFinish] = useState(!fresh && book.ends_on && book.ends_on >= today ? book.ends_on : addDays(today, WEEKS * 7));
  const [count, setCount] = useState(fresh ? DEFAULT_PARTS : Math.min(8, existing));
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const rows = splitPlan({ start: today, finish, parts: count, pageCount: book.page_count });
  async function save() {
    if (pending || !finish) return;
    setPending(true); setError("");
    try {
      for (const point of book.checkpoints || []) await deleteCheckpoint(clubId, book.id, point.id);
      for (const row of rows.filter(item => !item.last)) await addCheckpoint(clubId, book.id, { unit: row.unit, value: row.value, due_on: row.due_on });
      await updateClubBook(clubId, book.id, { ends_on: finish });
      onChanged(); onClose();
    } catch {
      setError(SAVE_FAILED); setPending(false); onChanged();
    }
  }
  const leave = () => { onChanged(); onClose(); };
  return <NativeDialog open onClose={() => { if (!pending) leave(); }} title={READING_PLAN} className="bv-club-sheet">
    <div className="bv-field"><label htmlFor="bv-plan-finish">{FINISH_BY}</label><input id="bv-plan-finish" type="date" min={today} value={finish} onChange={event => setFinish(event.target.value)} /></div>
    <div className="bv-field"><label htmlFor="bv-plan-parts">{SPLIT_INTO}</label>
      <select id="bv-plan-parts" value={count} onChange={event => setCount(Number(event.target.value))}>{Array.from({ length: 8 }, (_, index) => index + 1).map(number => <option key={number} value={number}>{partsLabel(number)}</option>)}</select>
      <small className="bv-club-help">{PLAN_HELP}</small></div>
    <ol className="bv-club-plan-preview" aria-label={READING_PLAN}>{rows.map(row => <li key={row.number}><span>{part(row.number)}</span><span>{row.last ? endBy(shortDate(row.due_on)) : toPage(positionLabel(row.unit, row.value), shortDate(row.due_on))}</span></li>)}</ol>
    {error && <p className="bv-field-error" role="alert">{error}</p>}
    <div className="bv-form-actions"><Button disabled={pending || !finish} onClick={save}>{SAVE_PLAN}</Button><Button variant="quiet" disabled={pending} onClick={leave}>{fresh ? SKIP : CANCEL}</Button></div>
  </NativeDialog>;
}
