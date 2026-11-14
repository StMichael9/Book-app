import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { workspaceKey } from "../../api/earlyStart.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { createPrivateEntry, createReadingAttempt, ensureLibraryBook, findPrivateMatches, getReadingAttempt, getReadingWorkspace, lookupLibraryBooks, updateLibraryEntry, updateReadingAttempt } from "../../api/reading.js";
import { ActionLink, BookCover, BookSkeletons, Button, EmptyState, EnglishTitle, NativeDialog, PageFrame, PageHeading, TextLink } from "../ui-v2/primitives.jsx";
import { authorLabel, useDocumentTitle, useRequest } from "../ui-v2/data.js";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { ReadingRemovalDialog } from "./ReadingDataControls.jsx";
import NextReadSection from "./NextReadSection.jsx";
import { localToday } from "./localToday.js";
import ImportedSources from "./imports/ImportedSources.jsx";
import { SlowReadingNotice } from "./ReadingCards.jsx";
import { editionOptions } from "./editionLabels.js";
import { ReadingBookDetails } from "./ReadingBookContext.jsx";
import ProgressBox from "./ProgressBox.jsx";
import ReadingJournal, { ForeEdge, ProgressLine } from "./ReadingJournal.jsx";
import "../../styles/ui-v2/reading-page.css";
import BookMenu from "./BookMenu.jsx";
import { formatDay } from "./readingDates.js";
import ReadingEditor from "./ReadingEditors.jsx";
import { draftKey, useReadingDrafts } from "./readingDraftState.js";
import { useReader } from "../ui-v2/readerState.js";
import { useLibraryNavigation } from "./libraryNavigationState.js";

const displayBook = entry => entry.book || { title: entry.private_title, cover_image_url: entry.private_catalogue?.cover_image_url, authors: entry.private_author ? [{ name: entry.private_author }] : [] };

export function ReadingGate({ children, title }) {
  const library = useUserBooks();
  if (library.loading) return title ? <PageFrame title={title} /> : <section className="bv-container"><BookSkeletons count={3} /></section>;
  if (library.error) return <section className="bv-container"><EmptyState error title="Your reading couldn’t load." action={<Button onClick={library.retryLoad}>Try again</Button>}>Your saved reading is unchanged.</EmptyState></section>;
  if (!library.readingActions) return <Navigate to="/my-books" replace />;
  return children;
}

export { default as ReadingHomePage } from "./home/HomePage.jsx";

// A quiet acknowledgement of a saved finish or stop. Dates appear only when recorded; nothing is required.
// Finish and Stop are single clicks, so the moment carries an obvious undo for this session only.
function FinishMoment({ kind, title, attempt, headingRef, onNote, noteDisabled, onUndo, undoDisabled }) {
  const started = formatDay(attempt?.started_on), ended = formatDay(attempt?.ended_on);
  const stopped = kind === "dnf";
  return <section className="bv-finish-moment" aria-labelledby="bv-finish-title">
    <h2 id="bv-finish-title" ref={headingRef} tabIndex={-1}>{stopped ? `You stopped reading ${title}.` : `You finished ${title}.`}</h2>
    {(started || ended) && <p className="bv-finish-dates">{started && ended ? `Read ${started} – ${ended}` : ended ? `${stopped ? "Stopped" : "Finished"} ${ended}` : `Started ${started}`}</p>}
    <p className="bv-muted">{stopped ? "It stays in your Reading history, with your progress and note." : "No rating or review needed. If something stayed with you, you can keep it here."}</p>
    {onNote && <Button variant="secondary" disabled={noteDisabled} onClick={onNote}>Leave a closing note</Button>}
    {onUndo && <p className="bv-finish-undo">{stopped ? "Stopped by mistake?" : "Finished by mistake?"} <Button variant="secondary" disabled={undoDisabled} onClick={onUndo}>Mark as reading</Button></p>}
  </section>;
}

