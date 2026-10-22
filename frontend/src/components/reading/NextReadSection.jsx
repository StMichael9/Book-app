import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createReadingAttempt, ensureLibraryBook, getNextRead, getReadingWorkspace, lookupLibraryBooks } from "../../api/reading.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { useRequest } from "../ui-v2/data.js";
import { BookCover, Button, TextLink } from "../ui-v2/primitives.jsx";

function reasonText(reason) {
  switch (reason.code) {
    case "want": return "On your Want to read list.";
    case "catalogue": return "From the shared catalogue.";
    case "owned": return "You marked this as owned.";
    case "interest": return `Matches your choice: ${reason.value}.`;
    case "preferences": return "Matches your saved discovery subjects.";
    case "pages": return `Catalogue lists ${reason.value} pages. Your copy may differ.`;
    default: return "";
  }
}

async function startChoice(choice, source, identity, assertCurrent) {
    let entryId = choice.entry_id;
    if (!entryId) {
      const existing = (await lookupLibraryBooks([choice.book.id])).items[0];
      assertCurrent();
      if (existing.entry_id) entryId = existing.entry_id;
      else {
        const saved = await ensureLibraryBook(choice.book.id, { is_wanted: false });
        assertCurrent(); entryId = saved.id;
      }
    }
    const workspace = await getReadingWorkspace(entryId);
    assertCurrent();
    if (["reading", "paused"].includes(workspace.current_attempt?.state)) return { entry: workspace.entry };
    if ((choice.version && workspace.entry.version !== choice.version) ||
        (source === "want" && !workspace.entry.is_wanted) ||
        (source === "catalogue" && workspace.current_attempt)) {
      throw Object.assign(new Error("Choice changed"), { detail: "This book changed. Reload choices before starting a new reading." });
    }
    return createReadingAttempt(identity, { entry_id: entryId, expected_version: workspace.entry.version, started_via: "next_read" });
}

function NextReadCard({ choice, disabled, pending, onStart }) {
  const book = choice.book || { title: choice.private_title, cover_image_url: choice.private_catalogue?.cover_image_url, authors: choice.private_author ? [{ name: choice.private_author }] : [] };
  return <article className="bv-book-card"><BookCover book={book} /><h3>{book.title}</h3>
    <p className="bv-author">{book.authors.map(author => author.name).join(", ") || "Author not listed"}</p>
    <p className="bv-help">{choice.reasons.slice(0, 2).map(reasonText).join(" ")}</p>
    {choice.revisit && <p className="bv-help">Back on Want · previously finished or stopped.</p>}
    {!choice.book && <p className="bv-help">Private book · only in your library</p>}
    <Button disabled={disabled} aria-label={`Start reading ${book.title}`} onClick={onStart}>{pending ? "Opening…" : "Start reading"}</Button>
    <TextLink to={choice.entry_id ? `/my-books/${choice.entry_id}` : `/book/${book.id}`}>{choice.entry_id ? "Open your book" : "About this book"}</TextLink>
  </article>;
}

const defaultSettings = () => ({ source: "want", owned_only: false, interest_id: "", max_pages: "", rotation: 0, exclude: [] });

