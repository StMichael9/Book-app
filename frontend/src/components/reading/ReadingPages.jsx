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
    </section>{library.nextRead && <aside className="bv-home-next" aria-label="Your next beginning"><NextReadSection key={auth.sessionGeneration} /></aside>}</div>
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

function ProgressForm({ attempt, version, readOnly, onSaved, onDirty }) {
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
  const configured = Boolean(attempt.progress_unit);
  const [settingsOpen, setSettingsOpen] = useState(terminal || readOnly);
  const format = <><label htmlFor="reading-unit">Progress</label><select id="reading-unit" value={unit} onChange={event => { setUnit(event.target.value); onDirty(); }}><option value="">Not tracking</option><option value="pages">Pages</option><option value="percent">Percent</option></select></>;
  return <form className="bv-field bv-reading-form" onSubmit={event => {
    event.preventDefault();
    command.run(() => updateReadingAttempt(attempt.id, { expected_version: expectedVersion,
      progress_unit: unit || null, progress_value: unit && value !== "" ? Number(value) : null,
      total_pages: total === "" ? null : Number(total), started_on: started || null, ...(terminal ? { ended_on: ended || null } : {}) }), onSaved);
  }}>
    <ReadingDraftIdentity attempt={attempt} />
    <fieldset disabled={readOnly || command.pending}><legend>Update your progress</legend>
      {!configured && format}
      {unit && <><label htmlFor="reading-progress">{unit === "pages" ? "Current page" : "Percent complete"}</label><input id="reading-progress" type="number" inputMode="numeric" min="0" max={unit === "percent" ? 100 : undefined} step="1" required value={value} onChange={event => { setValue(event.target.value); onDirty(); }} /></>}
      <Button type="submit">{command.pending ? "Saving…" : "Save progress"}</Button>
      <details className="bv-progress-settings" open={settingsOpen} onToggle={event => setSettingsOpen(event.currentTarget.open)}><summary>Format, copy & dates</summary>
        <p className="bv-help">Use your copy’s page total. Dates are optional. Reaching 100% doesn’t finish the book.</p>
        {configured && format}
        <label htmlFor="reading-total">Total pages (optional)</label><input id="reading-total" type="number" min="1" step="1" value={total} onChange={event => { setTotal(event.target.value); onDirty(); }} />
        <label htmlFor="reading-started">Started on (optional)</label><input id="reading-started" type="date" value={started} onChange={event => { setStarted(event.target.value); onDirty(); }} />
        {terminal && <><label htmlFor="reading-ended">Ended on (optional)</label><input id="reading-ended" type="date" value={ended} onChange={event => { setEnded(event.target.value); onDirty(); }} /></>}
      </details>
    </fieldset>
    {command.error && <p role="alert">{command.error} Your draft is still here. Close and reopen this form to load the current reading before reapplying a conflicting change.</p>}
  </form>;
}

