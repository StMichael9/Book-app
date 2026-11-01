import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Check } from "lucide-react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { createPrivateEntry, createReadingAttempt, ensureLibraryBook, findPrivateMatches, getLibraryPage, getReadingAttempt, getReadingHistory, getReadingHome, getReadingWorkspace, lookupLibraryBooks, updateLibraryEntry, updateReadingAttempt } from "../../api/reading.js";
import { ActionLink, BookSkeletons, Button, EmptyState, NativeDialog, PageFrame, PageHeading, TextLink } from "../ui-v2/primitives.jsx";
import { useDocumentTitle, useRequest } from "../ui-v2/data.js";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { ReadingRemovalDialog } from "./ReadingDataControls.jsx";
import NextReadSection from "./NextReadSection.jsx";
import FirstRunHome from "./FirstRunHome.jsx";
import { localToday } from "./localToday.js";
import ImportedSources from "./imports/ImportedSources.jsx";
import { CurrentReadingCard, SlowReadingNotice } from "./ReadingCards.jsx";
import { ReadingBookDetails, ReadingBookIdentity, ReadingProgress } from "./ReadingBookContext.jsx";
import ReadingEditor from "./ReadingEditors.jsx";
import { draftKey, useReadingDrafts } from "./readingDraftState.js";
import { useReader } from "../ui-v2/readerState.js";
import { useLibraryNavigation } from "./libraryNavigationState.js";

const stateLabel = { reading: "Reading", paused: "Paused", finished: "Finished", dnf: "Stopped" };
const reactionLabel = { loved: "Loved it", liked: "Liked it", not_for_me: "Not for me" };
const displayBook = entry => entry.book || { title: entry.private_title, cover_image_url: entry.private_catalogue?.cover_image_url, authors: entry.private_author ? [{ name: entry.private_author }] : [] };

export function ReadingGate({ children, title }) {
  const library = useUserBooks();
  if (library.loading) return title ? <PageFrame title={title} /> : <section className="bv-container"><BookSkeletons count={3} /></section>;
  if (library.error) return <section className="bv-container"><EmptyState error title="Your reading couldn’t load." action={<Button onClick={library.retryLoad}>Try again</Button>}>Your saved reading is unchanged.</EmptyState></section>;
  if (!library.readingActions) return <Navigate to="/my-books" replace />;
  return children;
}

export function ReadingHomePage() {
  const auth = useAuth(), library = useUserBooks();
  const request = useRequest(getReadingHome, `home:${auth.sessionGeneration}:${library.revision}`);
  // Nothing reading or paused: only then is it worth asking whether the account has any books at all.
  const quiet = Boolean(request.data) && !request.data.current_reads.length && !request.data.reading_count && !request.data.paused_count;
  const books = useRequest(() => getLibraryPage({}), `home-books:${auth.sessionGeneration}`, quiet);
  // Once the first-run page has shown, it stays through the first saves instead of switching under the reader.
  const [firstRun, setFirstRun] = useState(false);
  if (!firstRun && books.data?.counts?.all === 0) setFirstRun(true);
  if (firstRun) return <FirstRunHome />;
  if (quiet && books.loading) return <section className="bv-container"><BookSkeletons count={3} /></section>;
  return <section className="bv-container bv-reading-home">
    <div className="bv-home-heading"><PageHeading title="Pick up where you left off." /></div>
    {library.readOnly && <p role="status" className="bv-notice">Your library is available to read. Changes are temporarily paused.</p>}
    <SlowReadingNotice loading={request.loading} />
    <div className="bv-home-layout"><section className="bv-reading-desk" aria-labelledby="bv-current-reading-title">
    <div className="bv-reading-heading"><h2 id="bv-current-reading-title">Your current reading</h2></div>
    {request.loading ? <BookSkeletons count={3} /> : request.error ? <EmptyState error title="Your reading couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Your books haven’t changed.</EmptyState> : <>
      {request.data.current_reads.length ? <div className="bv-current-grid">{request.data.current_reads.map(({ entry, attempt }) => <CurrentReadingCard key={entry.id} entry={entry} attempt={attempt} />)}</div> : <div className="bv-home-start">
        <h2>{request.data.paused_count ? "A book can wait for you." : "Make this reading home your own."}</h2>
        <p className="bv-muted">{request.data.paused_count ? "Your paused books are here whenever you’re ready. Resume one, or choose something different." : "Choose a saved book or find something that catches your eye. Tracking pages and writing notes are always optional."}</p>
        <div className="bv-form-actions">{request.data.paused_count ? <><ActionLink to="/my-books?status=paused">Open paused books</ActionLink><ActionLink to="/browse" variant="secondary">Find a book</ActionLink></> : <><ActionLink to="/browse">Find a book</ActionLink><ActionLink to="/my-books" variant="secondary">Choose from My Books</ActionLink></>}</div>
        {library.libraryImport && !library.readOnly && <p className="bv-muted">Have a reading history somewhere else? <TextLink to="/my-books/import">Bring your library</TextLink> from a CSV or TSV file.</p>}
      </div>}
      {(request.data.reading_count > request.data.current_reads.length || (request.data.paused_count > 0 && request.data.current_reads.length > 0)) && <div className="bv-home-support">{request.data.reading_count > request.data.current_reads.length && <TextLink to="/my-books?status=reading">See all current reads ({request.data.reading_count})</TextLink>}{request.data.paused_count > 0 && request.data.current_reads.length > 0 && <TextLink to="/my-books?status=paused">Paused books ({request.data.paused_count})</TextLink>}</div>}
    </>}
    </section>{library.nextRead && <aside className="bv-home-next" aria-label="Your next beginning"><NextReadSection key={auth.sessionGeneration} preview home /></aside>}</div>
  </section>;
}

