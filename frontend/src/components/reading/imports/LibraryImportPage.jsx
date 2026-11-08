import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../../hooks/useReadingCommand.js";
import * as imports from "../../../api/libraryImports.js";
import { ActionLink, BookCover, Button, PageHeading, TextLink } from "../../ui-v2/primitives.jsx";
import EnrichmentLine from "./EnrichmentLine.jsx";
import { fileHeaders, streamFile } from "./parsing.js";
import "../../../styles/ui-v2/library-import.css";

const workHeadings = { uploading: "Reading your file", analyzing: "Finding your books", grouping: "Checking matches", applying: "Adding your books", failed: "Import needs attention" };
const endHeadings = { cancelled: "Import stopped", expired: "This import expired" };
const dispositionLabels = { ready: "Ready", approved: "Ready", skipped: "Skipped", applied: "Added", review: "Needs a quick pick", invalid: "Needs a quick pick" };
const sourceNames = { goodreads: "Goodreads", storygraph: "StoryGraph" }; // anything else is "file’s"
const WARNING_TEXT = { unparsed_started_on: "We couldn’t read the start date in your file.", unparsed_finished_on: "We couldn’t read the finish date in your file.", inverted_dates: "Your file has a finish date before the start date.", unmapped_status: "We didn’t recognise the reading status in your file.", invalid_rating: "We couldn’t read the rating in your file.", invalid_isbn: "We couldn’t read the ISBN in your file." };
const shortDate = value => { const date = value ? new Date(`${value}T00:00:00`) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""; };
const statusWords = { reading: "reading", paused: "paused", finished: "finished", dnf: "stopped" };
// Names what the file disagrees about, with both values. Only values the reader already has count: an empty one is filled from the file.
function clashText(row) {
  const found = (row.plan?.differences || []).find(item => item.existing != null && item.existing !== "");
  if (!found) return "";
  if (found.field === "status") return `Your file says ${statusWords[found.file] || found.file}; Bookvane has ${statusWords[found.existing] || found.existing}.`;
  const mine = shortDate(found.file), theirs = shortDate(found.existing);
  if (!mine || !theirs) return "";
  return `Your file says ${found.field === "started_on" ? "started" : "finished"} ${mine}; Bookvane has ${theirs}.`;
}

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

