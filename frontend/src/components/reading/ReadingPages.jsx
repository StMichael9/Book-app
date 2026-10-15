import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { createPrivateEntry, createReadingAttempt, ensureLibraryBook, findPrivateMatches, getReadingAttempt, getReadingHistory, getReadingHome, getReadingWorkspace, lookupLibraryBooks, updateLibraryEntry, updateReadingAttempt } from "../../api/reading.js";
import { ActionLink, BookCover, BookSkeletons, Button, EmptyState, PageHeading, TextLink } from "../ui-v2/primitives.jsx";
import { useRequest } from "../ui-v2/data.js";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { ReadingRemovalDialog } from "./ReadingDataControls.jsx";

const stateLabel = { reading: "Reading", paused: "Paused", finished: "Finished", dnf: "Stopped" };
const reactionLabel = { loved: "Loved it", liked: "Liked it", not_for_me: "Not for me" };
const displayBook = entry => entry.book || { title: entry.private_title, authors: entry.private_author ? [{ name: entry.private_author }] : [] };
const progressLabel = attempt => attempt.progress_value == null ? "Progress is optional." : attempt.progress_unit === "percent" ? `${attempt.progress_value}%` : `Page ${attempt.progress_value}${attempt.total_pages ? ` of ${attempt.total_pages}` : ""}`;

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
    <div className="bv-form-actions"><ActionLink to="/browse">Find a book</ActionLink>{!library.readOnly && <ActionLink to="/my-books/private" variant="secondary">Add a missing book</ActionLink>}</div>
    {library.readOnly && <p role="status" className="bv-notice">Your library is available to read. Changes are temporarily paused.</p>}
    <h2>Your current reading</h2>
    {request.loading ? <BookSkeletons count={3} /> : request.error ? <EmptyState error title="Your reading couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Your books haven’t changed.</EmptyState> : <>
      {request.data.current_reads.length ? <div className="bv-book-grid">{request.data.current_reads.map(({ entry, attempt }) => <article key={entry.id} className="bv-book-card">
        <Link to={`/my-books/${entry.id}`}><BookCover book={displayBook(entry)} /><h3>{displayBook(entry).title}</h3></Link><p className="bv-help">{progressLabel(attempt)}</p><TextLink to={`/my-books/${entry.id}`}>Continue your reading</TextLink>
      </article>)}</div> : <EmptyState title="Your next beginning is yours." action={<ActionLink to="/my-books">Choose from My Books</ActionLink>}>Start any saved book, or discover something new. You don’t need to track pages or write notes.</EmptyState>}
      <div className="bv-form-actions"><TextLink to="/my-books?status=reading">See all current reads ({request.data.reading_count})</TextLink>{request.data.paused_count > 0 && <TextLink to="/my-books?status=paused">Paused books ({request.data.paused_count})</TextLink>}<TextLink to="/my-books?status=want">Your Want books</TextLink></div>
    </>}
  </section>;
}

