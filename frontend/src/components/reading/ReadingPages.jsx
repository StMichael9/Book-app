import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { createPrivateEntry, createReadingAttempt, ensureLibraryBook, findPrivateMatches, getReadingHistory, getReadingHome, getReadingWorkspace, lookupLibraryBooks, updateLibraryEntry, updateReadingAttempt } from "../../api/reading.js";
import { ActionLink, BookCover, BookSkeletons, Button, EmptyState, PageHeading, TextLink } from "../ui-v2/primitives.jsx";
import { errorText, useRequest } from "../ui-v2/data.js";

const stateLabel = { reading: "Reading", paused: "Paused", finished: "Finished", dnf: "Stopped" };
const displayBook = entry => entry.book || { title: entry.private_title, authors: entry.private_author ? [{ name: entry.private_author }] : [] };
const progressLabel = attempt => attempt.progress_value == null ? "Progress is optional." : attempt.progress_unit === "percent" ? `${attempt.progress_value}%` : `Page ${attempt.progress_value}${attempt.total_pages ? ` of ${attempt.total_pages}` : ""}`;

// Mutations from a departed account must not navigate, publish errors, or
// populate the next account's provider. Retry identifiers stay in page memory.
function useReadingCommand() {
  const auth = useAuth();
  const session = useRef(auth.sessionGeneration);
  const mounted = useRef(true), busy = useRef(false);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  useLayoutEffect(() => {
    session.current = auth.sessionGeneration;
    mounted.current = true;
    return () => { mounted.current = false; };
  }, [auth.sessionGeneration]);
  async function run(operation, accept) {
    if (busy.current) return;
    const generation = session.current;
    const current = () => mounted.current && generation === session.current;
    busy.current = true; setPending(true); setError("");
    try {
      const result = await operation(() => { if (!current()) throw new Error("Account changed"); });
      if (current()) accept(result);
    } catch (failure) {
      if (current()) setError(errorText(failure, "Your reading couldn’t be updated. Please try again."));
    } finally {
      busy.current = false;
      if (current()) setPending(false);
    }
  }
  return { run, pending, error };
}

export function ReadingGate({ children }) {
  const library = useUserBooks();
  if (library.loading) return <section className="bv-container"><BookSkeletons count={3} /></section>;
  if (library.error) return <section className="bv-container"><EmptyState error title="Your reading couldn’t load." action={<Button onClick={library.retryLoad}>Try again</Button>}>Your saved reading is unchanged.</EmptyState></section>;
  if (!library.readingActions) return <Navigate to="/my-books" replace />;
  return children;
}

export function ReadingHomePage() {
  const auth = useAuth(), library = useUserBooks();
  const request = useRequest(getReadingHome, `home:${auth.sessionGeneration}:${library.revision}`);
  return <section className="bv-container bv-reading-home">
    <PageHeading eyebrow="Your personal reading home" title="A little time for your books.">Pick up where you left off, or find your next beginning.</PageHeading>
    <div className="bv-form-actions"><ActionLink to="/browse">Find a book</ActionLink><ActionLink to="/my-books/private" variant="secondary">Add a missing book</ActionLink></div>
    <h2>Your current reading</h2>
    {request.loading ? <BookSkeletons count={3} /> : request.error ? <EmptyState error title="Your reading couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Your books haven’t changed.</EmptyState> : <>
      {request.data.current_reads.length ? <div className="bv-book-grid">{request.data.current_reads.map(({ entry, attempt }) => <article key={entry.id} className="bv-book-card">
        <Link to={`/my-books/${entry.id}`}><BookCover book={displayBook(entry)} /><h3>{displayBook(entry).title}</h3></Link><p className="bv-help">{progressLabel(attempt)}</p><TextLink to={`/my-books/${entry.id}`}>Continue your reading</TextLink>
      </article>)}</div> : <EmptyState title="Your next beginning is yours." action={<ActionLink to="/my-books">Choose from My Books</ActionLink>}>Start any saved book, or discover something new. You don’t need to track pages or write notes.</EmptyState>}
      <div className="bv-form-actions"><TextLink to="/my-books?status=reading">See all current reads ({request.data.reading_count})</TextLink>{request.data.paused_count > 0 && <TextLink to="/my-books?status=paused">Paused books ({request.data.paused_count})</TextLink>}<TextLink to="/my-books?status=want">Your Want books</TextLink></div>
    </>}
  </section>;
}