function ContextForm({ draft, readOnly, onSaved, onDirty }) {
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
      <p className="bv-help">Private to you. Clearing a field removes it when you save.</p>
      <label htmlFor="reading-context">{isReason ? "Save reason (optional)" : "Where I left off / what I want to remember (optional)"}</label>
      <textarea id="reading-context" rows={4} maxLength={isReason ? 500 : 2000} value={text} onChange={event => { setText(event.target.value); onDirty(); }} />
      <small>{text.length} / {isReason ? 500 : 2000}</small>
      <Button type="submit">{command.pending ? "Saving…" : isReason ? "Save reason" : "Save note"}</Button>
      {!isReason && <details className="bv-note-options"><summary>Reaction (optional)</summary><label htmlFor="reading-reaction">Reaction (optional)</label><select id="reading-reaction" value={reaction} onChange={event => { setReaction(event.target.value); onDirty(); }}><option value="">No reaction</option>{Object.entries(reactionLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></details>}
    </fieldset>
    {command.error && <p role="alert">{command.error} Your draft is still here. Close and reload before reapplying a conflicting edit.</p>}
  </form>;
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
  const [dirty, setDirty] = useState(false);
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
  // Protect explicit link departures and browser reloads. Session expiry and
  // account changes still unmount private drafts without blocking sign-out.
  useEffect(() => {
    if (!editing || !dirty) return undefined;
    const unload = event => { event.preventDefault(); event.returnValue = ""; };
    const leave = event => {
      const link = event.target.closest?.("a[href]");
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, location.href);
      if (url.origin === location.origin && url.pathname === location.pathname) return;
      if (!window.confirm("Discard your unsaved changes and leave this book?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", leave, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", leave, true); };
  }, [editing, dirty]);
  function accept(result) {
    library.readingChanged(result.entry); setEditing(null); setDirty(false); intent.current = null;
    if (result.attempt && result.attempt.state !== "finished") { setFinishNotice(null); setNextDismissed(false); }
  }
  function create(entry, state = "reading") {
    const key = `${entry.id}:${state}`;
    if (intent.current?.key !== key) intent.current = { key, id: crypto.randomUUID() };
    command.run(() => createReadingAttempt(intent.current.id, { entry_id: entry.id, expected_version: entry.version, state,
      ...(editionId ? { edition_id: Number(editionId) } : {}) }), accept);
  }
  const entry = request.data?.entry, attempt = request.data?.current_attempt;
  const book = entry ? displayBook(entry) : null, terminal = attempt && ["finished", "dnf"].includes(attempt.state);
  const selected = editing?.attempt;
  const openEditor = attempt => { setDirty(false); setEditing({ kind: "progress", attempt, version: entry.version }); };
  function openMemory(attempt) {
    command.run(() => getReadingAttempt(attempt.id), result => { setDirty(false); setEditing({
      kind: "memory", attempt: result.attempt, version: result.entry.version }); });
  }
  const loaded = !request.loading && !request.error && Boolean(entry);
  const finished = library.nextRead && finishNotice?.generation === auth.sessionGeneration &&
    (!request.data || (attempt?.id === finishNotice.id && attempt.state === "finished")) ? finishNotice : null;
  const blocked = library.readOnly || command.pending || Boolean(editing);
  const progressAction = attempt && <Button key="progress" variant={attempt.state === "paused" || terminal ? "quiet" : "primary"} disabled={command.pending || Boolean(editing)} onClick={() => openEditor(attempt)}>{library.readOnly ? "View progress and dates" : terminal ? "Correct progress or dates" : "Update progress"}</Button>;
  // A keyed direct child can move for Finish without remounting its controller.
  // The quiet preview follows secondary sections in both DOM and phone order.
  const nextSection = library.nextRead && <NextReadSection key={`${auth.sessionGeneration}:${entryId}`} preview currentKey={entry ? entry.book_id ? `book:${entry.book_id}` : `entry:${entry.id}` : null}
    enabled={loaded || Boolean(finished)} hidden={nextDismissed && !finished} finishId={finished?.id} finishedTitle={finished?.title}
    onSkip={finished ? () => { setFinishNotice(null); setNextDismissed(true); (statusHeading.current || document.getElementById("bv-main"))?.focus(); } : undefined} />;
  return <section className="bv-container bv-reading-workspace bv-editorial-workspace">
    <div className="bv-breadcrumb"><TextLink to="/my-books">Back to My Books</TextLink></div>
    <SlowReadingNotice loading={request.loading} />
    <div className={`bv-workspace-layout${finished ? " bv-workspace-layout--finished" : ""}`}>
      {request.loading ? <div key="loading" ref={trackLoading} className="bv-workspace-loading" aria-busy="true"><PageHeading title="Loading your reading…" /><BookSkeletons count={1} /></div>
        : request.error || !entry ? <div key="error" ref={trackError} className="bv-workspace-loading"><EmptyState error title="This reading couldn’t load." action={<><Button onClick={() => { restoreHeadingFocus.current = true; request.retry(); }}>Try again</Button><ActionLink to="/my-books" variant="secondary">My Books</ActionLink></>}>It may have been removed, or the server may need a moment.</EmptyState></div>
        : <>
          <ReadingBookIdentity entry={entry} headingRef={completeFocus} flags={<p className="bv-help">{[entry.is_owned && "Owned", entry.is_wanted && "On your Want list"].filter(Boolean).join(" · ")}</p>} />
          <ReadingProgress attempt={attempt} statusRef={statusHeading} readOnly={library.readOnly}>
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
          </ReadingProgress>
          <ReadingBookDetails key={entry.book_id || `private:${entry.id}`} bookId={entry.book_id} />
        </>}
      {finished ? nextSection : null}
      {/* Keep the editor at this stable sibling position, outside the loading
          branch. Its original record/version must survive flag refetches. */}
      {editing && <div className="bv-reading-draft bv-workspace-editor">{editing.kind === "progress" ? <ProgressForm key={`${selected.id}:${entryId}`} attempt={selected} version={editing.version} readOnly={library.readOnly || command.pending} onSaved={accept} onDirty={() => setDirty(true)} /> : <ContextForm key={`${editing.kind}:${selected?.id || editing.entry.id}:${entryId}`} draft={editing} readOnly={library.readOnly || command.pending} onSaved={accept} onDirty={() => setDirty(true)} />}
        <p className="bv-help">Own and Want changes keep this draft. Save or close the editor before other reading actions. Closing discards unsaved edits and reloads the saved reading.</p>
        <Button variant="quiet" onClick={() => { setEditing(null); setDirty(false); request.retry(); }}>Close editor and reload</Button>
        {editing.kind === "progress" && ["finished", "dnf"].includes(selected.state) && selected.id !== attempt?.id && <Button disabled={!entry || library.readOnly || command.pending} onClick={() => command.run(() => updateReadingAttempt(selected.id, { expected_version: entry.version, state: "reading" }), accept)}>Reopen selected reading (discard unsaved edits)</Button>}
      </div>}
      {library.privateContext && <section hidden={!loaded || (editing?.kind === "memory" && selected?.id === attempt?.id)} className="bv-workspace-memory" aria-label="My reading memory"><h2>My note</h2>{loaded && <>
        {attempt && <>{attempt.note && <p className="bv-private-text">{attempt.note}</p>}{attempt.reaction && <p className="bv-help">{reactionLabel[attempt.reaction]}</p>}
          {!attempt.note && !attempt.reaction && <p className="bv-help">{library.readOnly ? "Your note would appear here. Changes are temporarily paused." : "A thought worth keeping? Your note is private and always optional."}</p>}
          <Button variant="secondary" disabled={command.pending || Boolean(editing)} onClick={() => openMemory(attempt)}>{library.readOnly ? "View note" : attempt.note || attempt.reaction ? "Edit note" : "Add a note"}</Button></>}
        {!attempt && <p className="bv-help">Start a reading to keep a note with it.</p>}
        <details className="bv-save-reason" open={reasonOpen} onToggle={event => setReasonOpen(event.currentTarget.open)}><summary>Why I saved this book</summary>{entry.save_note && <p className="bv-private-text">{entry.save_note}</p>}
          {!library.readOnly && <Button variant="quiet" disabled={command.pending || Boolean(editing)} onClick={() => { setDirty(false); setEditing({ kind: "save_note", entry, version: entry.version }); }}>{entry.save_note ? "Edit save reason" : "Add save reason (optional)"}</Button>}
        </details>
      </>}</section>}
      <ReadingHistoryDisclosure entryId={entryId} visible={loaded} onCorrect={openEditor} onMemory={openMemory} onRemove={attempt => setRemoval({ entry, attempt })} editing={Boolean(editing) || command.pending || Boolean(removal)} />
      {entry && request.data?.imported_sources_count > 0 && <div className="bv-workspace-imported"><ImportedSources key={`${auth.sessionGeneration}:${entry.id}`} entryId={entry.id} count={request.data.imported_sources_count} /></div>}
      <details hidden={!loaded || library.readOnly} className="bv-workspace-manage" open={manageOpen} onToggle={event => setManageOpen(event.currentTarget.open)}><summary>Manage this book</summary>{loaded && !library.readOnly && <>
        <div className="bv-form-actions bv-workspace-flags" role="group" aria-label="Your book flags">{[["is_owned", "Own"], ["is_wanted", "Want"]].map(([flag, label]) => <Button key={flag} variant={entry[flag] ? "saved" : "secondary"} aria-pressed={entry[flag]} disabled={command.pending} onClick={() => command.run(async () => ({ entry: await updateLibraryEntry(entry.id, { [flag]: !entry[flag], expected_version: entry.version }) }), result => library.readingChanged(result.entry))}>{label}</Button>)}</div>
        <p className="bv-help">Own and Want are separate. Changing either keeps your readings and this draft.</p>
        {terminal && <p className="bv-help">This reading is saved. Start again for a new read, or reopen to correct this same record.</p>}
        {(!attempt || terminal) && request.data.editions.length > 0 && <div className="bv-field"><label htmlFor="reading-edition">Your copy for the new reading (optional)</label><select id="reading-edition" value={editionId} onChange={event => { setEditionId(event.target.value); intent.current = null; }}><option value="">Catalogue preferred edition</option>{request.data.editions.map(edition => <option key={edition.id} value={edition.id}>{edition.physical_format || "Edition"}{edition.page_count ? ` · ${edition.page_count} pages` : ""} · {(edition.languages || []).join(", ") || "Language not listed"}</option>)}</select><p className="bv-help">Saved progress keeps this copy’s page total even if catalogue metadata changes.</p></div>}
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
