import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { createPrivateEntry, createReadingAttempt, ensureLibraryBook, findPrivateMatches, getReadingAttempt, getReadingHistory, getReadingHome, getReadingWorkspace, lookupLibraryBooks, updateLibraryEntry, updateReadingAttempt } from "../../api/reading.js";
import { ActionLink, BookSkeletons, Button, EmptyState, PageHeading, TextLink } from "../ui-v2/primitives.jsx";
import { useRequest } from "../ui-v2/data.js";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { ReadingRemovalDialog } from "./ReadingDataControls.jsx";
import NextReadSection from "./NextReadSection.jsx";
import ImportedSources from "./imports/ImportedSources.jsx";
import { CurrentReadingCard, SlowReadingNotice } from "./ReadingCards.jsx";
import { ReadingBookDetails, ReadingBookIdentity, ReadingProgress } from "./ReadingBookContext.jsx";
import ReadingEditor from "./ReadingEditors.jsx";
import { draftKey, useReadingDrafts } from "./readingDraftState.js";

const stateLabel = { reading: "Reading", paused: "Paused", finished: "Finished", dnf: "Stopped" };
const reactionLabel = { loved: "Loved it", liked: "Liked it", not_for_me: "Not for me" };
const displayBook = entry => entry.book || { title: entry.private_title, authors: entry.private_author ? [{ name: entry.private_author }] : [] };

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
    <div className="bv-home-heading"><PageHeading eyebrow="Your reading home" title="Pick up where you left off.">A little space for what you’re reading now.</PageHeading></div>
    {library.readOnly && <p role="status" className="bv-notice">Your library is available to read. Changes are temporarily paused.</p>}
    <SlowReadingNotice loading={request.loading} />
    <div className="bv-home-layout"><section className="bv-reading-desk" aria-labelledby="bv-current-reading-title">
    <div className="bv-reading-heading"><h2 id="bv-current-reading-title">Your current reading</h2></div>
    {request.loading ? <BookSkeletons count={3} /> : request.error ? <EmptyState error title="Your reading couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Your books haven’t changed.</EmptyState> : <>
      {request.data.current_reads.length ? <div className="bv-current-grid">{request.data.current_reads.map(({ entry, attempt }) => <CurrentReadingCard key={entry.id} entry={entry} attempt={attempt} />)}</div> : <div className="bv-home-start">
        <h2>{request.data.paused_count ? "A book can wait for you." : "Make this reading home your own."}</h2>
        <p className="bv-muted">{request.data.paused_count ? "Your paused books are here whenever you’re ready. Resume one, or choose something different." : "Choose a saved book or find something that catches your eye. Tracking pages and writing notes are always optional."}</p>
        <div className="bv-form-actions"><ActionLink to={request.data.paused_count ? "/my-books?status=paused" : "/my-books"}>{request.data.paused_count ? "Open paused books" : "Choose from My Books"}</ActionLink><ActionLink to="/browse" variant="secondary">Find a book</ActionLink></div>
        {library.libraryImport && !library.readOnly && <p><TextLink to="/my-books/import">Bring Your Library</TextLink> · Start with the books and history you already have.</p>}
      </div>}
      {(request.data.reading_count > request.data.current_reads.length || (request.data.paused_count > 0 && request.data.current_reads.length > 0)) && <div className="bv-home-support">{request.data.reading_count > request.data.current_reads.length && <TextLink to="/my-books?status=reading">See all current reads ({request.data.reading_count})</TextLink>}{request.data.paused_count > 0 && request.data.current_reads.length > 0 && <TextLink to="/my-books?status=paused">Paused books ({request.data.paused_count})</TextLink>}</div>}
    </>}
    </section>{library.nextRead && <aside className="bv-home-next" aria-label="Your next beginning"><NextReadSection key={auth.sessionGeneration} preview home /></aside>}</div>
  </section>;
}