function ProgressForm({ attempt, version, readOnly, onSaved }) {
  const command = useReadingCommand();
  const [unit, setUnit] = useState(attempt.progress_unit || "");
  const [value, setValue] = useState(attempt.progress_value ?? "");
  const [total, setTotal] = useState(attempt.total_pages ?? "");
  const [started, setStarted] = useState(attempt.started_on || "");
  const [ended, setEnded] = useState(attempt.ended_on || "");
  // Deliberately retain the version with this draft: a conflict must not turn
  // a retry into an unnoticed overwrite of a newer edit on another device.
  const [expectedVersion] = useState(version);
  const terminal = ["finished", "dnf"].includes(attempt.state);
  return <form className="bv-field bv-reading-form" onSubmit={event => {
    event.preventDefault();
    command.run(() => updateReadingAttempt(attempt.id, { expected_version: expectedVersion,
      progress_unit: unit || null, progress_value: unit && value !== "" ? Number(value) : null,
      total_pages: total === "" ? null : Number(total), started_on: started || null, ...(terminal ? { ended_on: ended || null } : {}) }), onSaved);
  }}>
    <fieldset disabled={readOnly || command.pending}><legend>Optional progress and dates</legend>
      <p className="bv-help">Use the page total for your own copy. Blank dates stay unknown. Reaching 100% does not mark a book finished.</p>
      <label htmlFor="reading-unit">Progress</label><select id="reading-unit" value={unit} onChange={event => setUnit(event.target.value)}><option value="">Not tracking</option><option value="pages">Pages</option><option value="percent">Percent</option></select>
      {unit && <><label htmlFor="reading-progress">{unit === "pages" ? "Current page" : "Percent complete"}</label><input id="reading-progress" type="number" min="0" max={unit === "percent" ? 100 : undefined} step="1" required value={value} onChange={event => setValue(event.target.value)} /></>}
      <label htmlFor="reading-total">Total pages (optional)</label><input id="reading-total" type="number" min="1" step="1" value={total} onChange={event => setTotal(event.target.value)} />
      <label htmlFor="reading-started">Started on (optional)</label><input id="reading-started" type="date" value={started} onChange={event => setStarted(event.target.value)} />
      {terminal && <><label htmlFor="reading-ended">Ended on (optional)</label><input id="reading-ended" type="date" value={ended} onChange={event => setEnded(event.target.value)} /></>}
      <Button type="submit">{command.pending ? "Saving…" : "Save progress and dates"}</Button>
    </fieldset>
    {command.error && <p role="alert">{command.error} Your draft is still here. Close and reopen this form to load the current reading before reapplying a conflicting change.</p>}
  </form>;
}

function ReadingHistory({ entry, onCorrect }) {
  const auth = useAuth(), library = useUserBooks();
  const [params, setParams] = useSearchParams();
  const cursor = params.get("history_cursor") || "";
  const request = useRequest(() => getReadingHistory(entry.id, cursor), `history:${auth.sessionGeneration}:${entry.id}:${cursor}:${library.revision}`);
  return <section className="bv-section"><h2>Your reading history</h2>
    {request.loading ? <p role="status">Loading reading history…</p> : request.error ? <EmptyState error title="Your history couldn’t load." action={<><Button onClick={request.retry}>Try again</Button><Button onClick={() => setParams({})} variant="secondary">First readings</Button></>}>Your records haven’t changed.</EmptyState> : <>
      {request.data.items.length ? <ul className="bv-reading-history">{request.data.items.map(attempt => <li key={attempt.id}><strong>{stateLabel[attempt.state]}</strong><span>{attempt.started_on || "Start date unknown"}{attempt.ended_on ? ` → ${attempt.ended_on}` : ""}</span><Button variant="quiet" disabled={library.readOnly} onClick={() => onCorrect(attempt)}>Correct this reading</Button></li>)}</ul> : <p>No reading records on this page.</p>}
      <div className="bv-form-actions">{cursor && <Button variant="secondary" onClick={() => setParams({})}>First readings</Button>}{request.data.next_cursor && <Button variant="secondary" onClick={() => setParams({ history_cursor: request.data.next_cursor })}>Older readings</Button>}</div>
    </>}
  </section>;
}