function ImportRow({ row, revision, disabled, onDecision, sourceName }) {
  const source = row.source;
  const warnings = (source?.warnings || []).map(code => WARNING_TEXT[code]).filter(Boolean);
  const clash = clashText(row);
  const proposed = row.candidates?.find(candidate => candidate.book_id === row.plan?.book_id && candidate.book_id != null);
  const asking = ["review", "invalid"].includes(row.disposition) && row.plan?.kind !== "removed";
  // One question at a time: which book it is comes first; dates are only asked about once the book is settled.
  const tie = asking && (row.candidates?.length || 0) >= 2 && !row.decision;
  const library = ["existing", "catalogue"].includes(row.plan?.kind);
  const mixed = row.error_code === "mixed_terminal_states_require_context_decision";
  const decide = data => onDecision(row.ordinal, { expected_revision: revision, ...data });
  const title = source?.title || proposed?.title || (source?.isbns?.join(", ") || `Row ${row.ordinal}`);
  return <article className="bv-import-row">
    <h3>{title}</h3>
    <p className="bv-muted">{source?.author || "Author not supplied"} · {dispositionLabels[row.disposition] || "Needs a quick pick"}</p>
    {!asking && row.plan?.kind === "existing" && <p className="bv-help">Already in My Books. Your existing flags, notes and readings take priority.</p>}
    {!asking && proposed && <p className="bv-help">Matches {proposed.title} · {proposed.authors?.join(", ") || "Author not listed"}.</p>}
    {!asking && row.plan?.kind === "private" && <p className="bv-help">Will be added as your own book.</p>}
    {!asking && warnings.map(text => <p key={text} className="bv-help">{text}</p>)}
    {tie && <><p className="bv-import-pick-label">Which {title} is yours?</p><ul className="bv-import-candidates">{row.candidates.map(candidate => {
      const kind = candidate.entry_id ? "entry" : "book", id = candidate.entry_id || candidate.book_id;
      return <li key={`${kind}:${id}`}><button type="button" className="bv-import-candidate" disabled={disabled} onClick={() => decide({ action: "match", [kind === "entry" ? "entry_id" : "book_id"]: Number(id) })}>
        <BookCover book={{ id: candidate.book_id ?? id, title: candidate.title, cover_image_url: candidate.cover_image_url, authors: (candidate.authors || []).map(name => ({ name })) }} />
        <span><strong>{candidate.title}</strong><span>{candidate.authors?.join(", ") || "Author not listed"}</span>{candidate.published_year != null && <span>{candidate.published_year}</span>}</span></button></li>;
    })}</ul>
      {source?.title && <Button variant="quiet" disabled={disabled} onClick={() => decide({ action: "private" })}>None of these: add as my own book</Button>}</>}
    {asking && !tie && <>
      {mixed && <p className="bv-help">Your file says this book was both finished and stopped.</p>}
      {!mixed && clash && <p className="bv-help">{clash}</p>}
      {warnings.map(text => <p key={text} className="bv-help">{text}</p>)}
      <div className="bv-form-actions">
        {library && mixed && <Button variant="secondary" disabled={disabled} onClick={() => decide({ action: "preserve", history_policy: "context_only", accept_source_update: false })}>Keep what’s in Bookvane</Button>}
        {library && !mixed && clash && <><Button variant="secondary" disabled={disabled} onClick={() => decide({ action: "preserve", history_policy: "add", accept_source_update: true })}>Add my {sourceName} reads too</Button>
          <Button variant="secondary" disabled={disabled} onClick={() => decide({ action: "preserve", history_policy: "preserve", accept_source_update: false })}>Keep what’s in Bookvane</Button></>}
        {library && !mixed && !clash && <Button variant="secondary" disabled={disabled} onClick={() => decide({ action: "preserve", history_policy: "preserve", accept_source_update: false })}>Keep what’s in Bookvane</Button>}
        {!library && source?.title && <Button variant="secondary" disabled={disabled} onClick={() => decide({ action: "private" })}>Add as my own book</Button>}
      </div></>}
    {asking && <Button variant="quiet" disabled={disabled} onClick={() => decide({ action: "skip" })}>Skip this book</Button>}
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
  const summary = run?.summary || {}, dispositions = summary.dispositions || {};
  const needChoice = (dispositions.review || 0) + (dispositions.invalid || 0);
  const startVisible = !run || (run.phase === "uploading" && !command.pending);
  const working = run && !terminal && run.phase !== "preview_ready" && !startVisible;
  const total = run?.row_count || 0;
  const added = summary.applied?.added_entries || 0, skipped = dispositions.skipped || 0;
  // Books the one-click finish passed over are skipped for good, so say which, and how to get them.
  const skippedTitles = (page?.items || []).filter(row => row.disposition === "skipped").map(row => row.source?.title).filter(Boolean);
  const notAdded = `${skipped} ${skipped === 1 ? "book wasn’t" : "books weren’t"} added${skippedTitles.length ? `: ${skippedTitles.slice(0, 3).join(", ")}${skipped > 3 ? ` and ${skipped - 3} more` : ""}` : ""}. Import the file again to choose ${skipped === 1 ? "it" : "them"}.`;
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
  // The server counts every row once, so the parts add up to the total. Rows the reader removed earlier sit in needs_choice and get their own line.
  const counts = summary.counts || {}, removedLine = Math.min(removedRows.length, counts.needs_choice || 0), pickLine = (counts.needs_choice || 0) - removedLine;
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
  const rowList = page && <>{page.items.length === 0 ? <p>No books in this view.</p> : page.items.map(row => <ImportRow key={`${page.revision}:${row.ordinal}`} sourceName={sourceNames[run?.source] || "file’s"} row={row} revision={page.revision} disabled={command.pending || run?.phase !== "preview_ready"} onDecision={(ordinal, data) => command.run(async assertCurrent => {
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
        <p className="bv-help">Up to 20,000 books. You’ll see a summary before anything is added.</p></div>
        {command.pending && !run && <p role="status">Checking your file…</p>}
        {run?.phase === "uploading" && <p className="bv-notice">To carry on, choose the same file again. A different file can’t replace this import.</p>}
        {run?.phase === "uploading" && <Button variant="quiet" disabled={command.pending} onClick={() => command.run(async () => imports.cancelImport(run.id), current => { setRun(current); setPage(null); library.importChanged(); })}>Cancel import</Button>}
        {inspection && (needsQuestions || run) && <div className="bv-field">{needsQuestions && <p>Your file needs a couple of answers first.</p>}{Object.entries(inspection.ambiguous).map(([field, columns]) => <div key={field}><label htmlFor={`map-${field}`}>Which column means {readable(field)}?</label><select id={`map-${field}`} value={mapping[field] ?? ""} onChange={event => setMapping(value => ({ ...value, [field]: Number(event.target.value) }))}><option value="" disabled>Choose a column</option>{columns.map(index => <option value={index} key={index}>{inspection.headers[index]}</option>)}</select></div>)}
          {inspection.missing_identity && <><label htmlFor="map-title">Which column contains the book title?</label><select id="map-title" value={mapping.title ?? ""} onChange={event => setMapping(value => ({ ...value, title: Number(event.target.value) }))}><option value="" disabled>Choose a title column</option>{inspection.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></>}
          <Button disabled={command.pending || Object.keys(inspection.ambiguous).some(field => mapping[field] === undefined) || (inspection.missing_identity && mapping.title === undefined)} onClick={uploadFile}>{run ? "Resume upload" : "Check my library"}</Button>
        </div>}
      </section>
      {!run && <p className="bv-import-choice"><TextLink to="/my-data">Download your data</TextLink></p>}
    </>}
    {working && <section className="bv-section" aria-busy={command.pending}><h2>{run.phase === "grouping" && run.rechecking ? "Checking your updated decision" : workHeadings[run.phase] || "Import progress"}</h2>
      {run.phase === "analyzing" && run.analyze_cursor > 0 && total > 0 ? <><p role="status">Found {Math.min(run.analyze_cursor, total)} of {total} books</p><progress max={total} value={Math.min(run.analyze_cursor, total)} aria-label="Import progress" /></>
        : <><p role="status">{run.phase === "grouping" ? "Checking matches…" : run.phase === "applying" ? "Adding your books…" : "Looking up your books…"}</p><progress aria-label="Import progress" /></>}
      <div className="bv-form-actions">{command.pending ? <Button variant="secondary" onClick={() => { controller.current?.abort(); setNotice("Paused. Return to this saved import to continue."); }}>Pause</Button> : ["analyzing", "grouping", "applying"].includes(run.phase) && <Button onClick={() => command.run(assertCurrent => walk(run, assertCurrent, signal()), setRun)}>Continue</Button>}
        <Button variant="quiet" disabled={command.pending} onClick={() => command.run(async () => imports.cancelImport(run.id), current => { setRun(current); setPage(null); library.importChanged(); })}>Cancel import</Button></div>
    </section>}
    {run?.phase === "preview_ready" && <section className="bv-section bv-import-confirm" aria-busy={command.pending}><h2>Ready to add your books</h2>
      <ul className="bv-import-summary">
        <li>{books(counts.total ?? run.row_count)} in your file</li>
        {counts.matched > 0 && <li>{counts.matched} found on Bookvane</li>}
        {counts.private > 0 && <li>{counts.private} added as your own {counts.private === 1 ? "book" : "books"}</li>}
        {pickLine > 0 && <li>{pickLine} {pickLine === 1 ? "needs" : "need"} a quick pick</li>}
        {removedLine > 0 && <li>{removedLine} you removed earlier</li>}
        {counts.duplicates > 0 && <li>{counts.duplicates} already in your library</li>}
        {counts.skipped > 0 && <li>{counts.skipped} skipped</li>}
      </ul>
      {removedRows.length > 0 && <fieldset className="bv-import-removed" disabled={command.pending}><legend>{removedRows.length === 1 ? "1 book you removed earlier is in this file" : `${removedRows.length} books you removed earlier are in this file`}</legend>
        <label className="bv-import-check"><input type="radio" name="removed-choice" checked={!addBack} onChange={() => setAddBack(false)} />Skip them</label>
        <label className="bv-import-check"><input type="radio" name="removed-choice" checked={addBack} onChange={() => setAddBack(true)} />Add them back</label>
        {addBack && cannotAddBack > 0 && <p className="bv-help">{cannotAddBack} couldn’t be added back.</p>}</fieldset>}
      <div className="bv-form-actions"><Button disabled={command.pending} onClick={() => { setOneClick(!reviewOpen); addEverything({ accept_warnings: true, approve_private: true, skip_unresolved: true }); }}>Add my books</Button>
        {otherChoices > 0 && <Button variant="secondary" aria-expanded={reviewOpen} disabled={command.pending} onClick={() => reviewOpen ? setReviewOpen(false) : command.run(async () => imports.importRows(run.id, 0, true), result => { setPage(result); setOnlyReview(true); setReviewOpen(true); })}>{reviewOpen ? "Hide the list" : `Review ${otherChoices} ${otherChoices === 1 ? "book" : "books"} first`}</Button>}
        <Button variant="quiet" disabled={command.pending} onClick={() => command.run(async () => imports.cancelImport(run.id), current => { setRun(current); setPage(null); library.importChanged(); })}>Cancel import</Button></div>
      {reviewOpen && <div className="bv-import-review"><h3>Books to check</h3>{rowList}</div>}
    </section>}
    {terminal && <section className="bv-section bv-import-done"><h2>{finished(run.phase) ? `Brought home ${books(added)}.` : endHeadings[run.phase]}</h2>
      {finished(run.phase) && <EnrichmentLine key={run.id} runId={run.id} />}
      {!finished(run.phase) && added > 0 && <p>{books(added)} {added === 1 ? "was" : "were"} added before this stopped. Cancelling does not undo additions.</p>}
      {skipped > 0 && <p>{oneClick ? notAdded : `${skipped} skipped.`}</p>}
      <div className="bv-form-actions">{finished(run.phase) && <ActionLink to="/home">Pick what to read next →</ActionLink>}<ActionLink to="/my-books" variant={finished(run.phase) ? "secondary" : "primary"}>Open My Books</ActionLink></div>
      <div className="bv-form-actions"><Button variant="quiet" disabled={command.pending} onClick={() => command.run(async assertCurrent => downloadCsv(await imports.exportImportReport(run.id, signal()), "bookvane-import-results.csv", assertCurrent), () => setNotice("Your results were downloaded."))}>Download your results (CSV)</Button>
        <Button variant="quiet" onClick={() => { setRun(null); setPage(null); setFile(null); setInspection(null); setOneClick(false); setReviewOpen(false); setRowsOpen(false); }}>Start another import</Button></div>
      {page && <details className="bv-import-results" open={rowsOpen} onToggle={event => setRowsOpen(event.currentTarget.open)}><summary>Your results</summary>{rowList}</details>}
    </section>}
    {command.error && !(saved && savedOpen) && <div className="bv-field-error" role="alert"><p>{command.error}</p><Button variant="secondary" disabled={command.pending} onClick={() => { setRun(null); setPage(null); setFile(null); setInspection(null); command.run(() => imports.recentImports(signal()), waiting => setRecent(waiting.items)); }}>Try again</Button></div>}
  </div></section>;
}
