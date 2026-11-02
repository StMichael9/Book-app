import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../../hooks/useReadingCommand.js";
import * as imports from "../../../api/libraryImports.js";
import { ActionLink, Button, PageHeading, TextLink } from "../../ui-v2/primitives.jsx";
import EnrichmentLine from "./EnrichmentLine.jsx";
import { fileHeaders, streamFile } from "./parsing.js";
import "../../../styles/ui-v2/library-import.css";

const workHeadings = { uploading: "Reading your file", analyzing: "Finding your books", grouping: "Checking for duplicates", applying: "Adding your books", failed: "Import needs attention" };
const endHeadings = { cancelled: "Import stopped", expired: "This import expired" };
const dispositionLabels = { ready: "Ready", approved: "Ready", skipped: "Skipped", applied: "Added", review: "Needs a choice", invalid: "Needs a choice" };
const finished = phase => ["completed", "completed_with_issues"].includes(phase);
const readable = value => value.replaceAll("_", " ");
const books = count => `${count} ${count === 1 ? "book" : "books"}`;

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
    <p className="bv-muted">{source?.author || "Author not supplied"} · {dispositionLabels[row.disposition] || "Needs a choice"}</p>
    {row.plan?.kind === "existing" && <p className="bv-help">Already in My Books. Your existing flags, notes and readings take priority.</p>}
    {proposed && <p className="bv-help">Matches {proposed.title} · {proposed.authors?.join(", ") || "Author not listed"}.</p>}
    {row.plan?.kind === "private" && <p className="bv-help">Will be added as your own entry, private to you.</p>}
    {source?.warnings?.length > 0 && <p className="bv-help">Some values in your file need a look.</p>}
    {source && <details><summary>From your file</summary><dl className="bv-import-context">
      <dt>Owned / Want to read in your file</dt><dd>Owned: {source.is_owned == null ? "unknown" : source.is_owned ? "yes" : "no"} · Want to read: {source.is_wanted == null ? "unknown" : source.is_wanted ? "yes" : "no"}. Unknown does not become an invented preference.</dd>
      {source.status && <><dt>Reading status</dt><dd>{readable(source.status)}</dd></>}
      {source.context?.rating != null && <><dt>Rating in your file</dt><dd>{source.context.rating} / 5</dd></>}
      {source.context?.review && <><dt>Imported review (private)</dt><dd>{source.context.review}</dd></>}
      {source.context?.private_note && <><dt>Imported note (private)</dt><dd>{source.context.private_note}</dd></>}
      {source.context?.labels?.length > 0 && <><dt>Labels in your file (private)</dt><dd>{source.context.labels.join(", ")}</dd></>}
      {source.events?.length > 0 && <><dt>Reading information in your file</dt><dd>{source.events.map(event => `${readable(event.state)}: ${event.started_on || "start unknown"} → ${event.ended_on || "end unknown"}`).join("; ")}</dd></>}
    </dl></details>}
    {["review", "ready", "approved", "invalid"].includes(row.disposition) && <details open={["review", "invalid"].includes(row.disposition)}><summary>{["review", "invalid"].includes(row.disposition) ? "Choose what to do" : "Change this proposal"}</summary><fieldset disabled={disabled} className="bv-field">
      <legend>Your choice for this book</legend>
      {row.candidates?.length > 0 && <><label htmlFor={`import-target-${row.ordinal}`}>Match on Bookvane</label><select id={`import-target-${row.ordinal}`} value={choice} onChange={event => setChoice(event.target.value)}><option value="">Choose a match</option>{row.candidates.map(candidate => <option key={candidate.entry_id ? `entry:${candidate.entry_id}` : candidate.book_id} value={candidate.entry_id ? `entry:${candidate.entry_id}` : `book:${candidate.book_id}`}>{candidate.title} · {candidate.authors?.join(", ") || "Author not listed"}</option>)}</select>
        <Button variant="secondary" disabled={!choice} onClick={() => {
          const [kind, id] = choice.split(":");
          onDecision(row.ordinal, { expected_revision: revision, action: "match", [kind === "entry" ? "entry_id" : "book_id"]: Number(id) });
        }}>Use selected match</Button></>}
      {source && row.plan?.kind !== "removed" && <div className="bv-form-actions">
        {source.title && <Button variant="secondary" onClick={() => onDecision(row.ordinal, { expected_revision: revision, action: "private" })}>Keep as a private book</Button>}
        {["existing", "catalogue", "private"].includes(row.plan?.kind) && <Button variant="secondary" onClick={() => onDecision(row.ordinal, { expected_revision: revision, action: "preserve", history_policy: addHistory ? "add" : "preserve", accept_source_update: sourceUpdate })}>Keep existing data; accept source context</Button>}
        {["existing", "catalogue", "private"].includes(row.plan?.kind) && source.events?.length > 0 && <>{row.error_code === "mixed_terminal_states_require_context_decision" && <p>These source readings include both finished and stopped states. Bookvane will not choose a displayed status at random. You can keep every supplied span as private context, without creating readings.</p>}<Button variant="secondary" onClick={() => onDecision(row.ordinal, { expected_revision: revision, action: "preserve", history_policy: "context_only", accept_source_update: sourceUpdate })}>Keep source history as context only</Button></>}
      </div>}
      {row.plan?.kind === "existing" && <label className="bv-import-check"><input type="checkbox" checked={addHistory} onChange={event => setAddHistory(event.target.checked)} />Also add clearly separate source readings. Conflicting active or overlapping readings still need review.</label>}
      {["source_record_changed", "source_context_changed_since_preview"].includes(row.error_code) && <label className="bv-import-check"><input type="checkbox" checked={sourceUpdate} onChange={event => setSourceUpdate(event.target.checked)} />Replace only this source’s previously imported context with these incoming source values. Native notes and history stay. If you deleted that context elsewhere, this deliberately restores the incoming text.</label>}
      <Button variant="quiet" onClick={() => onDecision(row.ordinal, { expected_revision: revision, action: "skip" })}>Skip this book</Button>
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
  const command = useReadingCommand("Something went wrong on our side. Your library hasn’t changed — try again.");
  const controller = useRef(null);
  const lastRequest = useRef({ upload: -Infinity, advance: -Infinity });
  const [recent, setRecent] = useState([]), [run, setRun] = useState(null), [page, setPage] = useState(null);
  const [file, setFile] = useState(null), [encoding, setEncoding] = useState("UTF-8");
  const [inspection, setInspection] = useState(null), [mapping, setMapping] = useState({});
  const [approvePrivate, setApprovePrivate] = useState(false), [acceptWarnings, setAcceptWarnings] = useState(false), [skipUnresolved, setSkipUnresolved] = useState(false);
  const [onlyReview, setOnlyReview] = useState(false), [notice, setNotice] = useState("");
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
    if (["completed", "completed_with_issues"].includes(result.phase)) { library.readingChanged(); setFile(null); }
    return result;
  }
  // UTF-8 first; if the file is not valid UTF-8 it is read as windows-1252. The reader is never asked.
  async function detectEncoding(selected) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(await selected.arrayBuffer()); return "UTF-8"; }
    catch { return "windows-1252"; }
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
      const detected = run ? encoding : await detectEncoding(selected);
      assertCurrent(); setEncoding(detected);
      const headers = await fileHeaders(selected, detected, activeSignal);
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
          try { current = await retry(() => imports.startImport(data, activeSignal), activeSignal); }
          catch (failure) {
            // An unfinished import already exists (another tab, or an older visit): show it instead of an error.
            if (failure.status !== 409) throw failure;
            const waiting = await imports.recentImports(activeSignal);
            assertCurrent(); setRecent(waiting.items); setFile(null); setInspection(null);
            throw failure;
          }
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
  const [oneClick, setOneClick] = useState(false), [reviewOpen, setReviewOpen] = useState(false), [rowsOpen, setRowsOpen] = useState(false);
  const autoStart = useEffectEvent(() => uploadFile());
  const needsQuestions = Boolean(inspection) && (Object.keys(inspection.ambiguous).length > 0 || inspection.missing_identity);
  // Picking a file starts the check at once; only column questions need an answer first.
  useEffect(() => { if (inspection && !run && !(Object.keys(inspection.ambiguous).length > 0 || inspection.missing_identity)) autoStart(); }, [inspection, run]);
  const summary = run?.summary || {}, kinds = summary.targets_by_kind || {}, dispositions = summary.dispositions || {};
  const needChoice = (dispositions.review || 0) + (dispositions.invalid || 0);
  const startVisible = !run || (run.phase === "uploading" && !command.pending);
  const working = run && !terminal && run.phase !== "preview_ready" && !startVisible;
  const total = run?.row_count || 0;
  const done = run?.phase === "analyzing" ? run.analyze_cursor : run?.phase === "grouping" && !run.rechecking ? run.group_cursor : null;
  const added = summary.applied?.added_entries || 0, skipped = dispositions.skipped || 0;
  const isOpen = item => !["completed", "completed_with_issues", "cancelled", "expired"].includes(item.phase);
  const saved = !run && (recent.find(isOpen) || recent[0]);
  const savedOpen = Boolean(saved) && isOpen(saved);
  const [confirmReset, setConfirmReset] = useState(false);
  const savedDate = saved && (saved.updated_at || saved.created_at) ? new Date(saved.updated_at || saved.created_at).toLocaleDateString() : "";
  // Books the reader removed earlier come back as rows needing a choice; they get their own line, skipped unless asked.
  const [addBack, setAddBack] = useState(false), [removedState, setRemovedState] = useState({ key: "", items: [] });
  const removedKey = run?.phase === "preview_ready" && needChoice > 0 ? `${run.id}:${run.revision}` : "";
  useEffect(() => {
    if (!removedKey) return undefined;
    const controller = new AbortController();
    (async () => {
      const found = [];
      for (let after = 0, pages = 0; pages < 50; pages += 1) {
        const result = await imports.importRows(removedKey.split(":")[0], after, true, controller.signal);
        for (const row of result.items) if (row.plan?.kind === "removed") found.push({ ordinal: row.ordinal, bookId: row.candidates?.find(candidate => candidate.book_id != null && !candidate.entry_id)?.book_id ?? null });
        if (!result.next_after) break;
        after = result.next_after;
      }
      setRemovedState({ key: removedKey, items: found });
    })().catch(() => {});
    return () => controller.abort();
  }, [removedKey]);
  const removedRows = removedState.key === removedKey ? removedState.items : [];
  const cannotAddBack = removedRows.filter(row => row.bookId == null).length;
  const otherChoices = needChoice - removedRows.length;
  const addEverything = flags => command.run(async assertCurrent => {
    const activeSignal = signal();
    let current = run;
    if (addBack) {
      for (const row of removedRows.filter(item => item.bookId != null)) {
        const fresh = await imports.importRows(current.id, 0, true, activeSignal);
        assertCurrent();
        current = await imports.decideImport(current.id, row.ordinal, { expected_revision: fresh.revision, action: "match", book_id: row.bookId }, activeSignal);
        assertCurrent(); setRun(current);
        current = await walk(current, assertCurrent, activeSignal);
      }
    }
    const confirmed = await imports.confirmImport(current.id, { expected_revision: current.revision, manifest_hash: current.manifest_hash, ...flags }, activeSignal);
    assertCurrent(); setRun(confirmed); return walk(confirmed, assertCurrent, activeSignal);
  }, setRun);
  const confirm = flags => command.run(async assertCurrent => {
    const activeSignal = signal();
    const current = await imports.confirmImport(run.id, { expected_revision: run.revision, manifest_hash: run.manifest_hash, ...flags }, activeSignal);
    assertCurrent(); setRun(current); return walk(current, assertCurrent, activeSignal);
  }, setRun);
  const rowList = page && <>{page.items.length === 0 ? <p>No books in this view.</p> : page.items.map(row => <ImportRow key={`${page.revision}:${row.ordinal}`} row={row} revision={page.revision} disabled={command.pending || run?.phase !== "preview_ready"} onDecision={(ordinal, data) => command.run(async assertCurrent => {
    const activeSignal = signal();
    const current = await imports.decideImport(run.id, ordinal, data, activeSignal);
    assertCurrent(); setRun(current); return walk(current, assertCurrent, activeSignal);
  }, setRun)} />)}{page.next_after && <Button variant="secondary" disabled={command.pending} onClick={() => command.run(async () => imports.importRows(run.id, page.next_after, onlyReview), setPage)}>Next rows</Button>}</>;
  return <section className="bv-container bv-import-page"><div className="bv-narrow">
    <TextLink to="/my-books">Back to My Books</TextLink>
    <PageHeading title="Import from Goodreads or StoryGraph">Bring your shelves, reading dates and notes. Everything stays private to you.</PageHeading>
    {notice && <p role="status">{notice}</p>}
    {saved && savedOpen && <div className="bv-import-waiting"><p>{`You have an import${savedDate ? ` from ${savedDate}` : ""} ${saved.phase === "preview_ready" ? "ready to review" : "waiting"}.`}</p>
      {confirmReset ? <><p role="status">Start over? Books already added stay in your library.</p><div className="bv-form-actions"><Button variant="secondary" disabled={command.pending} onClick={() => command.run(async () => { await imports.cancelImport(saved.id); return imports.recentImports(signal()); }, waiting => { setRecent(waiting.items); setConfirmReset(false); library.importChanged(); })}>Yes, start over</Button><Button variant="quiet" disabled={command.pending} onClick={() => setConfirmReset(false)}>Keep it</Button></div></>
        : <div className="bv-form-actions"><Button disabled={command.pending} onClick={() => command.run(async () => imports.getImport(saved.id), current => { setRun(current); setPage(null); setFile(null); setInspection(null); if (current.upload_config) setEncoding(current.upload_config.encoding || "UTF-8"); })}>Continue</Button><Button variant="quiet" disabled={command.pending} onClick={() => setConfirmReset(true)}>Start over</Button></div>}</div>}
    {saved && !savedOpen && <p className="bv-import-saved">{savedOpen ? `You have an import in progress${savedDate ? ` from ${savedDate}` : ""}.` : `Your last import${savedDate ? ` was on ${savedDate}` : ""}.`} <Button variant="quiet" disabled={command.pending} onClick={() => command.run(async () => imports.getImport(saved.id), current => { setRun(current); setPage(null); setFile(null); setInspection(null); if (current.upload_config) setEncoding(current.upload_config.encoding || "UTF-8"); })}>{savedOpen ? "Continue" : "View results"}</Button></p>}
    {startVisible && !(saved && savedOpen) && <>
      <div className="bv-import-sources">
        <article className="bv-import-source"><h2>Goodreads</h2><ol><li>In My Books, open Import and Export.</li><li>Choose Export Library.</li><li>Save the CSV and return here.</li></ol><p className="bv-help">Bookvane never asks for your Goodreads login.</p><a className="bv-text-link" href="https://www.goodreads.com/review/import" target="_blank" rel="noopener noreferrer">Open Goodreads Import and Export ↗</a></article>
        <article className="bv-import-source"><h2>StoryGraph</h2><ol><li>In your account menu, open Manage Account.</li><li>Choose Export StoryGraph Library.</li><li>Generate and download your CSV, then return here.</li></ol><a className="bv-text-link" href="https://app.thestorygraph.com/user-export" target="_blank" rel="noopener noreferrer">Open StoryGraph export ↗</a></article>
      <article className="bv-import-source"><h2>CSV / spreadsheet</h2><p>A Bookvane CSV, or any spreadsheet saved as CSV or TSV. Use dates like 2026-10-29; blank values stay unknown.</p><Button variant="secondary" onClick={downloadTemplate}>Download Bookvane CSV template</Button></article>
      </div>
      <section className="bv-import-file"><div className="bv-field"><label htmlFor="import-file">Choose your export file (.csv)</label><input id="import-file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={command.pending} onChange={event => selectFile(event.target.files?.[0])} />
        <p className="bv-help">Up to 20 MiB or 20,000 rows. You’ll see a summary before anything is added.</p></div>
        {command.pending && !run && <p role="status">Checking your file…</p>}
        {run?.phase === "uploading" && <p className="bv-notice">To carry on, choose the same file again. A different file can’t replace this import.</p>}
        {run?.phase === "uploading" && <Button variant="quiet" disabled={command.pending} onClick={() => command.run(async () => imports.cancelImport(run.id), current => { setRun(current); setPage(null); library.importChanged(); })}>Cancel import</Button>}
        {inspection && (needsQuestions || run) && <div className="bv-field">{needsQuestions && <p>Your file needs a couple of answers first.</p>}{Object.entries(inspection.ambiguous).map(([field, columns]) => <div key={field}><label htmlFor={`map-${field}`}>Which column means {readable(field)}?</label><select id={`map-${field}`} value={mapping[field] ?? ""} onChange={event => setMapping(value => ({ ...value, [field]: Number(event.target.value) }))}><option value="" disabled>Choose a column</option>{columns.map(index => <option value={index} key={index}>{inspection.headers[index]}</option>)}</select></div>)}
          {inspection.missing_identity && <><label htmlFor="map-title">Which column contains the book title?</label><select id="map-title" value={mapping.title ?? ""} onChange={event => setMapping(value => ({ ...value, title: Number(event.target.value) }))}><option value="" disabled>Choose a title column</option>{inspection.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></>}
          <Button disabled={command.pending || Object.keys(inspection.ambiguous).some(field => mapping[field] === undefined) || (inspection.missing_identity && mapping.title === undefined)} onClick={uploadFile}>{run ? "Resume upload" : "Check my library"}</Button>
        </div>}
      </section>
      {!run && <section className="bv-import-choice"><h2>Export my Bookvane library</h2><p>A CSV of your books, shelves, reading statuses, dates and notes. It isn’t a full backup: your private reading-data download has the rest.</p>
        <div className="bv-form-actions"><Button disabled={command.pending} variant="secondary" onClick={() => command.run(async assertCurrent => {
          const response = await imports.exportLibraryCsv(signal());
          await downloadCsv(response, "bookvane-library-v1.csv", assertCurrent);
        }, () => setNotice("Your library CSV was downloaded."))}>Download library CSV</Button><TextLink to="/my-data">Private reading-data download</TextLink></div></section>}
    </>}
    {working && <section className="bv-section" aria-busy={command.pending}><h2>{run.phase === "grouping" && run.rechecking ? "Checking your updated decision" : workHeadings[run.phase] || "Import progress"}</h2>
      {done !== null && total > 0 ? <><p role="status">{done} of {total}</p><progress max={total} value={Math.min(done, total)} aria-label="Import progress" /></> : <><p role="status">{run.phase === "uploading" ? `${total} rows read` : "Working…"}</p><progress aria-label="Import progress" /></>}
      <p className="bv-help">You can pause and come back later. Books already added stay.</p>
      <div className="bv-form-actions">{command.pending ? <Button variant="secondary" onClick={() => { controller.current?.abort(); setNotice("Paused. Return to this saved import to continue."); }}>Pause</Button> : ["analyzing", "grouping", "applying"].includes(run.phase) && <Button onClick={() => command.run(assertCurrent => walk(run, assertCurrent, signal()), setRun)}>Continue</Button>}
        <Button variant="quiet" disabled={command.pending} onClick={() => command.run(async () => imports.cancelImport(run.id), current => { setRun(current); setPage(null); library.importChanged(); })}>Cancel import</Button></div>
    </section>}
    {run?.phase === "preview_ready" && <section className="bv-section bv-import-confirm" aria-busy={command.pending}><h2>Ready to add your books</h2>
      <ul className="bv-import-summary">
        <li>{books(summary.distinct_targets ?? run.row_count)} in your file</li>
        {(kinds.catalogue || 0) > 0 && <li>{kinds.catalogue} found on Bookvane</li>}
        {(kinds.private || 0) > 0 && <li>{kinds.private} added as your own {kinds.private === 1 ? "entry" : "entries"} — private, with your shelves and dates</li>}
        {(kinds.existing || 0) > 0 && <li>{kinds.existing} already in your library, kept as {kinds.existing === 1 ? "it is" : "they are"}</li>}
        {otherChoices > 0 && <li>{otherChoices} {otherChoices === 1 ? "needs" : "need"} a choice from you</li>}
      </ul>
      {summary.ignored_columns?.length > 0 && <details><summary>Fields not imported</summary><p>{summary.ignored_columns.join(", ")}. These fields remain in your original file, not in Bookvane.</p></details>}
      {removedRows.length > 0 && <fieldset className="bv-import-removed" disabled={command.pending}><legend>{removedRows.length === 1 ? "1 book you removed earlier is in this file" : `${removedRows.length} books you removed earlier are in this file`}</legend>
        <label className="bv-import-check"><input type="radio" name="removed-choice" checked={!addBack} onChange={() => setAddBack(false)} />Skip them</label>
        <label className="bv-import-check"><input type="radio" name="removed-choice" checked={addBack} onChange={() => setAddBack(true)} />Add them back</label>
        {addBack && cannotAddBack > 0 && <p className="bv-help">{cannotAddBack} couldn’t be added back.</p>}</fieldset>}
      <div className="bv-form-actions"><Button disabled={command.pending} onClick={() => { setOneClick(true); addEverything({ accept_warnings: true, approve_private: true, skip_unresolved: true }); }}>Add everything I don’t have yet</Button>
        {otherChoices > 0 && <Button variant="secondary" aria-expanded={reviewOpen} disabled={command.pending} onClick={() => reviewOpen ? setReviewOpen(false) : command.run(async () => imports.importRows(run.id, 0, true), result => { setPage(result); setOnlyReview(true); setReviewOpen(true); })}>Review conflicts ({otherChoices})</Button>}
        <Button variant="quiet" disabled={command.pending} onClick={() => command.run(async () => imports.cancelImport(run.id), current => { setRun(current); setPage(null); library.importChanged(); })}>Cancel import</Button></div>
      {reviewOpen && <div className="bv-import-review"><h3>Review conflicts</h3>{rowList}
        <div className="bv-field"><label className="bv-import-check"><input type="checkbox" checked={approvePrivate} onChange={event => setApprovePrivate(event.target.checked)} disabled={command.pending} />Add books I don’t have a match for as my own private entries.</label>
          <label className="bv-import-check"><input type="checkbox" checked={acceptWarnings} onChange={event => setAcceptWarnings(event.target.checked)} disabled={command.pending} />Keep unsupported dates, ratings or statuses as source context, without guessing. Conflicts about which book it is still need a choice.</label>
          <label className="bv-import-check"><input type="checkbox" checked={skipUnresolved} onChange={event => setSkipUnresolved(event.target.checked)} disabled={command.pending} />Skip anything that still needs a choice, and list it in my results.</label></div>
        <div className="bv-form-actions"><Button disabled={command.pending} onClick={() => { setOneClick(false); confirm({ approve_private: approvePrivate, skip_unresolved: skipUnresolved, accept_warnings: acceptWarnings }); }}>Confirm import</Button></div>
      </div>}
    </section>}
    {terminal && <section className="bv-section bv-import-done"><h2>{finished(run.phase) ? `Brought home ${books(added)}.` : endHeadings[run.phase]}</h2>
      {finished(run.phase) && <EnrichmentLine key={run.id} runId={run.id} />}
      {!finished(run.phase) && added > 0 && <p>{books(added)} {added === 1 ? "was" : "were"} added before this stopped. Cancelling does not undo additions.</p>}
      {skipped > 0 && <p>{oneClick ? <>{skipped} left for you to review. <Button variant="quiet" onClick={() => setRowsOpen(true)}>Show them</Button></> : `${skipped} skipped.`}</p>}
      <div className="bv-form-actions">{finished(run.phase) && <ActionLink to="/home">Pick what to read next →</ActionLink>}<ActionLink to="/my-books" variant={finished(run.phase) ? "secondary" : "primary"}>Open My Books</ActionLink></div>
      <div className="bv-form-actions"><Button variant="quiet" disabled={command.pending} onClick={() => command.run(async assertCurrent => downloadCsv(await imports.exportImportReport(run.id, signal()), "bookvane-import-results.csv", assertCurrent), () => setNotice("Your results were downloaded."))}>Download your results (CSV)</Button>
        <Button variant="quiet" onClick={() => { setRun(null); setPage(null); setFile(null); setInspection(null); setApprovePrivate(false); setAcceptWarnings(false); setSkipUnresolved(false); setOneClick(false); setReviewOpen(false); setRowsOpen(false); }}>Start another import</Button></div>
      {page && <details className="bv-import-results" open={rowsOpen} onToggle={event => setRowsOpen(event.currentTarget.open)}><summary>Your results</summary>{rowList}</details>}
    </section>}
    {command.error && !(saved && savedOpen) && <div className="bv-field-error" role="alert"><p>{command.error}</p><Button variant="secondary" disabled={command.pending} onClick={() => { setRun(null); setPage(null); setFile(null); setInspection(null); command.run(() => imports.recentImports(signal()), waiting => setRecent(waiting.items)); }}>Try again</Button></div>}
  </div></section>;
}