export function ReadingWorkspacePage() {
  const { entryId } = useParams();
  const auth = useAuth(), library = useUserBooks();
  const request = useRequest(() => getReadingWorkspace(entryId), `workspace:${auth.sessionGeneration}:${entryId}:${library.revision}`);
  const command = useReadingCommand();
  const intent = useRef(null);
  const [editing, setEditing] = useState(null);
  const [editionId, setEditionId] = useState("");
  function accept(result) { library.readingChanged(result.entry); setEditing(null); intent.current = null; }
  function create(entry, state = "reading") {
    const key = `${entry.id}:${state}`;
    if (intent.current?.key !== key) intent.current = { key, id: crypto.randomUUID() };
    command.run(() => createReadingAttempt(intent.current.id, { entry_id: entry.id, expected_version: entry.version, state,
      ...(editionId ? { edition_id: Number(editionId) } : {}) }), accept);
  }
  if (request.loading) return <section className="bv-container"><BookSkeletons count={1} /></section>;
  if (request.error) return <section className="bv-container"><EmptyState error title="This reading couldn’t load." action={<><Button onClick={request.retry}>Try again</Button><ActionLink to="/my-books" variant="secondary">My Books</ActionLink></>}>It may have been removed, or the server may need a moment.</EmptyState></section>;
  const { entry, current_attempt: attempt } = request.data;
  const book = displayBook(entry), terminal = attempt && ["finished", "dnf"].includes(attempt.state);
  const selected = editing || attempt;
  return <section className="bv-container bv-reading-workspace">
    <TextLink to="/my-books">Back to My Books</TextLink><PageHeading eyebrow={entry.book ? "Your reading" : "Private book · only you"} title={book.title}>{book.authors?.map(author => author.name).join(", ") || "Author not listed"}</PageHeading>
    {entry.book && <TextLink to={`/book/${entry.book_id}`}>About this book</TextLink>}
    {library.readOnly && <p role="status" className="bv-notice">Your reading is available to read. Changes are temporarily paused.</p>}
    <div className="bv-form-actions" role="group" aria-label="Your book flags">{[["is_owned", "Own"], ["is_wanted", "Want"]].map(([flag, label]) => <Button key={flag} variant={entry[flag] ? "saved" : "secondary"} aria-pressed={entry[flag]} disabled={library.readOnly || command.pending} onClick={() => command.run(async () => ({ entry: await updateLibraryEntry(entry.id, { [flag]: !entry[flag], expected_version: entry.version }) }), accept)}>{label}</Button>)}</div>
    <div className="bv-reading-status"><h2>{attempt ? stateLabel[attempt.state] : "A new beginning"}</h2>{attempt && <p>{progressLabel(attempt)}</p>}</div>
    {(!attempt || terminal) && request.data.editions.length > 0 && <details className="bv-field"><summary>Choose an edition (optional)</summary><label htmlFor="reading-edition">Your copy for the new reading</label><select id="reading-edition" value={editionId} disabled={library.readOnly} onChange={event => { setEditionId(event.target.value); intent.current = null; }}><option value="">Catalogue preferred edition</option>{request.data.editions.map(edition => <option key={edition.id} value={edition.id}>{edition.physical_format || "Edition"}{edition.page_count ? ` · ${edition.page_count} pages` : ""} · {(edition.languages || []).join(", ") || "Language not listed"}</option>)}</select><p className="bv-help">Saved progress keeps this copy’s page total even if catalogue metadata changes.</p></details>}
    <div className="bv-form-actions">
      {(!attempt || terminal) && <Button disabled={library.readOnly || command.pending} onClick={() => create(entry)}>{terminal ? "Start reading again" : "Start reading"}</Button>}
      {attempt && <>{[...(attempt.state === "reading" ? [["paused", "Pause reading"]] : attempt.state === "paused" ? [["reading", "Resume reading"]] : []), ...(!terminal ? [["finished", "Finish book"], ["dnf", "Stop reading"]] : [["reading", "Reopen this reading"]])].map(([state, label]) => <Button key={label} variant="secondary" disabled={library.readOnly || command.pending} onClick={() => command.run(() => updateReadingAttempt(attempt.id, { expected_version: entry.version, state }), accept)}>{label}</Button>)}</>}
      {(!attempt || terminal) && <><Button variant="secondary" disabled={library.readOnly || command.pending} onClick={() => create(entry, "finished")}>Record a past finish</Button><Button variant="quiet" disabled={library.readOnly || command.pending} onClick={() => create(entry, "dnf")}>Record a past stop</Button></>}
      {attempt && <Button variant="quiet" disabled={library.readOnly || command.pending} onClick={() => setEditing(attempt)}>Edit progress or dates</Button>}
    </div>
    {command.error && <p role="alert" className="bv-notice">{command.error} <Button variant="quiet" onClick={request.retry}>Reload current reading</Button></p>}
    {editing && selected && <><ProgressForm key={`${selected.id}:${entryId}`} attempt={selected} version={entry.version} readOnly={library.readOnly} onSaved={accept} /><Button variant="quiet" onClick={() => { setEditing(null); request.retry(); }}>Close editor and reload</Button>
      {["finished", "dnf"].includes(selected.state) && selected.id !== attempt?.id && <Button disabled={library.readOnly || command.pending} onClick={() => command.run(() => updateReadingAttempt(selected.id, { expected_version: entry.version, state: "reading" }), accept)}>Reopen selected reading</Button>}</>}
    {terminal && <p className="bv-help">This reading is saved. Start again for a new read, or reopen to correct this same record. Choosing your next book is always up to you.</p>}
    <ReadingHistory entry={entry} onCorrect={setEditing} />
  </section>;
}

