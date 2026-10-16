import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createReadingAttempt, ensureLibraryBook, getNextRead, getReadingWorkspace, lookupLibraryBooks } from "../../api/reading.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { useRequest } from "../ui-v2/data.js";
import { BookCover, Button, TextLink } from "../ui-v2/primitives.jsx";

function reasonText(reason) {
  switch (reason.code) {
    case "want": return "On your Want list.";
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
  const book = choice.book || { title: choice.private_title, authors: choice.private_author ? [{ name: choice.private_author }] : [] };
  return <article className="bv-book-card"><BookCover book={book} /><h3>{book.title}</h3>
    <p className="bv-author">{book.authors.map(author => author.name).join(", ") || "Author not listed"}</p>
    <p className="bv-help">{choice.reasons.slice(0, 2).map(reasonText).join(" ")}</p>
    {choice.revisit && <p className="bv-help">Back on Want · previously finished or stopped.</p>}
    {!choice.book && <p className="bv-help">Private book · only in your library</p>}
    <Button disabled={disabled} aria-label={`Start reading ${book.title}`} onClick={onStart}>{pending ? "Opening…" : "Start reading"}</Button>
    <TextLink to={choice.entry_id ? `/my-books/${choice.entry_id}` : `/book/${book.id}`}>{choice.entry_id ? "Open your book" : "About this book"}</TextLink>
  </article>;
}

export default function NextReadSection({ onSkip }) {
  const auth = useAuth(), library = useUserBooks();
  const go = useNavigate(), command = useReadingCommand();
  const intent = useRef(null);
  const [chosen, setChosen] = useState(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const filterForm = useRef(null);
  const [settings, setSettings] = useState({ source: "want", owned_only: false, interest_id: "", max_pages: "", rotation: 0, exclude: [] });
  const request = useRequest(async () => {
    const result = await getNextRead({ ...settings, session_id: sessionId });
    if (!Array.isArray(result?.items) || result.items.length > 3 || !Array.isArray(result.interests) ||
        !Number.isInteger(result.eligible_count) || !Number.isInteger(result.remaining_count) ||
        result.items.some(item => typeof item.key !== "string" || !Array.isArray(item.reasons) ||
          (item.book ? !Number.isSafeInteger(item.book.id) || !Array.isArray(item.book.authors) : !Number.isSafeInteger(item.entry_id) || typeof item.private_title !== "string"))) {
      throw new Error("Unable to load choices");
    }
    return result;
  },
    `next:${auth.sessionGeneration}:${library.revision}:${sessionId}:${JSON.stringify(settings)}`);
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
  return <section className="bv-section bv-next-read" aria-label="Choose your next read">
    <h2>What would you like to read next?</h2><p className="bv-help">A few choices, not a prediction. Start with your Want books; you can always skip this.</p>
    {onSkip && <Button variant="quiet" disabled={command.pending} onClick={onSkip}>Not now</Button>}
    <div className="bv-form-actions" role="group" aria-label="Choice source"><Button disabled={command.pending} variant={settings.source === "want" ? "saved" : "quiet"} aria-pressed={settings.source === "want"} onClick={() => switchSource("want")}>My Want books</Button><Button disabled={command.pending} variant={settings.source === "catalogue" ? "saved" : "quiet"} aria-pressed={settings.source === "catalogue"} onClick={() => switchSource("catalogue")}>Explore something new</Button></div>
    <p className="bv-help">{settings.source === "want" ? "From your Want list only. Active and paused readings are excluded." : "From the catalogue, not your Want queue. Previously finished or stopped books stay out unless you put them back on Want and switch to My Want books."}</p>
    {library.readOnly && <p role="status">You can view choices. Starting a reading is temporarily paused.</p>}
    {result && <details className="bv-field"><summary>Refine choices (optional)</summary><form ref={filterForm} className="bv-reading-form" onSubmit={event => {
      event.preventDefault(); const values = new FormData(event.currentTarget);
      setSettings(current => ({ ...current, owned_only: values.has("owned"), interest_id: String(values.get("interest") || ""), max_pages: String(values.get("pages") || ""), rotation: 0, exclude: [] }));
    }}><fieldset disabled={command.pending}><legend>Your choice for now</legend>
      <label><input type="checkbox" name="owned" defaultChecked={settings.owned_only} /> Only books I marked Own</label>
      <label htmlFor={`next-interest-${sessionId}`}>Subject (optional)</label><select id={`next-interest-${sessionId}`} name="interest" defaultValue={settings.interest_id}><option value="">Any supported subject</option>{result.interests.map(item => <option key={item.id} value={item.id}>{item.name} ({item.count})</option>)}</select>
      {result.known_page_count > 0 || settings.max_pages ? <><label htmlFor={`next-pages-${sessionId}`}>At most this many pages (optional)</label><input id={`next-pages-${sessionId}`} name="pages" type="number" min="1" max="100000" step="1" placeholder="For example, 300" defaultValue={settings.max_pages} /></> : <p className="bv-help">No reliable catalogue page counts are available for this selection.</p>}
      <p className="bv-help">A page limit includes only books with a known catalogue page count. Private books may have no length or subject metadata; clearing filters brings them back.</p><Button type="submit">Update choices</Button><Button variant="quiet" onClick={() => reset()}>Clear filters and start over</Button>
    </fieldset></form></details>}
    {command.error && <p role="alert">{command.error} Your other readings haven’t changed. <Button variant="quiet" disabled={command.pending} onClick={request.retry}>Reload choices</Button></p>}
    {request.loading ? <p role="status">Finding a few choices…</p> : request.error ? <div role="alert"><p>Choices couldn’t load. Your library and any saved finish are unchanged.</p><Button onClick={request.retry}>Try choices again</Button><Button variant="quiet" onClick={() => reset()}>Clear choice filters</Button></div> : <>
      {result.items.length ? <div className="bv-book-grid">{result.items.map(choice => <NextReadCard key={`${settings.source}:${choice.key}`} choice={choice} disabled={library.readOnly || command.pending} pending={command.pending && chosen === choice.key} onStart={() => begin(choice)} />)}</div> : <p role="status">{result.eligible_count ? "You’ve seen the available choices for these settings. Start over or change a filter." : settings.source === "want" ? "No Want books match these choices. Clear filters, add a book to Want, or explicitly explore the catalogue." : "No catalogue books match these choices. Clear filters or browse for yourself."}</p>}
      <div className="bv-form-actions">{result.items.length > 0 && result.remaining_count > result.items.length && settings.rotation < 10000 && <Button disabled={command.pending} variant="secondary" onClick={() => setSettings(current => ({ ...current, rotation: current.rotation + 1, exclude: [...new Set([...current.exclude, ...result.items.map(item => item.key)])].slice(-30) }))}>Show different choices</Button>}
        <Button disabled={command.pending} variant="quiet" onClick={() => reset()}>Start choices over</Button><TextLink to="/browse">Browse for myself</TextLink></div>
      <p className="bv-help">Different choices don’t remove books or record a dislike. Rotation stays in this page, not a permanent taste profile.</p>
    </>}
  </section>;
}