function ReadingHistory({ entryId, enabled, onCorrect, onMemory, onRemove, editing }) {
  const auth = useAuth(), library = useUserBooks();
  const [params, setParams] = useSearchParams();
  const cursor = params.get("history_cursor") || "";
  const request = useRequest(() => getReadingHistory(entryId, cursor), `history:${auth.sessionGeneration}:${entryId}:${cursor}:${library.revision}`, enabled);
  return <section className="bv-reading-history-content" aria-label="Your reading history">
    {request.loading ? <p role="status">Loading reading history…</p> : request.error ? <EmptyState error title="Your history couldn’t load." action={<><Button onClick={request.retry}>Try again</Button><Button onClick={() => setParams({})} variant="secondary">First readings</Button></>}>Your records haven’t changed.</EmptyState> : <>
      {request.data.items.length ? <ul className="bv-reading-history">{request.data.items.map(attempt => <li key={attempt.id}><strong>{stateLabel[attempt.state]}</strong><span>{attempt.started_on || "Start date unknown"}{attempt.ended_on ? ` → ${attempt.ended_on}` : ""}</span><Button variant="quiet" disabled={library.readOnly || editing} onClick={() => onCorrect(attempt)}>Correct this reading</Button>{library.privateContext && <Button variant="quiet" disabled={editing} onClick={() => onMemory(attempt)}>{library.readOnly ? "View reading memory" : "Note and reaction"}</Button>}{library.privacyControls && <Button variant="quiet" disabled={library.readOnly || editing} onClick={() => onRemove(attempt)}>Delete this reading record</Button>}</li>)}</ul> : <p>No reading records on this page.</p>}
      <div className="bv-form-actions">{cursor && <Button variant="secondary" onClick={() => setParams({})}>First readings</Button>}{request.data.next_cursor && <Button variant="secondary" onClick={() => setParams({ history_cursor: request.data.next_cursor })}>Older readings</Button>}</div>
    </>}
  </section>;
}

function ReadingHistoryDisclosure({ visible, entryId, ...props }) {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(() => Boolean(params.get("history_cursor")));
  const [loaded, setLoaded] = useState(open);
  return <details hidden={!visible} className="bv-workspace-history" open={open} onToggle={event => {
    const value = event.currentTarget.open;
    setOpen(value); if (value) setLoaded(true);
  }}><summary>Reading history</summary>
    {loaded && <ReadingHistory entryId={entryId} enabled={visible} {...props} />}
  </details>;
}