function RereadDialog({ entry, editionId, onClose, onSaved }) {
  const library = useUserBooks(), command = useReadingCommand();
  const identity = useRef(crypto.randomUUID());
  const startedOn = useRef(localToday());
  return <NativeDialog open title="Start a new reading?" onClose={() => { if (!command.pending) onClose(); }}>
    <p><strong>{displayBook(entry).title}</strong></p><p>This starts a new reading of this book. Your earlier dates, notes and progress stay in history.</p>
    <p>To continue the same reading, cancel and choose Mark as reading instead.</p>
    {command.error && <p role="alert">{command.error}</p>}
    <div className="bv-dialog-actions"><Button variant="secondary" disabled={command.pending} onClick={onClose}>Cancel</Button><Button disabled={command.pending || library.readOnly} onClick={() => command.run(() => createReadingAttempt(identity.current, {
      entry_id: entry.id, expected_version: entry.version, state: "reading", started_on: startedOn.current, ...(editionId ? { edition_id: Number(editionId) } : {}),
    }), onSaved)}>{command.pending ? "Starting…" : "Start a new reading"}</Button></div>
  </NativeDialog>;
}

export function ReadingWorkspacePage() {
  const { entryId } = useParams();
  const location = useLocation();
  const navigation = useLibraryNavigation();
  const libraryView = navigation.get(location.state?.libraryReturn);
  const auth = useAuth(), library = useUserBooks();
  const reader = useReader();
  const request = useRequest(() => getReadingWorkspace(entryId), workspaceKey(auth.sessionGeneration, entryId, library.revision));
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
  // Opened from My Books or Home: the entry already known there draws the book's identity before the workspace request returns.
  const seed = String(location.state?.entry?.id) === String(entryId) ? location.state.entry : null;
  const [manageOpen, setManageOpen] = useState(false);
  const [removal, setRemoval] = useState(null);
  const [reread, setReread] = useState(null);
  const [finishNotice, setFinishNotice] = useState(null);
  const finishHeading = useRef(null);
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
  function closeEditor(restore = true) {
    if (!editing) return;
    const kind = editing.kind, previousFocus = document.activeElement;
    setEditing(null);
    if (!restore) return;
    requestAnimationFrame(() => {
      if (!workspaceRoot.current || (document.activeElement !== document.body && document.activeElement !== previousFocus)) return;
      const trigger = editorTrigger.current?.isConnected && !editorTrigger.current.disabled ? editorTrigger.current
        : workspaceRoot.current.querySelector(`[data-draft-trigger="${kind}"]:not(:disabled)`);
      const fallback = workspaceRoot.current.querySelector(kind === "progress" ? ".bv-journal h2" : ".bv-journal h2");
      const target = trigger || fallback;
      if (target) { if (!trigger) target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true }); }
    });
  }
  function accept(result) {
    if (editing) {
      changeDraft(editing.key, null);
      reader.announce(result.attempt?.state !== editing.attempt?.state ? "Reading updated." : editing.kind === "progress" ? "Progress saved." : editing.kind === "save_note" ? "Save reason saved." : "Note saved.");
    }
    const focused = document.activeElement;
    const restore = Boolean(focused === document.body || workspaceRoot.current?.querySelector(".bv-reading-draft")?.contains(focused));
    library.readingChanged(result.entry); closeEditor(restore); intent.current = null;
    if (result.attempt && !["finished", "dnf"].includes(result.attempt.state)) setFinishNotice(null);
  }
  function create(entry, state = "reading") {
    const key = `${entry.id}:${state}`;
    // Only a live start is dated, and the day is fixed with the intent so a retry sends the same body.
    if (intent.current?.key !== key) intent.current = { key, id: crypto.randomUUID(), startedOn: state === "reading" ? localToday() : null };
    command.run(() => createReadingAttempt(intent.current.id, { entry_id: entry.id, expected_version: entry.version, state,
      ...(intent.current.startedOn ? { started_on: intent.current.startedOn } : {}),
      ...(editionId ? { edition_id: Number(editionId) } : {}) }), accept);
  }
  function acceptReadingAction(result, message) {
    const focused = document.activeElement;
    accept(result); reader.announce(message);
    requestAnimationFrame(() => {
      if (workspaceRoot.current && (document.activeElement === document.body || document.activeElement === focused)) statusHeading.current?.focus({ preventScroll: true });
    });
  }
  const entry = workspace?.entry, attempt = workspace?.current_attempt;
  // The saved state of this book, for the controls that go by it (Pin to Up next), when the page is opened directly.
  const { rememberEntries } = library;
  useEffect(() => { if (entry?.book_id) rememberEntries([entry]); }, [entry, rememberEntries]);
  const book = entry ? displayBook(entry) : null, terminal = attempt && ["finished", "dnf"].includes(attempt.state);
  const selected = editing?.attempt;
  useDocumentTitle(book?.title);
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
    canReopen={editing.kind === "progress" && ["finished", "dnf"].includes(selected.state) && selected.id !== attempt?.id && (!attempt || terminal)}
    readOnly={library.readOnly || command.pending} onChange={value => changeDraft(editing.key, value)} onSaved={accept} onClose={() => closeEditor()}
    onRemove={library.privacyControls && editing.kind === "progress" && selected && selected.id !== attempt?.id ? () => { const target = selected; closeEditor(false); setRemoval({ entry, attempt: target }); } : undefined}
    onReload={() => {
      // Only this explicit recovery action replaces a stale draft/version.
      const key = editing.key, kind = editing.kind;
      command.run(() => kind === "save_note" ? getReadingWorkspace(entryId) : getReadingAttempt(selected.id), result => {
        const focused = document.activeElement;
        changeDraft(key, null);
        closeEditor(Boolean(focused === document.body || workspaceRoot.current?.querySelector(".bv-reading-draft")?.contains(focused)));
        library.readingChanged(result.entry);
      });
    }} />;
  const loaded = Boolean(entry);
  // The moment belongs to this session's own Finish or Stop, and only while that attempt still has that state.
  const moment = finishNotice?.generation === auth.sessionGeneration &&
    (!request.data || (attempt?.id === finishNotice.id && attempt.state === finishNotice.state)) ? finishNotice : null;
  const finished = moment?.state === "finished" ? moment : null;
  const blocked = library.readOnly || command.pending || Boolean(reread);
  function changeState(state) {
    let ended_on;
    if (state === "finished" || state === "dnf") {
      const today = localToday();
      ended_on = attempt.started_on && attempt.started_on > today ? attempt.started_on : today;
    }
    command.run(() => updateReadingAttempt(attempt.id, { expected_version: entry.version, state, ...(ended_on ? { ended_on } : {}) }), result => {
      accept(result);
      if (["finished", "dnf"].includes(state)) setFinishNotice({ id: result.attempt.id, title: book.title, generation: auth.sessionGeneration, state });
    });
  }
  function markAsReading() {
    command.run(() => updateReadingAttempt(attempt.id, { expected_version: entry.version, state: "reading" }), result => acceptReadingAction(result, "Marked as reading. Your reading history is kept."));
  }
  const toggleShelf = flag => command.run(async () => ({ entry: await updateLibraryEntry(entry.id, { [flag]: !entry[flag], expected_version: entry.version }) }), result => library.readingChanged(result.entry));
  // The next read shows once the book is finished, on the finish moment; not on the page while it is being read.
  const nextSection = library.nextRead && finished && <NextReadSection key={`${auth.sessionGeneration}:${entryId}`} preview currentKey={entry ? entry.book_id ? `book:${entry.book_id}` : `entry:${entry.id}` : null}
    enabled={loaded || Boolean(finished)} finishId={finished?.id} />;
  const momentId = moment?.id;
  useEffect(() => { if (momentId) finishHeading.current?.focus(); }, [momentId]);
  const chip = { reading: "Reading", paused: "Paused", finished: "Finished", dnf: "Stopped" }[attempt?.state] || "Not started";
  const identity = (shown, status) => { const info = displayBook(shown); return <div className="bv-reading-id">
    <BookCover book={info} size="small" priority />
    <div><h1 id="bv-reading-book-title" tabIndex={-1} ref={completeFocus}>{info.title}</h1><EnglishTitle book={info} /><p className="bv-detail-author">{authorLabel(info)}</p>
      {status && <h2 className="bv-reading-chip" tabIndex={-1} ref={statusHeading}>{status}</h2>}</div>
  </div>; };
  const onEdit = (kind, selectedAttempt) => { if (kind === "memory") openMemory(selectedAttempt); else if (kind === "save_note") openDraft("save_note"); else openEditor(selectedAttempt); };
  return <section ref={workspaceRoot} className="bv-container bv-reading-workspace bv-reading-page">
    <div className="bv-reading-head">
      <TextLink to={libraryView?.href || "/my-books"} state={libraryView ? { libraryPrevious: libraryView.previous, libraryLoaded: libraryView.loaded, libraryScroll: libraryView.scroll } : null}>Back to My Books</TextLink>
      {entry && !library.readOnly && <BookMenu bookId={entry.book_id} title={book.title} className="bv-more--head" shelf={{ entry, disabled: command.pending, onToggle: toggleShelf }} />}
    </div>
    <SlowReadingNotice loading={request.loading} />
    {!entry && request.loading && seed ? <div key="seed" ref={trackLoading} aria-busy="true">{identity(seed)}<BookSkeletons count={1} /></div>
      : !entry && request.loading ? <div key="loading" ref={trackLoading} className="bv-workspace-loading" aria-busy="true"><PageHeading title="Loading your reading…" /><BookSkeletons count={1} /></div>
      : !entry ? <div key="error" ref={trackError} className="bv-workspace-loading"><EmptyState error title="This reading couldn’t load." action={<><Button onClick={() => { restoreHeadingFocus.current = true; request.retry(); }}>Try again</Button><ActionLink to="/my-books" variant="secondary">My Books</ActionLink></>}>It may have been removed, or the server may need a moment.</EmptyState></div>
      : <>
        {identity(entry, chip)}
        {library.readOnly && <p role="status" className="bv-notice">Your reading is available to read. Changes are temporarily paused.</p>}
        <ForeEdge attempt={attempt} />
        <ProgressLine entry={entry} attempt={attempt} readOnly={library.readOnly} onSaved={accept} />
        {attempt && !terminal && <ProgressBox key={attempt.id} entry={entry} attempt={attempt} title={book.title} thought readOnly={library.readOnly} onSaved={accept}
          onFinished={result => { accept(result); setFinishNotice({ id: result.attempt.id, title: book.title, generation: auth.sessionGeneration, state: "finished" }); }} />}
        <div className="bv-reading-actions" role="group" aria-label="Reading actions">
          {!attempt && <Button disabled={blocked} onClick={() => create(entry)}>Start reading</Button>}
          {attempt && !terminal && !library.readOnly && <>
            <Button variant="secondary" onClick={() => changeState(attempt.state === "reading" ? "paused" : "reading")}>{attempt.state === "reading" ? "Pause reading" : "Resume reading"}</Button>
            <Button variant="secondary" onClick={() => changeState("finished")}>Finish book</Button></>}
          {terminal && !library.readOnly && <>
            <Button variant="secondary" disabled={blocked} onClick={() => setReread({ entry, editionId })}>Read it again</Button>
            {/* Right after Finish or Stop the moment offers the undo; on later visits this quiet link does. */}
            {!moment && <p className="bv-workspace-undo">Still reading it? <Button variant="quiet" className="bv-inline-action" disabled={blocked} onClick={markAsReading}>Mark as reading</Button></p>}
          </>}
        </div>
        {command.error && <p role="alert" className="bv-notice">{command.error} <Button variant="quiet" onClick={request.retry}>Reload current reading</Button></p>}
        {request.error && <p role="alert" className="bv-notice">Your reading couldn’t refresh. <Button variant="quiet" onClick={request.retry}>Try again</Button></p>}
      </>}
    {moment && <FinishMoment kind={moment.state} title={moment.title} attempt={attempt?.id === moment.id ? attempt : null} headingRef={finishHeading}
      onNote={library.privateContext && attempt?.id === moment.id && !attempt.note ? () => openMemory(attempt) : undefined}
      noteDisabled={command.pending || request.loading || Boolean(request.error) || Boolean(editing)}
      onUndo={!library.readOnly && attempt?.id === moment.id ? markAsReading : undefined} undoDisabled={blocked} />}
    {nextSection}
    {entry && <ReadingJournal entry={entry} attempt={attempt} entryId={entryId} workspace={workspace} visible={loaded} readOnly={library.readOnly} onEdit={onEdit} editor={editor} editing={editing} />}
    <details hidden={!loaded} className="bv-reading-fold" open={manageOpen} onToggle={event => setManageOpen(event.currentTarget.open)}><summary>About this book · Manage</summary>
      {entry && <ReadingBookDetails key={entry.book_id || `private:${entry.id}`} bookId={entry.book_id} description={entry.private_description} entryId={entry.id} />}
      {entry && workspace?.imported_sources_count > 0 && <div className="bv-workspace-imported"><ImportedSources key={`${auth.sessionGeneration}:${entry.id}`} entryId={entry.id} count={workspace.imported_sources_count} /></div>}
      {loaded && !library.readOnly && <div className="bv-reading-manage">
        {attempt && !terminal && <Button variant="secondary" disabled={blocked} onClick={() => changeState("dnf")}>Stop reading this book</Button>}
        {(!attempt || terminal) && workspace.editions.length > 0 && <div className="bv-field"><label htmlFor="reading-edition">Which copy are you reading? (optional)</label><select id="reading-edition" value={editionId} onChange={event => { setEditionId(event.target.value); intent.current = null; }}><option value="">The standard edition</option>{editionOptions(workspace.editions).map(edition => <option key={edition.id} value={edition.id}>{edition.label}</option>)}</select></div>}
        {(!attempt || terminal) && <><Button variant="quiet" disabled={blocked} onClick={() => create(entry, "finished")}>Log an earlier read I finished</Button><Button variant="quiet" disabled={blocked} onClick={() => create(entry, "dnf")}>Log an earlier read I stopped</Button></>}
        {library.privacyControls && attempt && <Button variant="danger-outline" disabled={command.pending || Boolean(editing) || Boolean(removal)} onClick={() => setRemoval({ entry, attempt })}>Delete this reading</Button>}
        {library.privacyControls && <Button variant="danger-outline" disabled={command.pending || Boolean(editing) || Boolean(removal)} onClick={() => setRemoval({ entry })}>Remove from My Books</Button>}
      </div>}
    </details>
    {removal && <ReadingRemovalDialog key={removal.attempt?.id || removal.entry.id} entry={removal.entry} attempt={removal.attempt} onClose={() => setRemoval(null)} onRemoved={() => { setRemoval(null); request.retry(); }} />}
    {reread && <RereadDialog {...reread} onClose={() => setReread(null)} onSaved={result => { acceptReadingAction(result, "New reading started. Your earlier readings are kept in history."); setReread(null); }} />}
  </section>;
}