export function PrivateBookPage() {
  const go = useNavigate(), library = useUserBooks(), command = useReadingCommand();
  const [title, setTitle] = useState(""), [author, setAuthor] = useState(""), [matches, setMatches] = useState(null);
  const intent = useRef(null);
  function submit(confirmed = false) {
    const values = { title: title.trim(), author: author.trim() || null };
    const key = JSON.stringify(values);
    if (intent.current?.key !== key) intent.current = { key, id: crypto.randomUUID() };
    command.run(async assertCurrent => {
      if (!confirmed) { const found = await findPrivateMatches(values.title); assertCurrent(); if (found.items.length) return { matches: found.items }; }
      assertCurrent();
      return { entry: await createPrivateEntry({ ...values, request_id: intent.current.id }) };
    }, result => {
      if (result.matches) setMatches(result.matches);
      else { library.readingChanged(result.entry); go(`/my-books/${result.entry.id}`); }
    });
  }
  return <section className="bv-container bv-private-entry"><PageHeading eyebrow="Only in your library" title="Make room for a missing book.">This private entry won’t change the shared catalogue. Covers are supplied by the catalogue, not uploaded.</PageHeading>
    <form className="bv-field bv-reading-form" onSubmit={event => { event.preventDefault(); submit(); }}><fieldset disabled={library.readOnly || command.pending}><legend>Book details</legend>
      <label htmlFor="private-title">Title</label><input id="private-title" required maxLength={500} value={title} onChange={event => { setTitle(event.target.value); setMatches(null); }} />
      <label htmlFor="private-author">Author (optional)</label><input id="private-author" maxLength={500} value={author} onChange={event => { setAuthor(event.target.value); setMatches(null); }} />
      <Button type="submit">{command.pending ? "Checking…" : "Add private book"}</Button></fieldset></form>
    {matches && <section className="bv-notice"><h2>A title like this is already in your library.</h2><p>Names are not identities. Open an existing entry, or create a separate one if this is a different book.</p><ul>{matches.map(entry => <li key={entry.id}><TextLink to={`/my-books/${entry.id}`}>{entry.private_title}{entry.private_author ? ` · ${entry.private_author}` : ""}</TextLink></li>)}</ul><Button disabled={library.readOnly || command.pending} onClick={() => submit(true)}>Create a separate private book</Button></section>}
    {command.error && <p role="alert">{command.error}</p>}<TextLink to="/my-books">Back to My Books</TextLink>
  </section>;
}

// Explicit deep links preserve a guest's start intent through authentication.
// Off/old backends are gated before this component can issue any command.
export function StartReadingPage() {
  const { bookId } = useParams();
  const go = useNavigate(), library = useUserBooks(), command = useReadingCommand();
  const identity = useRef(crypto.randomUUID());
  const started = useRef(false);
  const begin = () => command.run(async assertCurrent => {
    const lookup = (await lookupLibraryBooks([Number(bookId)])).items[0];
    assertCurrent();
    let workspace;
    if (lookup.entry_id) workspace = await getReadingWorkspace(lookup.entry_id);
    else {
      const saved = await ensureLibraryBook(Number(bookId), { is_wanted: false });
      assertCurrent();
      workspace = await getReadingWorkspace(saved.id);
    }
    assertCurrent();
    const entry = workspace.entry;
    // A deep link opens existing history; only an explicit Start again in the
    // workspace may create a reread of an already recorded book.
    if (workspace.current_attempt) return { entry };
    return createReadingAttempt(identity.current, { entry_id: entry.id, expected_version: entry.version, started_via: "discovery" });
  }, result => { library.readingChanged(result.entry); go(`/my-books/${result.entry.id}`, { replace: true }); });
  const beginCurrent = useEffectEvent(begin);
  useEffect(() => { if (!started.current && !library.readOnly) { started.current = true; beginCurrent(); } }, [library.readOnly]);
  return <section className="bv-container"><PageHeading title={library.readOnly ? "Reading changes are paused." : "Opening your reading…"} />{command.error && <><p role="alert">{command.error}</p><Button disabled={command.pending} onClick={begin}>Try starting again</Button></>}<TextLink to="/my-books">Back to My Books</TextLink></section>;
}