export function ReadingWorkspacePage() {
  const { entryId } = useParams();
  const auth = useAuth(), library = useUserBooks();
  const request = useRequest(() => getReadingWorkspace(entryId), `workspace:${auth.sessionGeneration}:${entryId}:${library.revision}`);
  const command = useReadingCommand();
  const intent = useRef(null);
  const [editing, setEditing] = useState(null);
  const { drafts, change: changeDraft } = useReadingDrafts();
  const editorTrigger = useRef(null);
  const workspaceRoot = useRef(null);
  const [lastWorkspace, setLastWorkspace] = useState(null);
  const workspaceSession = `${auth.sessionGeneration}:${entryId}`;
  if (request.data && (lastWorkspace?.key !== workspaceSession || lastWorkspace.data !== request.data)) setLastWorkspace({ key: workspaceSession, data: request.data });
  const workspace = request.data || (lastWorkspace?.key === workspaceSession ? lastWorkspace.data : null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [removal, setRemoval] = useState(null);
  const [finishNotice, setFinishNotice] = useState(null);
  const [nextDismissed, setNextDismissed] = useState(false);
  const loadingNode = useRef(null), errorNode = useRef(null), restoreHeadingFocus = useRef(false);
  const completeFocus = useCallback(node => {
    if (!node) return;
    const restore = restoreHeadingFocus.current;
    restoreHeadingFocus.current = false;
    const heading = node.matches("h1") ? node : node.querySelector("h1, h2");
    if (restore && heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
  }, []);
  const trackLoading = useCallback(node => {
    if (!node && loadingNode.current) restoreHeadingFocus.current = loadingNode.current.contains(document.activeElement);
    loadingNode.current = node; completeFocus(node);
  }, [completeFocus]);
  const trackError = useCallback(node => {
    if (!node && errorNode.current?.contains(document.activeElement)) restoreHeadingFocus.current = true;
    errorNode.current = node; completeFocus(node);
  }, [completeFocus]);
  const statusHeading = useRef(null);
  const [editionId, setEditionId] = useState("");
  function closeEditor() {
    const kind = editing?.kind;
    setEditing(null);
    requestAnimationFrame(() => {
      if (!workspaceRoot.current) return;
      const trigger = editorTrigger.current?.isConnected && !editorTrigger.current.disabled ? editorTrigger.current
        : workspaceRoot.current.querySelector(`[data-draft-trigger="${kind}"]:not(:disabled)`);
      const fallback = workspaceRoot.current.querySelector(kind === "progress" ? ".bv-workspace-progress h2" : ".bv-workspace-memory h2");
      const target = trigger || fallback;
      if (target) { if (!trigger) target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true }); }
    });
  }
  function accept(result) {
    if (editing) changeDraft(editing.key, null);
    library.readingChanged(result.entry); closeEditor(); intent.current = null;
    if (result.attempt && result.attempt.state !== "finished") { setFinishNotice(null); setNextDismissed(false); }
  }
  function create(entry, state = "reading") {
    const key = `${entry.id}:${state}`;
    if (intent.current?.key !== key) intent.current = { key, id: crypto.randomUUID() };
    command.run(() => createReadingAttempt(intent.current.id, { entry_id: entry.id, expected_version: entry.version, state,
      ...(editionId ? { edition_id: Number(editionId) } : {}) }), accept);
  }
  const entry = workspace?.entry, attempt = workspace?.current_attempt;
  const book = entry ? displayBook(entry) : null, terminal = attempt && ["finished", "dnf"].includes(attempt.state);
  const selected = editing?.attempt;
  function openDraft(kind, selectedAttempt, savedEntry = entry) {
    const key = draftKey(entryId, kind, selectedAttempt?.id);
    editorTrigger.current = document.activeElement;
    setEditing({ ...(drafts[key] || { kind, attempt: selectedAttempt, entry: savedEntry, version: savedEntry.version }), key });
  }
  const openEditor = selectedAttempt => openDraft("progress", selectedAttempt);
  function openMemory(selectedAttempt) {
    const key = draftKey(entryId, "memory", selectedAttempt.id);
    if (drafts[key]) { openDraft("memory", selectedAttempt); return; }
    if (selectedAttempt.id === attempt?.id) { openDraft("memory", selectedAttempt); return; }
    const trigger = document.activeElement;
    command.run(() => getReadingAttempt(selectedAttempt.id), result => {
      openDraft("memory", result.attempt, result.entry); editorTrigger.current = trigger;
    });
  }
  const editor = editing && <ReadingEditor key={editing.key} draft={editing} historical={selected && (selected.id !== attempt?.id || terminal)}
    canReopen={editing.kind === "progress" && ["finished", "dnf"].includes(selected.state) && selected.id !== attempt?.id}
    readOnly={library.readOnly || command.pending} onChange={value => changeDraft(editing.key, value)} onSaved={accept} onClose={closeEditor}
    onReload={() => {
      // Only this explicit recovery action replaces a stale draft/version.
      const key = editing.key, kind = editing.kind;
      command.run(() => kind === "save_note" ? getReadingWorkspace(entryId) : getReadingAttempt(selected.id), result => {
        changeDraft(key, null); setEditing(null);
        library.readingChanged(result.entry);
      });
    }} />;
  const loaded = Boolean(entry);
  const finished = library.nextRead && finishNotice?.generation === auth.sessionGeneration &&
    (!request.data || (attempt?.id === finishNotice.id && attempt.state === "finished")) ? finishNotice : null;
  const blocked = library.readOnly || command.pending || request.loading || Boolean(request.error) || Boolean(editing);
  const progressAction = attempt && <Button key="progress" variant={attempt.state === "paused" || terminal ? "quiet" : "primary"} disabled={command.pending || request.loading || Boolean(request.error) || Boolean(editing)} onClick={() => openEditor(attempt)}>{library.readOnly ? "View progress and dates" : terminal ? "Correct progress or dates" : "Update progress"}</Button>;
  // A keyed direct child can move for Finish without remounting its controller.
  // The quiet preview follows secondary sections in both DOM and phone order.
  const nextSection = library.nextRead && <NextReadSection key={`${auth.sessionGeneration}:${entryId}`} preview currentKey={entry ? entry.book_id ? `book:${entry.book_id}` : `entry:${entry.id}` : null}
    enabled={loaded || Boolean(finished)} hidden={nextDismissed && !finished} finishId={finished?.id} finishedTitle={finished?.title}
    onSkip={finished ? () => { setFinishNotice(null); setNextDismissed(true); (statusHeading.current || document.getElementById("bv-main"))?.focus(); } : undefined} />;
  return <section ref={workspaceRoot} className="bv-container bv-reading-workspace bv-editorial-workspace">
    <div className="bv-breadcrumb"><TextLink to="/my-books">Back to My Books</TextLink></div>
    <SlowReadingNotice loading={request.loading} />
    <div className={`bv-workspace-layout${finished ? " bv-workspace-layout--finished" : ""}`}>
      {!entry && request.loading ? <div key="loading" ref={trackLoading} className="bv-workspace-loading" aria-busy="true"><PageHeading title="Loading your reading…" /><BookSkeletons count={1} /></div>
        : !entry ? <div key="error" ref={trackError} className="bv-workspace-loading"><EmptyState error title="This reading couldn’t load." action={<><Button onClick={() => { restoreHeadingFocus.current = true; request.retry(); }}>Try again</Button><ActionLink to="/my-books" variant="secondary">My Books</ActionLink></>}>It may have been removed, or the server may need a moment.</EmptyState></div>
        : <>
          <ReadingBookIdentity entry={entry} headingRef={completeFocus} flags={<div className="bv-form-actions bv-workspace-flags" role="group" aria-label="Your book flags">{[["is_owned", "Own"], ["is_wanted", "Want"]].map(([flag, label]) => <Button key={flag} variant={entry[flag] ? "saved" : "secondary"} aria-pressed={entry[flag]} disabled={library.readOnly || command.pending || request.loading || Boolean(request.error)} onClick={() => command.run(async () => ({ entry: await updateLibraryEntry(entry.id, { [flag]: !entry[flag], expected_version: entry.version }) }), result => library.readingChanged(result.entry))}>{label}</Button>)}</div>} />
          <div className="bv-workspace-reading"><ReadingProgress attempt={attempt} statusRef={statusHeading} readOnly={library.readOnly}>
            <div className="bv-workspace-primary-actions" role="group" aria-label="Reading actions">
              {!attempt && <Button disabled={blocked} onClick={() => create(entry)}>Start reading</Button>}
              {attempt?.state !== "paused" ? progressAction : null}
              {attempt && !terminal && !library.readOnly && <div className="bv-workspace-state-actions">{[...(attempt.state === "reading" ? [["paused", "Pause reading"]] : [["reading", "Resume reading"]]), ["finished", "Finish book"], ["dnf", "Stop reading"]].map(([state, label]) => <Button key={label} variant={state === "reading" ? "primary" : state === "dnf" ? "quiet" : "secondary"} disabled={blocked} onClick={() => command.run(() => updateReadingAttempt(attempt.id, { expected_version: entry.version, state }), result => {
                accept(result);
                if (state === "finished" && library.nextRead) { setNextDismissed(false); setFinishNotice({ id: result.attempt.id, title: book.title, generation: auth.sessionGeneration }); }
              })}>{label}</Button>)}</div>}
              {attempt?.state === "paused" ? progressAction : null}
            </div>
            {command.error && <p role="alert" className="bv-notice">{command.error} <Button variant="quiet" onClick={request.retry}>Reload current reading</Button></p>}
            {editing?.kind === "progress" && editor}
            {request.loading && <p role="status" className="bv-help">Updating your reading…</p>}
            {request.error && <p role="alert" className="bv-notice">Your reading couldn’t refresh. Your draft is still here. <Button variant="quiet" onClick={request.retry}>Try again</Button></p>}
          </ReadingProgress></div>
        </>}
      {finished ? nextSection : null}
      {library.privateContext && <section hidden={!loaded} className="bv-workspace-memory" aria-label="My note">{editing?.kind === "memory" ? editor : <h2>My note</h2>}{loaded && <>
        {attempt && editing?.kind !== "memory" && <>{attempt.note && <p className="bv-private-text">{attempt.note}</p>}{attempt.reaction && <p className="bv-help">{reactionLabel[attempt.reaction]}</p>}
          {!attempt.note && !attempt.reaction && <p className="bv-help">{library.readOnly ? "Your note would appear here. Changes are temporarily paused." : "A thought worth keeping? Your note is private and always optional."}</p>}
          <Button data-draft-trigger="memory" variant="secondary" disabled={command.pending || request.loading || Boolean(request.error) || Boolean(editing)} onClick={() => openMemory(attempt)}>{library.readOnly ? "View note" : drafts[draftKey(entryId, "memory", attempt.id)] ? "Continue draft" : attempt.note || attempt.reaction ? "Edit note" : "Add a note"}</Button></>}
        {!attempt && <p className="bv-help">Start a reading to keep a note with it.</p>}
        <details className="bv-save-reason" open={reasonOpen} onToggle={event => setReasonOpen(event.currentTarget.open)}><summary>Why I saved this book</summary>{entry.save_note && <p className="bv-private-text">{entry.save_note}</p>}
          {editing?.kind === "save_note" ? editor : !library.readOnly && <Button data-draft-trigger="save_note" variant="quiet" disabled={command.pending || request.loading || Boolean(request.error) || Boolean(editing)} onClick={() => openDraft("save_note")}>{drafts[draftKey(entryId, "save_note")] ? "Continue save-reason draft" : entry.save_note ? "Edit save reason" : "Add save reason (optional)"}</Button>}
        </details>
      </>}</section>}
      {entry && <ReadingBookDetails key={entry.book_id || `private:${entry.id}`} bookId={entry.book_id} />}
      <ReadingHistoryDisclosure entryId={entryId} visible={loaded} onCorrect={openEditor} onMemory={openMemory} onRemove={attempt => setRemoval({ entry, attempt })} editing={Boolean(editing) || command.pending || Boolean(removal)} />
      {entry && workspace?.imported_sources_count > 0 && <div className="bv-workspace-imported"><ImportedSources key={`${auth.sessionGeneration}:${entry.id}`} entryId={entry.id} count={workspace.imported_sources_count} /></div>}
      <details hidden={!loaded || library.readOnly} className="bv-workspace-manage" open={manageOpen} onToggle={event => setManageOpen(event.currentTarget.open)}><summary>Manage this book</summary>{loaded && !library.readOnly && <>
        {terminal && <p className="bv-help">This reading is saved. Start again for a new read, or reopen to correct this same record.</p>}
        {(!attempt || terminal) && workspace.editions.length > 0 && <div className="bv-field"><label htmlFor="reading-edition">Your copy for the new reading (optional)</label><select id="reading-edition" value={editionId} onChange={event => { setEditionId(event.target.value); intent.current = null; }}><option value="">Catalogue preferred edition</option>{workspace.editions.map(edition => <option key={edition.id} value={edition.id}>{edition.physical_format || "Edition"}{edition.page_count ? ` · ${edition.page_count} pages` : ""} · {(edition.languages || []).join(", ") || "Language not listed"}</option>)}</select><p className="bv-help">Saved progress keeps this copy’s page total even if catalogue metadata changes.</p></div>}
        <div className="bv-form-actions bv-workspace-actions">
          {terminal && <><Button variant="secondary" disabled={blocked} onClick={() => create(entry)}>Start reading again</Button><Button variant="quiet" disabled={blocked} onClick={() => command.run(() => updateReadingAttempt(attempt.id, { expected_version: entry.version, state: "reading" }), accept)}>Reopen this reading</Button></>}
          {(!attempt || terminal) && <><Button variant="quiet" disabled={blocked} onClick={() => create(entry, "finished")}>Record a past finish</Button><Button variant="quiet" disabled={blocked} onClick={() => create(entry, "dnf")}>Record a past stop</Button></>}
          {library.privacyControls && <Button variant="quiet" disabled={command.pending || Boolean(editing) || Boolean(removal)} onClick={() => setRemoval({ entry })}>Forget this book</Button>}
        </div>
        {library.privacyControls && <p className="bv-help">Turning off Own or Want keeps your reading history. Forgetting a book removes its entire private record.</p>}
      </>}</details>
      {!finished ? nextSection : null}
    </div>
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
  const go = useNavigate(), library = useUserBooks(), command = useReadingCommand(
    "We couldn’t confirm your reading started. Please try again.",
    { conflictMessage: "Your library changed while we were starting this reading. Check its current state and try again." });
  const identity = useRef(crypto.randomUUID());
  const started = useRef(false);
  const begin = () => command.run(async assertCurrent => {
    await library.waitForBookWrites(Number(bookId));
    assertCurrent();
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
  return <section className="bv-container"><PageHeading title={library.readOnly ? "Reading changes are paused." : command.error ? "We couldn’t confirm your reading started." : "Opening your reading…"} />{command.error && <><p role="alert">{command.error}</p><Button disabled={command.pending} onClick={begin}>Try starting again</Button></>}<TextLink to="/my-books">Back to My Books</TextLink></section>;
}