function ReadingDraftIdentity({ attempt }) {
  const heading = useRef(null);
  // An editor opened from history sits above its trigger. Move keyboard and
  // screen-reader focus once, without stealing it again on a flag refetch.
  useEffect(() => { heading.current?.focus(); }, []);
  return <div><h2 ref={heading} tabIndex={-1}>Selected reading</h2>
    <p className="bv-help">{stateLabel[attempt.state]} · {attempt.started_on || "Start date unknown"}{attempt.ended_on ? ` → ${attempt.ended_on}` : ""}</p>
  </div>;
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
    <ReadingDraftIdentity attempt={attempt} />
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

function ContextForm({ draft, readOnly, onSaved }) {
  const command = useReadingCommand();
  const isReason = draft.kind === "save_note";
  const [text, setText] = useState((isReason ? draft.entry.save_note : draft.attempt.note) || "");
  const [reaction, setReaction] = useState(draft.attempt?.reaction || "");
  return <form className="bv-field bv-reading-form" onSubmit={event => {
    event.preventDefault();
    command.run(async () => isReason ? { entry: await updateLibraryEntry(draft.entry.id, {
      expected_version: draft.version, save_note: text || null }) } : await updateReadingAttempt(draft.attempt.id, {
      expected_version: draft.version, note: text || null, reaction: reaction || null }), onSaved);
  }}>
    {!isReason && <ReadingDraftIdentity attempt={draft.attempt} />}
    {readOnly && !isReason && !text && !reaction && <p className="bv-help">No note or reaction is saved for this reading. Changes are temporarily paused.</p>}
    <fieldset disabled={readOnly || command.pending}><legend>{isReason ? "Why I saved this book" : "My reading memory"}</legend>
      <p className="bv-help">Optional and private. Plain text only; nothing here is a public review. Emptying a field clears it when you save.</p>
      <label htmlFor="reading-context">{isReason ? "Save reason (optional)" : "Where I left off / what I want to remember (optional)"}</label>
      <textarea id="reading-context" rows={4} maxLength={isReason ? 500 : 2000} value={text} onChange={event => setText(event.target.value)} />
      <small>{text.length} / {isReason ? 500 : 2000}</small>
      {!isReason && <><label htmlFor="reading-reaction">Reaction (optional)</label><select id="reading-reaction" value={reaction} onChange={event => setReaction(event.target.value)}><option value="">No reaction</option>{Object.entries(reactionLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></>}
      <Button type="submit">{command.pending ? "Saving…" : isReason ? "Save reason" : "Save reading memory"}</Button>
    </fieldset>
    {command.error && <p role="alert">{command.error} Your draft is still here. Close and reload before reapplying a conflicting edit.</p>}
  </form>;
}

function ReadingHistory({ entry, onCorrect, onMemory, onRemove, editing }) {
  const auth = useAuth(), library = useUserBooks();
  const [params, setParams] = useSearchParams();
  const cursor = params.get("history_cursor") || "";
  const request = useRequest(() => getReadingHistory(entry.id, cursor), `history:${auth.sessionGeneration}:${entry.id}:${cursor}:${library.revision}`);
  return <section className="bv-section"><h2>Your reading history</h2>
    {request.loading ? <p role="status">Loading reading history…</p> : request.error ? <EmptyState error title="Your history couldn’t load." action={<><Button onClick={request.retry}>Try again</Button><Button onClick={() => setParams({})} variant="secondary">First readings</Button></>}>Your records haven’t changed.</EmptyState> : <>
      {request.data.items.length ? <ul className="bv-reading-history">{request.data.items.map(attempt => <li key={attempt.id}><strong>{stateLabel[attempt.state]}</strong><span>{attempt.started_on || "Start date unknown"}{attempt.ended_on ? ` → ${attempt.ended_on}` : ""}</span><Button variant="quiet" disabled={library.readOnly || editing} onClick={() => onCorrect(attempt)}>Correct this reading</Button>{library.privateContext && <Button variant="quiet" disabled={editing} onClick={() => onMemory(attempt)}>{library.readOnly ? "View reading memory" : "Note and reaction"}</Button>}{library.privacyControls && <Button variant="quiet" disabled={library.readOnly || editing} onClick={() => onRemove(attempt)}>Delete this reading record</Button>}</li>)}</ul> : <p>No reading records on this page.</p>}
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
  const [removal, setRemoval] = useState(null);
  const [editionId, setEditionId] = useState("");
  function accept(result) { library.readingChanged(result.entry); setEditing(null); intent.current = null; }
  function create(entry, state = "reading") {
    const key = `${entry.id}:${state}`;
    if (intent.current?.key !== key) intent.current = { key, id: crypto.randomUUID() };
    command.run(() => createReadingAttempt(intent.current.id, { entry_id: entry.id, expected_version: entry.version, state,
      ...(editionId ? { edition_id: Number(editionId) } : {}) }), accept);
  }
  const entry = request.data?.entry, attempt = request.data?.current_attempt;
  const book = entry ? displayBook(entry) : null, terminal = attempt && ["finished", "dnf"].includes(attempt.state);
  const selected = editing?.attempt;
  const openEditor = attempt => setEditing({ kind: "progress", attempt, version: entry.version });
  function openMemory(attempt) {
    command.run(() => getReadingAttempt(attempt.id), result => setEditing({
      kind: "memory", attempt: result.attempt, version: result.entry.version }));
  }
  return <section className="bv-container bv-reading-workspace">
    {request.loading ? <BookSkeletons count={1} /> : request.error ? <EmptyState error title="This reading couldn’t load." action={<><Button onClick={request.retry}>Try again</Button><ActionLink to="/my-books" variant="secondary">My Books</ActionLink></>}>It may have been removed, or the server may need a moment.</EmptyState> : <>
    <TextLink to="/my-books">Back to My Books</TextLink><PageHeading eyebrow={entry.book ? "Your reading" : "Private book · only you"} title={book.title}>{book.authors?.map(author => author.name).join(", ") || "Author not listed"}</PageHeading>
    {entry.book && <TextLink to={`/book/${entry.book_id}`}>About this book</TextLink>}
    {library.readOnly && <p role="status" className="bv-notice">Your reading is available to read. Changes are temporarily paused.</p>}
    <div className="bv-form-actions" role="group" aria-label="Your book flags">{[["is_owned", "Own"], ["is_wanted", "Want"]].map(([flag, label]) => <Button key={flag} variant={entry[flag] ? "saved" : "secondary"} aria-pressed={entry[flag]} disabled={library.readOnly || command.pending} onClick={() => command.run(async () => ({ entry: await updateLibraryEntry(entry.id, { [flag]: !entry[flag], expected_version: entry.version }) }), result => library.readingChanged(result.entry))}>{label}</Button>)}</div>
    <div className="bv-reading-status"><h2>{attempt ? stateLabel[attempt.state] : "A new beginning"}</h2>{attempt && <p>{progressLabel(attempt)}</p>}</div>
    {(!attempt || terminal) && request.data.editions.length > 0 && <details className="bv-field"><summary>Choose an edition (optional)</summary><label htmlFor="reading-edition">Your copy for the new reading</label><select id="reading-edition" value={editionId} disabled={library.readOnly} onChange={event => { setEditionId(event.target.value); intent.current = null; }}><option value="">Catalogue preferred edition</option>{request.data.editions.map(edition => <option key={edition.id} value={edition.id}>{edition.physical_format || "Edition"}{edition.page_count ? ` · ${edition.page_count} pages` : ""} · {(edition.languages || []).join(", ") || "Language not listed"}</option>)}</select><p className="bv-help">Saved progress keeps this copy’s page total even if catalogue metadata changes.</p></details>}
    <div className="bv-form-actions">
      {(!attempt || terminal) && <Button disabled={library.readOnly || command.pending || Boolean(editing)} onClick={() => create(entry)}>{terminal ? "Start reading again" : "Start reading"}</Button>}
      {attempt && <>{[...(attempt.state === "reading" ? [["paused", "Pause reading"]] : attempt.state === "paused" ? [["reading", "Resume reading"]] : []), ...(!terminal ? [["finished", "Finish book"], ["dnf", "Stop reading"]] : [["reading", "Reopen this reading"]])].map(([state, label]) => <Button key={label} variant="secondary" disabled={library.readOnly || command.pending || Boolean(editing)} onClick={() => command.run(() => updateReadingAttempt(attempt.id, { expected_version: entry.version, state }), accept)}>{label}</Button>)}</>}
      {(!attempt || terminal) && <><Button variant="secondary" disabled={library.readOnly || command.pending || Boolean(editing)} onClick={() => create(entry, "finished")}>Record a past finish</Button><Button variant="quiet" disabled={library.readOnly || command.pending || Boolean(editing)} onClick={() => create(entry, "dnf")}>Record a past stop</Button></>}
      {attempt && <Button variant="quiet" disabled={library.readOnly || command.pending || Boolean(editing)} onClick={() => openEditor(attempt)}>Edit progress or dates</Button>}
    </div>
    {command.error && <p role="alert" className="bv-notice">{command.error} <Button variant="quiet" onClick={request.retry}>Reload current reading</Button></p>}
    {library.privateContext && <section className="bv-section"><h2>Only for you</h2>
      <p className="bv-help">You never need to write notes or choose a reaction to read, finish or use your library.</p>
      {entry.save_note && <p className="bv-private-text">{entry.save_note}</p>}
      <Button variant="quiet" disabled={library.readOnly || command.pending || Boolean(editing)} onClick={() => setEditing({ kind: "save_note", entry, version: entry.version })}>{entry.save_note ? "Edit save reason" : "Add save reason (optional)"}</Button>
      {attempt && <>{attempt.note && <p className="bv-private-text">{attempt.note}</p>}{attempt.reaction && <p className="bv-help">{reactionLabel[attempt.reaction]}</p>}
        <Button variant="quiet" disabled={command.pending || Boolean(editing)} onClick={() => openMemory(attempt)}>{library.readOnly ? "View reading memory" : attempt.note || attempt.reaction ? "View or edit reading memory" : "Add note and reaction (optional)"}</Button></>}
    </section>}
    {terminal && <p className="bv-help">This reading is saved. Start again for a new read, or reopen to correct this same record. Choosing your next book is always up to you.</p>}
    </>}
    {/* Keep the same editor mounted while flags refresh the workspace. Its
        original version stays with the draft; a later save can conflict safely. */}
    {editing && <div className="bv-reading-draft">{editing.kind === "progress" ? <ProgressForm key={`${selected.id}:${entryId}`} attempt={selected} version={editing.version} readOnly={library.readOnly || command.pending} onSaved={accept} /> : <ContextForm key={`${editing.kind}:${selected?.id || editing.entry.id}:${entryId}`} draft={editing} readOnly={library.readOnly || command.pending} onSaved={accept} />}
      <p className="bv-help">Own and Want changes keep this draft. Save or close the editor before other reading actions. Closing discards unsaved edits and reloads the saved reading.</p>
      <Button variant="quiet" onClick={() => { setEditing(null); request.retry(); }}>Close editor and reload</Button>
      {editing.kind === "progress" && ["finished", "dnf"].includes(selected.state) && selected.id !== attempt?.id && <Button disabled={!entry || library.readOnly || command.pending} onClick={() => command.run(() => updateReadingAttempt(selected.id, { expected_version: entry.version, state: "reading" }), accept)}>Reopen selected reading (discard unsaved edits)</Button>}
    </div>}
    {entry && <ReadingHistory entry={entry} onCorrect={openEditor} onMemory={openMemory} onRemove={attempt => setRemoval({ entry, attempt })} editing={Boolean(editing) || command.pending || Boolean(removal)} />}
    {entry && library.privacyControls && <section className="bv-section"><h2>Your data, your choice</h2><p className="bv-help">Turning off Own or Want keeps your reading history. Forgetting a book removes its entire private record.</p><Button variant="quiet" disabled={library.readOnly || command.pending || Boolean(editing) || Boolean(removal)} onClick={() => setRemoval({ entry })}>Forget this book</Button></section>}
    {removal && <ReadingRemovalDialog key={removal.attempt?.id || removal.entry.id} entry={removal.entry} attempt={removal.attempt} onClose={() => setRemoval(null)} onRemoved={() => { setRemoval(null); request.retry(); }} />}
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
    {library.readOnly && <p role="status" className="bv-notice">Your library is available to read. Changes are temporarily paused.</p>}
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
