import { useEffect, useRef, useState } from "react";
import { updateLibraryEntry, updateReadingAttempt } from "../../api/reading.js";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { Button } from "../ui-v2/primitives.jsx";
import { draftFields } from "./readingDraftState.js";

const stateLabel = { reading: "Reading", paused: "Paused", finished: "Finished", dnf: "Stopped" };
const reactions = { loved: "Loved it", liked: "Liked it", not_for_me: "Not for me" };

export default function ReadingEditor({ draft, historical, readOnly, canReopen, onChange, onSaved, onClose, onReload }) {
  const command = useReadingCommand();
  const heading = useRef(null);
  const [fields, setFields] = useState(() => draft.values || draftFields(draft));
  const [settingsOpen, setSettingsOpen] = useState(readOnly || ["finished", "dnf"].includes(draft.attempt?.state));
  const isProgress = draft.kind === "progress", isReason = draft.kind === "save_note";
  const title = isProgress ? "Update progress" : isReason ? "Why I saved this book" : "My note";
  const configured = Boolean(draft.attempt?.progress_unit);
  const terminal = ["finished", "dnf"].includes(draft.attempt?.state);
  const baseline = draftFields(draft);
  const dirty = Object.keys(fields).some(key => String(fields[key]) !== String(baseline[key]));
  useEffect(() => { heading.current?.focus({ preventScroll: false }); }, []);

  function edit(name, value) {
    const next = { ...fields, [name]: value };
    setFields(next);
    const baseline = draftFields(draft);
    // Native numeric inputs yield strings; an unchanged number is not a draft.
    const dirty = Object.keys(next).some(key => String(next[key]) !== String(baseline[key]));
    onChange(dirty ? { ...draft, values: next } : null);
  }
  const format = <><label htmlFor="reading-unit">Track by</label><select id="reading-unit" value={fields.unit} onChange={event => edit("unit", event.target.value)}><option value="">Not tracking</option><option value="pages">Pages</option><option value="percent">Percent</option></select></>;
  function submit(event) {
    event.preventDefault();
    command.run(async () => {
      if (isReason) return { entry: await updateLibraryEntry(draft.entry.id, { expected_version: draft.version, save_note: fields.text || null }) };
      return updateReadingAttempt(draft.attempt.id, { expected_version: draft.version, ...(isProgress ? {
        progress_unit: fields.unit || null, progress_value: fields.unit && fields.value !== "" ? Number(fields.value) : null,
        total_pages: fields.total === "" ? null : Number(fields.total), started_on: fields.started || null,
        ...(terminal ? { ended_on: fields.ended || null } : {}),
      } : { note: fields.text || null, reaction: fields.reaction || null }) });
    }, onSaved);
  }
  return <div className="bv-reading-draft bv-workspace-editor">
    <form className="bv-field bv-reading-form" onSubmit={submit} aria-busy={command.pending}>
      <h2 tabIndex={-1} ref={heading}>{historical ? "Selected reading" : title}</h2>
      {historical && <p className="bv-help">{stateLabel[draft.attempt.state]} · {draft.attempt.started_on || "Start date unknown"}{draft.attempt.ended_on ? ` → ${draft.attempt.ended_on}` : ""}</p>}
      {readOnly && !isProgress && !isReason && !fields.text && !fields.reaction && <p className="bv-help">No note or reaction is saved for this reading. Changes are temporarily paused.</p>}
      <fieldset disabled={readOnly || command.pending}><legend className="bv-sr-only">{title}</legend>
        {isProgress ? <>
          {!configured && format}
          {fields.unit && <><label htmlFor="reading-progress">{fields.unit === "pages" ? "Current page" : "Percent complete"}</label><input autoComplete="off" id="reading-progress" type="number" inputMode="numeric" min="0" max={fields.unit === "percent" ? 100 : undefined} step="1" required value={fields.value} onChange={event => edit("value", event.target.value)} /></>}
          <details className="bv-progress-settings" open={settingsOpen} onToggle={event => setSettingsOpen(event.currentTarget.open)}><summary>Format, copy & dates</summary>
            {configured && format}
            <label htmlFor="reading-total">Total pages (optional)</label><input id="reading-total" type="number" min="1" step="1" value={fields.total} onChange={event => edit("total", event.target.value)} />
            <label htmlFor="reading-started">Started on (optional)</label><input id="reading-started" type="date" value={fields.started} onChange={event => edit("started", event.target.value)} />
            {terminal && <><label htmlFor="reading-ended">Ended on (optional)</label><input id="reading-ended" type="date" value={fields.ended} onChange={event => edit("ended", event.target.value)} /></>}
            <p className="bv-help">Use your copy’s page total. Reaching 100% doesn’t finish the book.</p>
          </details>
        </> : <>
          <label htmlFor="reading-context">{isReason ? "Save reason (optional)" : "Note (optional)"}</label>
          <textarea id="reading-context" rows={4} maxLength={isReason ? 500 : 2000} value={fields.text} onChange={event => edit("text", event.target.value)} />
          <small className="bv-editor-caption">Private to you · {fields.text.length} / {isReason ? 500 : 2000}</small>
          {!isReason && <details className="bv-note-options"><summary>Reaction (optional)</summary><label className="bv-sr-only" htmlFor="reading-reaction">Reaction (optional)</label><select id="reading-reaction" value={fields.reaction} onChange={event => edit("reaction", event.target.value)}><option value="">No reaction</option>{Object.entries(reactions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></details>}
        </>}
        {canReopen && <><Button variant="quiet" disabled={dirty} onClick={() => command.run(() => updateReadingAttempt(draft.attempt.id, { expected_version: draft.version, state: "reading" }), onSaved)}>Reopen selected reading</Button>{dirty && <p className="bv-help">Save your changes before reopening this reading.</p>}</>}
      </fieldset>
      {/* Save and Close share one row; Save stays outside the fieldset so Close works while changes are paused. */}
      <div className="bv-form-actions bv-editor-actions"><Button type="submit" disabled={readOnly || command.pending}>{command.pending ? "Saving…" : isProgress ? "Save progress" : isReason ? "Save reason" : "Save note"}</Button>
        <Button variant="quiet" disabled={command.pending} onClick={onClose}>Close</Button></div>
      {command.error && <div role="alert" className="bv-notice"><p>{command.error} Your draft is still here.</p><Button variant="quiet" disabled={command.pending} onClick={onReload}>Load saved version</Button><p className="bv-help">This replaces this draft with the saved version. Copy any text you want to keep first.</p></div>}
    </form>
  </div>;
}