export function PrivateBookPage() {
  const go = useNavigate(), library = useUserBooks(), command = useReadingCommand();
  const location = useLocation(), navigation = useLibraryNavigation();
  const prefill = navigation.getManualBook(location.state?.manualBook);
  const [title, setTitle] = useState(prefill?.title || ""), [author, setAuthor] = useState(prefill?.author || ""), [matches, setMatches] = useState(null);
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
  return <section className="bv-container bv-private-entry"><PageHeading title="Add a book">This book stays private to your library.</PageHeading>
    {library.libraryImport && !library.readOnly && <p className="bv-notice">Importing lots of books? <TextLink to="/my-books/import">Import from Goodreads or StoryGraph</TextLink>.</p>}
    {library.readOnly && <p role="status" className="bv-notice">Your library is available to read. Changes are temporarily paused.</p>}
    <form className="bv-field bv-reading-form" onSubmit={event => { event.preventDefault(); submit(); }}><fieldset disabled={library.readOnly || command.pending}><legend>Book details</legend>
      <label htmlFor="private-title">Title</label><input id="private-title" required maxLength={500} value={title} onChange={event => { setTitle(event.target.value); setMatches(null); }} />
      <label htmlFor="private-author">Author (optional)</label><input id="private-author" maxLength={500} value={author} onChange={event => { setAuthor(event.target.value); setMatches(null); }} />
      <Button type="submit">{command.pending ? "Checking…" : "Add a book"}</Button></fieldset></form>
    {matches && <section className="bv-notice"><h2>A title like this is already in your library.</h2><p>Names are not identities. Open an existing entry, or create a separate one if this is a different book.</p><ul>{matches.map(entry => <li key={entry.id}><TextLink to={`/my-books/${entry.id}`}>{entry.private_title}{entry.private_author ? ` · ${entry.private_author}` : ""}</TextLink></li>)}</ul><Button disabled={library.readOnly || command.pending} onClick={() => submit(true)}>Create a separate private book</Button></section>}
    {command.error && <p role="alert">{command.error}</p>}{prefill?.returnTo?.startsWith("/browse?") && <p><TextLink to={prefill.returnTo}>Back to search</TextLink></p>}<TextLink to="/my-books">Back to My Books</TextLink>
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
  const startedOn = useRef(localToday());
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
    return createReadingAttempt(identity.current, { entry_id: entry.id, expected_version: entry.version, started_via: "discovery", started_on: startedOn.current });
  }, result => { library.readingChanged(result.entry); go(`/my-books/${result.entry.id}`, { replace: true }); });
  const beginCurrent = useEffectEvent(begin);
  useEffect(() => { if (!started.current && !library.readOnly) { started.current = true; beginCurrent(); } }, [library.readOnly]);
  return <section className="bv-container"><PageHeading title={library.readOnly ? "Reading changes are paused." : command.error ? "We couldn’t confirm your reading started." : "Opening your reading…"} />{command.error && <><p role="alert">{command.error}</p><Button disabled={command.pending} onClick={begin}>Try starting again</Button></>}<TextLink to="/my-books">Back to My Books</TextLink></section>;
}