export default function NextReadSection({ onSkip, preview = false, home = false, currentKey, finishId, finishedTitle, enabled = true, hidden = false }) {
  const auth = useAuth(), library = useUserBooks();
  const go = useNavigate(), command = useReadingCommand();
  const intent = useRef(null);
  const [chosen, setChosen] = useState(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const filterForm = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const heading = useRef(null), finishHeading = useRef(null), previewButton = useRef(null), returning = useRef(false);
  const scope = finishId ? `finish:${finishId}` : "choices";
  const [stored, setStored] = useState(() => ({ scope, values: defaultSettings() }));
  const settings = stored.scope === scope ? stored.values : defaultSettings();
  function setSettings(update) {
    setStored(previous => {
      const values = previous.scope === scope ? previous.values : defaultSettings();
      return { scope, values: typeof update === "function" ? update(values) : update };
    });
  }
  // One controller survives preview expansion and a saved finish. The existing
  // exclusion contract keeps the current book out of a workspace preview.
  const values = { ...settings, exclude: currentKey && !finishId
    ? [currentKey, ...settings.exclude.filter(key => key !== currentKey).slice(-29)] : settings.exclude, session_id: sessionId };
  useEffect(() => { if (finishId) finishHeading.current?.focus(); }, [finishId]);
  useEffect(() => {
    if (!preview || finishId) return;
    if (expanded) heading.current?.focus();
    else if (returning.current) { returning.current = false; previewButton.current?.focus(); }
  }, [expanded, preview, finishId]);
  const request = useRequest(async () => {
    const result = await getNextRead(values);
    if (!Array.isArray(result?.items) || result.items.length > 3 || !Array.isArray(result.interests) ||
        !Number.isInteger(result.eligible_count) || !Number.isInteger(result.remaining_count) ||
        result.items.some(item => typeof item.key !== "string" || !Array.isArray(item.reasons) ||
          (item.book ? !Number.isSafeInteger(item.book.id) || !Array.isArray(item.book.authors) : !Number.isSafeInteger(item.entry_id) || typeof item.private_title !== "string"))) {
      throw new Error("Unable to load choices");
    }
    return result;
  },
    `next:${auth.sessionGeneration}:${library.revision}:${JSON.stringify(values)}`, enabled && !hidden);
  function reset(source = settings.source) {
    filterForm.current?.reset();
    setSettings({ source, owned_only: false, interest_id: "", max_pages: "", rotation: 0, exclude: [] });
  }
  function switchSource(source) {
    setSettings(current => ({ ...current, source, rotation: 0, exclude: [] }));
  }
  function begin(choice) {
    if (intent.current?.key !== choice.key) intent.current = { key: choice.key, id: crypto.randomUUID() };
    setChosen(choice.key);
    command.run(assertCurrent => startChoice(choice, settings.source, intent.current.id, assertCurrent), result => {
      library.readingChanged(result.entry); go(`/my-books/${result.entry.id}`);
    });
  }
  const result = request.data;
  if (hidden || !enabled) return null;
  if (preview && !expanded && !finishId) {
    const choice = result?.items[0];
    const book = choice?.book || (choice ? { title: choice.private_title, cover_image_url: choice.private_catalogue?.cover_image_url, authors: choice.private_author ? [{ name: choice.private_author }] : [] } : null);
    return <section className="bv-workspace-next" aria-label={home ? "Choose your next read" : "Next after this"}><h2>{home ? "Your next read" : "Next after this"}</h2>
      <p className="bv-help">From your Want to read list.</p>
      {request.loading ? <p role="status" className="bv-help">Finding a choice…</p> : request.error ? <><p role="status" className="bv-muted">Choices couldn’t load. Your reading is unchanged.</p><Button variant="quiet" onClick={request.retry}>Try choices again</Button></> : choice ?
        <article className="bv-workspace-next-book"><BookCover book={book} /><div><h3>{book.title}</h3><p className="bv-author">{book.authors.map(author => author.name).join(", ") || "Author not listed"}</p>{choice.reasons.some(reason => reason.code !== "want") && <p className="bv-help">{choice.reasons.filter(reason => reason.code !== "want").slice(0, 2).map(reasonText).join(" ")}</p>}<TextLink to={choice.entry_id ? `/my-books/${choice.entry_id}` : `/book/${book.id}`}>Open your book</TextLink></div></article>
        : <p className="bv-muted">Nothing is on your Want to read list yet. Mark a book Want to read, or explore other choices.</p>}
      <Button ref={previewButton} variant="quiet" onClick={() => setExpanded(true)}>{home ? "Choose next" : "Explore more choices"}</Button>
    </section>;
  }
  return <section className={`bv-section bv-next-read${finishId ? " bv-finish-choices" : ""}${preview ? " bv-workspace-next-full" : ""}`} aria-label="Choose your next read">
    {finishId && <><h2 ref={finishHeading} tabIndex={-1}>Reading saved.</h2><p>You finished {finishedTitle}. No note, rating or progress entry is required.</p></>}
    <h2 ref={heading} tabIndex={preview ? -1 : undefined}>What would you like to read next?</h2><p className="bv-help">A few choices, not a prediction. Start with your Want to read books; you can always skip this.</p>
    {onSkip && <Button variant="quiet" disabled={command.pending} onClick={onSkip}>Not now</Button>}
    {preview && !finishId && <Button variant="quiet" disabled={command.pending} onClick={() => { returning.current = true; setSettings(defaultSettings()); setExpanded(false); }}>{home ? "Back to Home" : "Back to this reading"}</Button>}
    <div className="bv-form-actions" role="group" aria-label="Choice source"><Button disabled={command.pending} variant={settings.source === "want" ? "saved" : "quiet"} aria-pressed={settings.source === "want"} onClick={() => switchSource("want")}>My Want to read books</Button><Button disabled={command.pending} variant={settings.source === "catalogue" ? "saved" : "quiet"} aria-pressed={settings.source === "catalogue"} onClick={() => switchSource("catalogue")}>Explore something new</Button></div>
    <p className="bv-help">{settings.source === "want" ? "From your Want to read list. Books you’re reading or have paused stay out." : "New choices from the catalogue. Books with a reading history stay out."}</p>
    {library.readOnly && <p role="status">You can view choices. Starting a reading is temporarily paused.</p>}
    {result && <details className="bv-field"><summary>Refine choices (optional)</summary><form key={scope} ref={filterForm} className="bv-reading-form" onSubmit={event => {
      event.preventDefault(); const values = new FormData(event.currentTarget);
      setSettings(current => ({ ...current, owned_only: values.has("owned"), interest_id: String(values.get("interest") || ""), max_pages: String(values.get("pages") || ""), rotation: 0, exclude: [] }));
    }}><fieldset disabled={command.pending}><legend>Your choice for now</legend>
      <label><input type="checkbox" name="owned" defaultChecked={settings.owned_only} /> Only books I own</label>
      <label htmlFor={`next-interest-${sessionId}`}>Subject (optional)</label><select id={`next-interest-${sessionId}`} name="interest" defaultValue={settings.interest_id}><option value="">Any supported subject</option>{result.interests.map(item => <option key={item.id} value={item.id}>{item.name} ({item.count})</option>)}</select>
      {result.known_page_count > 0 || settings.max_pages ? <><label htmlFor={`next-pages-${sessionId}`}>At most this many pages (optional)</label><input id={`next-pages-${sessionId}`} name="pages" type="number" min="1" max="100000" step="1" placeholder="For example, 300" defaultValue={settings.max_pages} /></> : <p className="bv-help">No reliable catalogue page counts are available for this selection.</p>}
      <p className="bv-help">A page limit includes only known catalogue lengths. Some private books have no length or subject; clear filters to see them.</p><Button type="submit">Update choices</Button><Button variant="quiet" onClick={() => reset()}>Clear filters and start over</Button>
    </fieldset></form></details>}
    {command.error && <p role="alert">{command.error} Your other readings haven’t changed. <Button variant="quiet" disabled={command.pending} onClick={request.retry}>Reload choices</Button></p>}
    {request.loading ? <p role="status">Finding a few choices…</p> : request.error ? <div role="alert"><p>Choices couldn’t load. Your library and any saved finish are unchanged.</p><Button onClick={request.retry}>Try choices again</Button><Button variant="quiet" onClick={() => reset()}>Clear choice filters</Button></div> : <>
      {result.items.length ? <div className="bv-choice-grid">{result.items.map(choice => <NextReadCard key={`${settings.source}:${choice.key}`} choice={choice} disabled={library.readOnly || command.pending} pending={command.pending && chosen === choice.key} onStart={() => begin(choice)} />)}</div> : <p role="status">{result.eligible_count ? currentKey && !finishId && settings.rotation === 0 && !settings.exclude.length ? "No other books match these choices. Clear filters or explore another source." : "You’ve seen the available choices for these settings. Start over or change a filter." : settings.source === "want" ? "No Want to read books match these choices. Clear filters, add a book to Want, or explicitly explore the catalogue." : "No catalogue books match these choices. Clear filters or browse for yourself."}</p>}
      <div className="bv-form-actions">{result.items.length > 0 && result.remaining_count > result.items.length && settings.rotation < 10000 && <Button disabled={command.pending} variant="secondary" onClick={() => setSettings(current => ({ ...current, rotation: current.rotation + 1, exclude: [...new Set([...current.exclude, ...result.items.map(item => item.key)])].slice(-30) }))}>Show different choices</Button>}
        {(settings.rotation > 0 || !result.items.length) && <Button disabled={command.pending} variant="quiet" onClick={() => reset()}>Start choices over</Button>}<TextLink to="/browse">Browse for myself</TextLink></div>
    </>}
  </section>;
}