function ReadingHistory({ entryId, enabled, onCorrect, onMemory, onRemove, editing, activeAttempt }) {
  const auth = useAuth(), library = useUserBooks();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const cursor = params.get("history_cursor") || "";
  function showHistory(nextCursor = "") {
    const next = new URLSearchParams(params);
    if (nextCursor) next.set("history_cursor", nextCursor); else next.delete("history_cursor");
    setParams(next, { state: location.state });
  }
  const request = useRequest(() => getReadingHistory(entryId, cursor), `history:${auth.sessionGeneration}:${entryId}:${cursor}:${library.revision}`, enabled);
  return <section className="bv-reading-history-content" aria-label="Your reading history">
    {request.loading ? <p role="status">Loading reading history…</p> : request.error ? <EmptyState error title="Your history couldn’t load." action={<><Button onClick={request.retry}>Try again</Button><Button onClick={() => showHistory()} variant="secondary">First readings</Button></>}>Your records haven’t changed.</EmptyState> : <>
      {request.data.items.length ? <ul className="bv-reading-history">{request.data.items.map(attempt => {
        // Each row's buttons name the reading they act on, so repeated rows stay distinguishable.
        const context = `${stateLabel[attempt.state]}, ${attempt.started_on || "start date unknown"}${attempt.ended_on ? ` to ${attempt.ended_on}` : ""}`;
        const memoryLabel = library.readOnly ? "View reading memory" : "Note and reaction";
        return <li key={attempt.id}><strong>{stateLabel[attempt.state]}{attempt.id === activeAttempt?.id ? " · Current reading" : ""}</strong><span>{attempt.started_on || "Start date unknown"}{attempt.ended_on ? ` → ${attempt.ended_on}` : ""}</span><Button variant="quiet" disabled={library.readOnly || editing} aria-label={`Edit dates and progress: ${context}`} onClick={() => onCorrect(attempt)}>Edit dates and progress</Button>{library.privateContext && <Button variant="quiet" disabled={editing} aria-label={`${memoryLabel}: ${context}`} onClick={() => onMemory(attempt)}>{memoryLabel}</Button>}{library.privacyControls && <Button variant="quiet" disabled={library.readOnly || editing} aria-label={`Delete this reading: ${context}`} onClick={() => onRemove(attempt)}>Delete this reading</Button>}</li>;
      })}</ul> : <p>No readings on this page.</p>}
      <div className="bv-form-actions">{cursor && <Button variant="secondary" onClick={() => showHistory()}>First readings</Button>}{request.data.next_cursor && <Button variant="secondary" onClick={() => showHistory(request.data.next_cursor)}>Older readings</Button>}</div>
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

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const shortDate = value => isoDay.test(value || "") ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

// A quiet acknowledgement of a saved finish or stop. Dates appear only when recorded; nothing is required.
// Finish and Stop are single clicks, so the moment carries an obvious undo for this session only.
function FinishMoment({ kind, title, attempt, headingRef, onNote, noteDisabled, onUndo, undoDisabled }) {
  const started = shortDate(attempt?.started_on), ended = shortDate(attempt?.ended_on);
  const stopped = kind === "dnf";
  return <section className="bv-finish-moment" aria-labelledby="bv-finish-title">
    <h2 id="bv-finish-title" ref={headingRef} tabIndex={-1}>{stopped ? `You stopped reading ${title}.` : `You finished ${title}.`}</h2>
    {(started || ended) && <p className="bv-finish-dates">{started && ended ? `Read ${started} – ${ended}` : ended ? `${stopped ? "Stopped" : "Finished"} ${ended}` : `Started ${started}`}</p>}
    <p className="bv-muted">{stopped ? "It stays in your Reading history, with your progress and note." : "No rating or review needed. If something stayed with you, you can keep it here, privately."}</p>
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
  // Opened from My Books or Home: the entry already known there draws the book's identity before the workspace request returns.
  const seed = String(location.state?.entry?.id) === String(entryId) ? location.state.entry : null;
  const [reasonToggled, setReasonToggled] = useState(null);
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
      const fallback = workspaceRoot.current.querySelector(kind === "progress" ? ".bv-workspace-progress h2" : ".bv-workspace-memory h2");
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
  const readingUnavailable = library.readOnly || command.pending || request.loading || Boolean(request.error) || Boolean(editing);
  const blocked = readingUnavailable || Boolean(reread);
  const progressAction = attempt && <Button key="progress" variant={attempt.state === "paused" || terminal ? "quiet" : "primary"} disabled={command.pending || request.loading || Boolean(request.error) || Boolean(editing)} onClick={() => openEditor(attempt)}>{library.readOnly ? "View progress and dates" : terminal ? "Edit dates and progress" : "Update progress"}</Button>;
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
  // One keyed controller stays after My note; a saved finish only resets it to the quiet Want preview.
  const nextSection = library.nextRead && <NextReadSection key={`${auth.sessionGeneration}:${entryId}`} preview currentKey={entry ? entry.book_id ? `book:${entry.book_id}` : `entry:${entry.id}` : null}
    enabled={loaded || Boolean(finished)} finishId={finished?.id} />;
  const momentId = moment?.id;
  useEffect(() => { if (momentId) finishHeading.current?.focus(); }, [momentId]);
  return <section ref={workspaceRoot} className="bv-container bv-reading-workspace bv-editorial-workspace">
    <div className="bv-breadcrumb"><TextLink to={libraryView?.href || "/my-books"} state={libraryView ? { libraryPrevious: libraryView.previous } : null}>Back to My Books</TextLink></div>
    <SlowReadingNotice loading={request.loading} />
    <div className={`bv-workspace-layout${moment ? " bv-workspace-layout--finished" : ""}${editing?.kind === "progress" ? " bv-workspace-layout--progress-open" : ""}`}>
      {!entry && request.loading && seed ? <div key="seed" ref={trackLoading} className="bv-workspace-seed" aria-busy="true"><ReadingBookIdentity entry={seed} /><div className="bv-workspace-reading"><BookSkeletons count={1} /></div></div>
        : !entry && request.loading ? <div key="loading" ref={trackLoading} className="bv-workspace-loading" aria-busy="true"><PageHeading title="Loading your reading…" /><BookSkeletons count={1} /></div>
        : !entry ? <div key="error" ref={trackError} className="bv-workspace-loading"><EmptyState error title="This reading couldn’t load." action={<><Button onClick={() => { restoreHeadingFocus.current = true; request.retry(); }}>Try again</Button><ActionLink to="/my-books" variant="secondary">My Books</ActionLink></>}>It may have been removed, or the server may need a moment.</EmptyState></div>
        : <>
          <ReadingBookIdentity entry={entry} headingRef={completeFocus} flags={<div className="bv-form-actions bv-workspace-flags" role="group" aria-label="Your book flags">{[["is_wanted", "Want to read"], ["is_owned", "I own it"]].map(([flag, label]) => <Button key={flag} variant={entry[flag] ? "saved" : "secondary"} aria-pressed={entry[flag]} disabled={library.readOnly || command.pending || request.loading || Boolean(request.error)} onClick={() => command.run(async () => ({ entry: await updateLibraryEntry(entry.id, { [flag]: !entry[flag], expected_version: entry.version }) }), result => library.readingChanged(result.entry))}>{entry[flag] && <Check aria-hidden="true" />}{label}</Button>)}</div>} />
          <div className="bv-workspace-reading"><ReadingProgress attempt={attempt} statusRef={statusHeading} readOnly={library.readOnly}>
            <div className="bv-workspace-primary-actions" role="group" aria-label="Reading actions" aria-describedby={editing ? "bv-reading-actions-paused" : undefined}>
              {editing && <p id="bv-reading-actions-paused" className="bv-help">Save or close the open editor to use these actions.</p>}
              {!attempt && <Button disabled={blocked} onClick={() => create(entry)}>Start reading</Button>}
              {terminal && !library.readOnly && <>
                {/* A finished or stopped book has no primary action: rereading is a choice, and undo stays quiet. */}
                <Button variant="secondary" disabled={readingUnavailable} onClick={() => setReread({ entry, editionId })}>Read it again</Button>
                <p className="bv-help">Starts a new reading. This one stays in Reading history.</p>
                {/* Right after Finish or Stop the moment offers the undo; on later visits this quiet link does. */}
                {!moment && <p className="bv-workspace-undo">Still reading it? <Button variant="quiet" className="bv-inline-action" disabled={blocked} onClick={markAsReading}>Mark as reading</Button></p>}
              </>}
              {attempt?.state !== "paused" ? progressAction : null}
              {attempt && !terminal && !library.readOnly && <div className="bv-workspace-state-actions">{[...(attempt.state === "reading" ? [["paused", "Pause reading"]] : [["reading", "Resume reading"]]), ["finished", "Finish book"]].map(([state, label]) => <Button key={label} variant={state === "reading" ? "primary" : "secondary"} disabled={blocked} onClick={() => changeState(state)}>{label}</Button>)}</div>}
              {attempt?.state === "paused" ? progressAction : null}
            </div>
            {command.error && <p role="alert" className="bv-notice">{command.error} <Button variant="quiet" onClick={request.retry}>Reload current reading</Button></p>}
            {editing?.kind === "progress" && editor}
            {request.loading && <p role="status" className="bv-help">Updating your reading…</p>}
            {request.error && <p role="alert" className="bv-notice">Your reading couldn’t refresh. Your draft is still here. <Button variant="quiet" onClick={request.retry}>Try again</Button></p>}
          </ReadingProgress></div>
        </>}
      {moment && <FinishMoment kind={moment.state} title={moment.title} attempt={attempt?.id === moment.id ? attempt : null} headingRef={finishHeading}
        onNote={library.privateContext && attempt?.id === moment.id && !attempt.note ? () => openMemory(attempt) : undefined}
        noteDisabled={command.pending || request.loading || Boolean(request.error) || Boolean(editing)}
        onUndo={!library.readOnly && attempt?.id === moment.id ? markAsReading : undefined} undoDisabled={blocked} />}
      {library.privateContext && <section hidden={!loaded} className="bv-workspace-memory" aria-label="My note">{editing?.kind === "memory" ? editor : <h2>My note</h2>}{loaded && <>
        {attempt && editing?.kind !== "memory" && <>{attempt.note && <p className="bv-private-text">{attempt.note}</p>}{attempt.reaction && <p className="bv-help">{reactionLabel[attempt.reaction]}</p>}
          {!attempt.note && !attempt.reaction && <p className="bv-help">{library.readOnly ? "Your note would appear here. Changes are temporarily paused." : "A thought worth keeping? Your note is private and always optional."}</p>}
          <Button data-draft-trigger="memory" variant="secondary" disabled={command.pending || request.loading || Boolean(request.error) || Boolean(editing)} onClick={() => openMemory(attempt)}>{library.readOnly ? "View note" : drafts[draftKey(entryId, "memory", attempt.id)] ? "Continue draft" : attempt.note || attempt.reaction ? "Edit note" : "Add a note"}</Button></>}
        {!attempt && <p className="bv-help">Start a reading to keep a note with it.</p>}
        <details className="bv-save-reason" open={reasonToggled ?? Boolean(entry.save_note)} onToggle={event => setReasonToggled(event.currentTarget.open)}><summary>Why I saved this book</summary>{entry.save_note && <p className="bv-private-text">{entry.save_note}</p>}
          {editing?.kind === "save_note" ? editor : !library.readOnly && <Button data-draft-trigger="save_note" variant="quiet" disabled={command.pending || request.loading || Boolean(request.error) || Boolean(editing)} onClick={() => openDraft("save_note")}>{drafts[draftKey(entryId, "save_note")] ? "Continue save-reason draft" : entry.save_note ? "Edit save reason" : "Add save reason (optional)"}</Button>}
        </details>
      </>}</section>}
      {nextSection}
      <section hidden={!loaded} className="bv-workspace-more" aria-labelledby="bv-workspace-more-title"><h2 id="bv-workspace-more-title">More about this reading</h2>
      {entry && <ReadingBookDetails key={entry.book_id || `private:${entry.id}`} bookId={entry.book_id} description={entry.private_description} entryId={entry.id} />}
      <ReadingHistoryDisclosure entryId={entryId} visible={loaded} activeAttempt={attempt && !terminal ? attempt : null} onCorrect={openEditor} onMemory={openMemory} onRemove={attempt => setRemoval({ entry, attempt })} editing={Boolean(editing) || command.pending || Boolean(removal) || Boolean(reread)} />
      {entry && workspace?.imported_sources_count > 0 && <div className="bv-workspace-imported"><ImportedSources key={`${auth.sessionGeneration}:${entry.id}`} entryId={entry.id} count={workspace.imported_sources_count} /></div>}
      <details hidden={!loaded || library.readOnly} className="bv-workspace-manage" open={manageOpen} onToggle={event => setManageOpen(event.currentTarget.open)}><summary>Manage this book</summary>{loaded && !library.readOnly && <>
        {attempt && !terminal && <div className="bv-workspace-stop"><Button variant="secondary" disabled={blocked} onClick={() => changeState("dnf")}>Stop reading this book</Button><p className="bv-help">For a book you’ve put down for good. You can mark it as reading again later; your progress and note stay.</p></div>}
        {(!attempt || terminal) && workspace.editions.length > 0 && <div className="bv-field"><label htmlFor="reading-edition">Which copy are you reading? (optional)</label><select id="reading-edition" value={editionId} onChange={event => { setEditionId(event.target.value); intent.current = null; }}><option value="">The standard edition</option>{workspace.editions.map(edition => <option key={edition.id} value={edition.id}>{edition.physical_format || "Edition"}{edition.page_count ? ` · ${edition.page_count} pages` : ""} · {(edition.languages || []).join(", ") || "Language not listed"}</option>)}</select><p className="bv-help">Progress uses this copy’s page count, even if book details change later.</p></div>}
        <div className="bv-form-actions bv-workspace-actions">
          {(!attempt || terminal) && <><Button variant="quiet" disabled={blocked} onClick={() => create(entry, "finished")}>Log an earlier read I finished</Button><Button variant="quiet" disabled={blocked} onClick={() => create(entry, "dnf")}>Log an earlier read I stopped</Button></>}
        </div>
        {/* Forgetting is permanent, so it sits apart from routine actions and reads as destructive. */}
        {library.privacyControls && <div className="bv-workspace-forget"><Button variant="danger-outline" disabled={command.pending || Boolean(editing) || Boolean(removal)} onClick={() => setRemoval({ entry })}>Forget this book</Button>
          <p className="bv-help">Turning off Owned or Want to read keeps your reading history. Forget this book removes everything you’ve saved about it.</p></div>}
      </>}</details>
      </section>
    </div>
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
  return <section className="bv-container bv-private-entry"><PageHeading title="Add one book manually">This book stays private to your library.</PageHeading>
    {library.libraryImport && !library.readOnly && <p className="bv-notice">Have a library file instead? <TextLink to="/my-books/import">Bring your library</TextLink> imports many books from CSV or TSV.</p>}
    {library.readOnly && <p role="status" className="bv-notice">Your library is available to read. Changes are temporarily paused.</p>}
    <form className="bv-field bv-reading-form" onSubmit={event => { event.preventDefault(); submit(); }}><fieldset disabled={library.readOnly || command.pending}><legend>Book details</legend>
      <label htmlFor="private-title">Title</label><input id="private-title" required maxLength={500} value={title} onChange={event => { setTitle(event.target.value); setMatches(null); }} />
      <label htmlFor="private-author">Author (optional)</label><input id="private-author" maxLength={500} value={author} onChange={event => { setAuthor(event.target.value); setMatches(null); }} />
      <Button type="submit">{command.pending ? "Checking…" : "Add private book"}</Button></fieldset></form>
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
