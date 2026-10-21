import ImportJourney from "./ImportJourney.jsx";
import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../../hooks/useReadingCommand.js";
import * as imports from "../../../api/libraryImports.js";
import { ActionLink, Button, NativeDialog, PageHeading, TextLink } from "../../ui-v2/primitives.jsx";
import { fileHeaders, importDigest, pastedRows, streamFile } from "./parsing.js";
import "../../../styles/ui-v2/library-import.css";

const phaseLabels = { uploading: "Uploading your rows", analyzing: "Finding your books", grouping: "Checking duplicates and conflicts", preview_ready: "Review your library", applying: "Bringing your library home", completed: "Your library is here", completed_with_issues: "Import complete, with some rows skipped", cancelled: "Import stopped", expired: "This import expired", failed: "Import needs attention" };
const names = { goodreads: "Goodreads", storygraph: "StoryGraph", bookvane: "Bookvane CSV v1", generic: "CSV / TSV", paste: "Pasted list" };
const readable = value => value.replaceAll("_", " ");

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Paused", "AbortError"));
    const cancel = () => { clearTimeout(timer); reject(new DOMException("Paused", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

async function retry(operation, signal) {
  for (let attempt = 0; ; attempt += 1) {
    if (signal.aborted) throw new DOMException("Paused", "AbortError");
    try { return await operation(); }
    catch (error) {
      if (attempt >= 2 || ![429, 503].includes(error.status)) throw error;
      await wait(750 * 2 ** attempt, signal);
    }
  }
}

function ImportRow({ row, revision, disabled, onDecision }) {
  const [choice, setChoice] = useState("");
  const [addHistory, setAddHistory] = useState(false), [sourceUpdate, setSourceUpdate] = useState(false);
  const source = row.source;
  const proposed = row.candidates?.find(candidate => candidate.book_id === row.plan?.book_id && candidate.book_id != null);
  return <article className="bv-import-row">
    <h3>{source?.title || proposed?.title || (source?.isbns?.join(", ") || `Row ${row.ordinal}`)}</h3>
    <p className="bv-muted">{source?.author || "Author not supplied"} · {readable(row.disposition)}</p>
    {row.plan?.kind === "existing" && <p className="bv-help">Already in My Books. Your existing flags, notes and readings take priority.</p>}
    {proposed && <p className="bv-help">Proposed catalogue work: {proposed.title} · {proposed.authors?.join(", ") || "Author not listed"}.</p>}
    {row.plan?.kind === "private" && <p className="bv-help">New private-entry proposal, only with your approval.</p>}
    {row.error_code && <p className="bv-help">{readable(row.error_code)}.</p>}
    {source?.warnings?.length > 0 && <p className="bv-help">Source values needing care: {source.warnings.map(readable).join(", ")}.</p>}
    {source && <details><summary>Source information</summary><dl className="bv-import-context">
      <dt>Source Own / Want</dt><dd>Own: {source.is_owned == null ? "unknown" : source.is_owned ? "yes" : "no"} · Want: {source.is_wanted == null ? "unknown" : source.is_wanted ? "yes" : "no"}. Unknown does not become an invented preference.</dd>
      {source.status && <><dt>Reading status</dt><dd>{readable(source.status)}</dd></>}
      {source.context?.rating != null && <><dt>Source rating</dt><dd>{source.context.rating} / 5</dd></>}
      {source.context?.review && <><dt>Imported review (private)</dt><dd>{source.context.review}</dd></>}
      {source.context?.private_note && <><dt>Imported note (private)</dt><dd>{source.context.private_note}</dd></>}
      {source.context?.labels?.length > 0 && <><dt>Private source labels</dt><dd>{source.context.labels.join(", ")}</dd></>}
      {source.events?.length > 0 && <><dt>Source reading information</dt><dd>{source.events.map(event => `${readable(event.state)}: ${event.started_on || "start unknown"} → ${event.ended_on || "end unknown"}`).join("; ")}</dd></>}
    </dl></details>}
    {["review", "ready", "approved", "invalid"].includes(row.disposition) && <details open={["review", "invalid"].includes(row.disposition)}><summary>{["review", "invalid"].includes(row.disposition) ? "Resolve this book group" : "Change this proposal"}</summary><fieldset disabled={disabled} className="bv-field">
      <legend>Decision for this book group</legend>
      {row.candidates?.length > 0 && <><label htmlFor={`import-target-${row.ordinal}`}>Catalogue match</label><select id={`import-target-${row.ordinal}`} value={choice} onChange={event => setChoice(event.target.value)}><option value="">Choose a match</option>{row.candidates.map(candidate => <option key={candidate.entry_id ? `entry:${candidate.entry_id}` : candidate.book_id} value={candidate.entry_id ? `entry:${candidate.entry_id}` : `book:${candidate.book_id}`}>{candidate.title} · {candidate.authors?.join(", ") || "Author not listed"}</option>)}</select>
        <Button variant="secondary" disabled={!choice} onClick={() => {
          const [kind, id] = choice.split(":");
          onDecision(row.ordinal, { expected_revision: revision, action: "match", [kind === "entry" ? "entry_id" : "book_id"]: Number(id) });
        }}>Use selected match</Button></>}
      {source && row.plan?.kind !== "removed" && <div className="bv-form-actions">
        {source.title && <Button variant="secondary" onClick={() => onDecision(row.ordinal, { expected_revision: revision, action: "private" })}>Keep as a private book</Button>}
        {["existing", "catalogue", "private"].includes(row.plan?.kind) && <Button variant="secondary" onClick={() => onDecision(row.ordinal, { expected_revision: revision, action: "preserve", history_policy: addHistory ? "add" : "preserve", accept_source_update: sourceUpdate })}>Keep existing data; accept source context</Button>}
        {["existing", "catalogue", "private"].includes(row.plan?.kind) && source.events?.length > 0 && <>{row.error_code === "mixed_terminal_states_require_context_decision" && <p>These source readings include both finished and stopped states. Bookvane will not choose a displayed status at random. You can keep every supplied span as private context, without creating reading records.</p>}<Button variant="secondary" onClick={() => onDecision(row.ordinal, { expected_revision: revision, action: "preserve", history_policy: "context_only", accept_source_update: sourceUpdate })}>Keep source history as context only</Button></>}
      </div>}
      {row.plan?.kind === "existing" && <label className="bv-import-check"><input type="checkbox" checked={addHistory} onChange={event => setAddHistory(event.target.checked)} />Also add clearly separate source readings. Conflicting active or overlapping readings still need review.</label>}
      {["source_record_changed", "source_context_changed_since_preview"].includes(row.error_code) && <label className="bv-import-check"><input type="checkbox" checked={sourceUpdate} onChange={event => setSourceUpdate(event.target.checked)} />Replace only this source’s previously imported context with these incoming source values. Native notes and history stay. If you deleted that context elsewhere, this deliberately restores the incoming text.</label>}
      <Button variant="quiet" onClick={() => onDecision(row.ordinal, { expected_revision: revision, action: "skip" })}>Skip this group</Button>
    </fieldset></details>}
  </article>;
}

function downloadTemplate() {
  const text = 'version,record_id,title,author,isbn13,status,owned,wanted,started_on,finished_on,attempt_id,rating,review,private_note,labels\r\n';
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "bookvane-csv-v1-template.csv";
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function downloadCsv(response, filename, assertCurrent) {
  const blob = await response.blob();
  assertCurrent();
  const declared = Number(response.headers.get("content-length"));
  if (!declared || blob.size !== declared) throw new Error("The CSV download was interrupted. Please retry.");
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export default function LibraryImportPage() {
  const auth = useAuth(), library = useUserBooks();
  if (!library.libraryImport || library.readOnly) return <Navigate to="/my-books" replace />;
  return <ImportSession key={auth.sessionGeneration} />;
}

function ImportSession() {
  const library = useUserBooks();
  const command = useReadingCommand("The import paused. Your committed books are safe. Retry or resume from the saved checkpoint.");
  const controller = useRef(null);
  const lastRequest = useRef({ upload: -Infinity, advance: -Infinity });
  const [recent, setRecent] = useState([]), [run, setRun] = useState(null), [page, setPage] = useState(null);
  const [file, setFile] = useState(null), [encoding, setEncoding] = useState("UTF-8"), [paste, setPaste] = useState("");
  const [inspection, setInspection] = useState(null), [mapping, setMapping] = useState({});
  const [approvePrivate, setApprovePrivate] = useState(false), [acceptWarnings, setAcceptWarnings] = useState(false), [skipUnresolved, setSkipUnresolved] = useState(false);
  const [onlyReview, setOnlyReview] = useState(false), [notice, setNotice] = useState("");
  const [forgetMarkers, setForgetMarkers] = useState(false), [understandsMarkers, setUnderstandsMarkers] = useState(false);
  useEffect(() => {
    const initial = new AbortController();
    imports.recentImports(initial.signal).then(result => setRecent(result.items)).catch(error => {
      if (error.name !== "AbortError") setNotice("Saved imports could not be loaded. You can try again.");
    });
    return () => { initial.abort(); controller.current?.abort(); };
  }, []);
  const terminal = run && ["completed", "completed_with_issues", "cancelled", "expired"].includes(run.phase);
  const signal = () => { controller.current?.abort(); controller.current = new AbortController(); return controller.current.signal; };
  const paced = (kind, operation, assertCurrent, activeSignal) => retry(async () => {
    // Stay below 120/minute instead of creating our own 429s on fast networks.
    await wait(Math.max(0, 550 - (performance.now() - lastRequest.current[kind])), activeSignal);
    assertCurrent();
    lastRequest.current[kind] = performance.now();
    return operation();
  }, activeSignal);
  async function walk(current, assertCurrent, activeSignal) {
    let result = current;
    while (["analyzing", "grouping", "applying"].includes(result.phase)) {
      assertCurrent();
      const applying = result.phase === "applying";
      result = await paced("advance", () => imports.advanceImport(result.id, activeSignal), assertCurrent, activeSignal);
      assertCurrent(); setRun(result);
      if (applying) library.importChanged();
      // Yield for input/paint. Closing the page stops the next request.
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    if (result.phase === "preview_ready" || ["completed", "completed_with_issues"].includes(result.phase)) {
      const preview = await imports.importRows(result.id, 0, false, activeSignal);
      assertCurrent(); setPage(preview); setOnlyReview(false);
    }
    if (["completed", "completed_with_issues"].includes(result.phase)) { library.readingChanged(); setFile(null); setPaste(""); }
    return result;
  }
  async function selectFile(selected) {
    setInspection(null); setMapping({}); setNotice(""); setFile(selected);
    if (!selected) return;
    if (/\.xlsx?$/i.test(selected.name)) {
      setFile(null);
      setNotice("Save or export your spreadsheet as CSV or TSV first. Excel (.xls / .xlsx) files cannot be imported directly.");
      return;
    }
    command.run(async assertCurrent => {
      const activeSignal = signal();
      const headers = await fileHeaders(selected, encoding, activeSignal);
      assertCurrent();
      const checked = await imports.inspectImport(headers, undefined, activeSignal);
      assertCurrent();
      return { ...checked, headers };
    }, setInspection);
  }
  function uploadFile() {
    command.run(async assertCurrent => {
      const activeSignal = signal();
      let current = run?.phase === "uploading" ? run : null;
      const manifest = await streamFile(file, { encoding, signal: activeSignal,
        async onHeaders(headers) {
          assertCurrent();
          const data = { id: current?.id || crypto.randomUUID(), headers,
            ...(current ? { scope: current.scope, mapping: current.upload_config.mapping, status_map: current.upload_config.status_map,
              encoding: current.upload_config.encoding || "UTF-8", source: current.source === "paste" ? "paste" : "auto" }
              : { encoding, mapping: { ...inspection.mapping, ...mapping } }) };
          current = await retry(() => imports.startImport(data, activeSignal), activeSignal);
          assertCurrent(); setRun(current);
        },
        async onBatch(ordinal, rows) {
          assertCurrent();
          const result = await paced("upload", () => imports.uploadImport(current.id, ordinal, rows, activeSignal), assertCurrent, activeSignal);
          assertCurrent(); current = result.status; setRun(current);
          return result;
        } });
      assertCurrent();
      current = await imports.finalizeImport(current.id, manifest, activeSignal);
      assertCurrent(); setRun(current);
      return walk(current, assertCurrent, activeSignal);
    }, setRun);
  }
  function uploadPaste() {
    command.run(async assertCurrent => {
      const activeSignal = signal(), rows = pastedRows(paste), manifest = [];
      let current = await imports.startImport({ id: crypto.randomUUID(), headers: ["title", "author", "isbn13"], source: "paste" }, activeSignal);
      assertCurrent(); setRun(current);
      for (let offset = 0; offset < rows.length; offset += 100) {
        assertCurrent();
        const batch = rows.slice(offset, offset + 100), ordinal = offset / 100;
        const result = await paced("upload", () => imports.uploadImport(current.id, ordinal, batch, activeSignal), assertCurrent, activeSignal);
        assertCurrent(); current = result.status; setRun(current);
        manifest.push({ ordinal, hash: result.batch_hash, length: batch.length });
      }
      current = await imports.finalizeImport(current.id, { row_count: rows.length, batch_count: manifest.length, manifest_hash: await importDigest(manifest) }, activeSignal);
      assertCurrent(); setRun(current);
      return walk(current, assertCurrent, activeSignal);
    }, setRun);
  }
  const progress = run?.phase === "analyzing" ? run.analyze_cursor : run?.phase === "grouping" && !run.rechecking ? run.group_cursor : run?.phase === "uploading" ? run.row_count : null;
  return <section className="bv-container bv-import-page"><div className="bv-narrow">
    <TextLink to="/my-books">Back to My Books</TextLink>
    <PageHeading eyebrow="Your books belong here" title="Bring Your Library">Import many books from a CSV or TSV file, including supported reading history. Preview everything before changing your library.</PageHeading>
    <ImportJourney run={run} />
    <p className="bv-help">Private to you. We’ll ask before adding anything to your library.</p>
    {notice && <p role="status">{notice}</p>}
    {!run && recent.length > 0 && <section className="bv-section"><h2>Saved imports</h2>{recent.map(saved => <Button variant="secondary" key={saved.id} disabled={command.pending} onClick={() => command.run(async () => imports.getImport(saved.id), current => { setRun(current); setPage(null); setFile(null); setInspection(null); if (current.upload_config) setEncoding(current.upload_config.encoding || "UTF-8"); })}>{names[saved.source]} · {phaseLabels[saved.phase]} · {saved.row_count} rows</Button>)}</section>}
    {(!run || run.phase === "uploading") && <>
      <details className="bv-import-export-help"><summary>Get your Goodreads or StoryGraph export</summary><details><summary>Goodreads</summary><p>In My Books, open Import and Export, then Export Library. Save the resulting CSV and return here. Bookvane never asks for your Goodreads login.</p><a className="bv-text-link" href="https://www.goodreads.com/review/import" target="_blank" rel="noopener noreferrer">Open Goodreads Import and Export ↗</a></details>
      <details><summary>StoryGraph</summary><p>In your account menu, open Manage Account, then Export StoryGraph Library. Generate and download your CSV, then return here.</p><a className="bv-text-link" href="https://app.thestorygraph.com/user-export" target="_blank" rel="noopener noreferrer">Open StoryGraph export ↗</a></details>
</details>
      <section className="bv-section"><h2>Choose your library file</h2><p>Use the export from Goodreads, StoryGraph or Bookvane. We recognize the format and show you a preview before adding books.</p>
        <div className="bv-field"><label htmlFor="import-file">Library file (up to 20 MiB / 20,000 rows)</label><input id="import-file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={command.pending} onChange={event => selectFile(event.target.files?.[0])} />
<details className="bv-import-advanced"><summary>Text looks wrong? Check encoding</summary><label htmlFor="import-encoding">Text encoding</label><select id="import-encoding" value={encoding} disabled={command.pending || Boolean(run)} onChange={event => { setEncoding(event.target.value); setInspection(null); setFile(null); }}><option value="UTF-8">UTF-8 (usual)</option><option value="windows-1252">Windows-1252 (only if your export uses it)</option></select>
          </details></div>
        {run?.phase === "uploading" && <p className="bv-notice">To resume, reselect the same file. Every acknowledged batch is checked; a different file cannot replace this import.</p>}
        {inspection && <div className="bv-field"><p>{names[inspection.source]} file ready to check.</p>{Object.entries(inspection.ambiguous).map(([field, columns]) => <div key={field}><label htmlFor={`map-${field}`}>Which column means {readable(field)}?</label><select id={`map-${field}`} value={mapping[field] ?? ""} onChange={event => setMapping(value => ({ ...value, [field]: Number(event.target.value) }))}><option value="" disabled>Choose a column</option>{columns.map(index => <option value={index} key={index}>{inspection.headers[index]}</option>)}</select></div>)}
          {inspection.missing_identity && <><label htmlFor="map-title">Which column contains the book title?</label><select id="map-title" value={mapping.title ?? ""} onChange={event => setMapping(value => ({ ...value, title: Number(event.target.value) }))}><option value="" disabled>Choose a title column</option>{inspection.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></>}
          <Button disabled={command.pending || Object.keys(inspection.ambiguous).some(field => mapping[field] === undefined) || (inspection.missing_identity && mapping.title === undefined)} onClick={uploadFile}>{run ? "Resume upload" : "Check my library"}</Button>
        </div>}
      </section>
      {!run && <details className="bv-section bv-field"><summary>Or paste a book list</summary><label htmlFor="import-paste">One title, title — author, or ISBN per line</label><textarea id="import-paste" rows={6} value={paste} maxLength={480000} disabled={command.pending} onChange={event => setPaste(event.target.value)} placeholder={"A book title\nAnother title — An author"} /><p className="bv-help">Up to 1,000 lines. No reading history will be invented.</p><Button disabled={command.pending || !paste.trim()} onClick={uploadPaste}>Check this list</Button></details>}
    </>}
    {run && <section className="bv-section" aria-busy={command.pending}><h2>{run.phase === "grouping" && run.rechecking ? "Checking your updated decision" : phaseLabels[run.phase] || "Import progress"}</h2><p role="status">{names[run.source]} · {run.row_count} source rows{progress !== null ? ` · ${progress} checked in this phase` : ""}.</p>
      <p className="bv-help">{!terminal && <>Resume until {new Date(run.expires_at).toLocaleDateString()}. </>}Closing this page pauses future work; a batch already in progress may commit. Cancelling stops future batches, it does not undo additions.</p>
      {command.pending ? <Button variant="secondary" onClick={() => { controller.current?.abort(); setNotice("Paused. Return to this saved import to continue."); }}>Pause</Button> : ["analyzing", "grouping", "applying"].includes(run.phase) && <Button onClick={() => command.run(assertCurrent => walk(run, assertCurrent, signal()), setRun)}>Continue</Button>}
      {run.summary?.applied && <p>{run.summary.applied.added_entries || 0} new library entries · {run.summary.applied.added_reads || 0} new historical readings. Source rows, books and readings are different counts.</p>}
      {run.phase === "preview_ready" && <>
        <p>{run.summary?.distinct_targets || 0} distinct proposed book groups · {run.summary?.targets_by_kind?.catalogue || 0} new catalogue entries · {run.summary?.targets_by_kind?.existing || 0} existing entries preserved · {run.summary?.targets_by_kind?.private || 0} private-entry proposals.</p>
        {run.summary?.ignored_columns?.length > 0 && <details><summary>Fields not imported</summary><p>{run.summary.ignored_columns.join(", ")}. These fields remain in your original file, not in Bookvane.</p></details>}
        <p>Your existing Own/Want flags, notes, reactions and reading records stay. Source ratings, reviews and labels are kept separately and privately. Missing works can become private entries, never public catalogue books.</p>
        <Button variant="secondary" disabled={command.pending} onClick={() => command.run(async () => imports.importRows(run.id, 0, !onlyReview), result => { setPage(result); setOnlyReview(value => !value); })}>{onlyReview ? "Show all rows" : "Review exceptions"}</Button>
      </>}
      {!terminal && <Button variant="quiet" disabled={command.pending} onClick={() => command.run(async () => imports.cancelImport(run.id), current => { setRun(current); setPage(null); library.importChanged(); })}>Cancel import</Button>}
      {terminal && <div className="bv-form-actions">{["completed", "completed_with_issues"].includes(run.phase) && <ActionLink to="/home">Go to your reading home</ActionLink>}<ActionLink to="/my-books" variant="secondary">Go to My Books</ActionLink><Button variant="quiet" onClick={() => { setRun(null); setPage(null); setFile(null); setInspection(null); setApprovePrivate(false); setAcceptWarnings(false); setSkipUnresolved(false); }}>Start another import</Button></div>}
      {terminal && <Button variant="secondary" disabled={command.pending} onClick={() => command.run(async assertCurrent => downloadCsv(await imports.exportImportReport(run.id, signal()), "bookvane-import-results.csv", assertCurrent), () => setNotice("Your row-by-row results were downloaded. They contain result codes and entry IDs, not private source text."))}>Download import results</Button>}
    </section>}
    {page && <section className="bv-section"><h2>{run?.phase === "preview_ready" ? "Import preview" : "Row results"}</h2>{page.items.length === 0 ? <p>No rows in this view.</p> : page.items.map(row => <ImportRow key={`${page.revision}:${row.ordinal}`} row={row} revision={page.revision} disabled={command.pending || run?.phase !== "preview_ready"} onDecision={(ordinal, data) => command.run(async assertCurrent => {
      const activeSignal = signal();
      const current = await imports.decideImport(run.id, ordinal, data, activeSignal);
      assertCurrent(); setRun(current); return walk(current, assertCurrent, activeSignal);
    }, setRun)} />)}{page.next_after && <Button variant="secondary" disabled={command.pending} onClick={() => command.run(async () => imports.importRows(run.id, page.next_after, onlyReview), setPage)}>Next rows</Button>}</section>}
    {run?.phase === "preview_ready" && <section className="bv-section bv-import-confirm" aria-label="Confirm your import"><h2>Ready to bring these books home?</h2><p>Review the proposals above, then choose what to include. Your library changes only after you confirm.</p>
        <div className="bv-field"><label className="bv-import-check"><input type="checkbox" checked={approvePrivate} onChange={event => setApprovePrivate(event.target.checked)} disabled={command.pending} />Approve unmatched books as private entries.</label>
          <label className="bv-import-check"><input type="checkbox" checked={acceptWarnings} onChange={event => setAcceptWarnings(event.target.checked)} disabled={command.pending} />Keep unsupported dates, ratings or statuses as source context, without guessing. Identity conflicts still need a decision.</label>
          <label className="bv-import-check"><input type="checkbox" checked={skipUnresolved} onChange={event => setSkipUnresolved(event.target.checked)} disabled={command.pending} />Skip anything still invalid or unresolved; include it in my results.</label></div>
        <div className="bv-form-actions"><Button disabled={command.pending} onClick={() => command.run(async assertCurrent => {
          const activeSignal = signal();
          const current = await imports.confirmImport(run.id, { expected_revision: run.revision, manifest_hash: run.manifest_hash, approve_private: approvePrivate, skip_unresolved: skipUnresolved, accept_warnings: acceptWarnings }, activeSignal);
          assertCurrent(); setRun(current); return walk(current, assertCurrent, activeSignal);
        }, setRun)}>Confirm import</Button></div>
      </section>}
    {command.error && <p className="bv-field-error" role="alert">{command.error}</p>}
    {!run && <section className="bv-section"><h2>Library files and privacy</h2>      <details><summary>Bookvane CSV v1 / another spreadsheet</summary><p>Use ISO dates (YYYY-MM-DD), separate ownership from reading status, and JSON arrays for labels, such as ["favourites","night reading"]. Blank values stay unknown. Stable record and attempt IDs make repeated imports safer. The CSV format is not a full database backup.</p><Button variant="secondary" onClick={downloadTemplate}>Download Bookvane CSV template</Button></details>
      <details><summary>Export my Bookvane library</summary><p>CSV v1 includes book identity, Own/Want, supported reading statuses, dates, copy/page information and reading notes. It is not a full backup: use your private reading-data JSON download for save reasons, reactions, progress, preferences and preserved source context.</p>
        <Button disabled={command.pending} variant="secondary" onClick={() => command.run(async assertCurrent => {
          const response = await imports.exportLibraryCsv(signal());
          await downloadCsv(response, "bookvane-library-v1.csv", assertCurrent);
        }, () => setNotice("Your supported library CSV was downloaded."))}>Download library CSV</Button><TextLink to="/my-data">Private reading-data JSON</TextLink>
      </details>
      <details><summary>Advanced import privacy</summary><p>Deleted books and readings keep minimal replay markers so an old file cannot restore them. Forgetting these markers means a future upload may add those books or readings again.</p><Button variant="quiet" disabled={command.pending} onClick={() => { setForgetMarkers(true); setUnderstandsMarkers(false); }}>Forget removed import markers</Button></details>
    </section>}
    {forgetMarkers && <NativeDialog open title="Forget removed import markers?" onClose={() => { if (!command.pending) setForgetMarkers(false); }}>
      <p>This deletes only replay markers for books and readings you already removed. It does not delete your current books, source context, native history or notes. Later imports may re-add forgotten books or readings, and this cannot be undone.</p>
      <label className="bv-import-check"><input type="checkbox" checked={understandsMarkers} onChange={event => setUnderstandsMarkers(event.target.checked)} />I understand that future uploads may add removed books or readings again.</label>
      <div className="bv-form-actions"><Button variant="secondary" disabled={command.pending} onClick={() => setForgetMarkers(false)}>Keep markers</Button><Button disabled={command.pending || !understandsMarkers} onClick={() => command.run(() => imports.forgetRemovedMarkers(signal()), result => { setForgetMarkers(false); setNotice(`${result.removed_markers} removed-book and ${result.removed_read_markers} removed-reading import markers forgotten.`); })}>Forget removed markers</Button></div>
      {command.error && <p role="alert">{command.error}</p>}
    </NativeDialog>}
  </div></section>;
}
