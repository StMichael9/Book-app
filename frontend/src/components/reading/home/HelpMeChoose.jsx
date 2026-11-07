import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getLibraryPage } from "../../../api/reading.js";
import { useReadingCommand } from "../../../hooks/useReadingCommand.js";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { Button } from "../../ui-v2/primitives.jsx";
import PickCard from "./PickCard.jsx";
import NextReadSection from "../NextReadSection.jsx";
import { PICKS_PER_TRY, cardFromEntry, startable, startReading } from "./homeLogic.js";

const lower = text => text.charAt(0).toLowerCase() + text.slice(1);

// What each pill asks of /me/library. Books come from Want to read and from what you own, so most pills ask twice and merge.
function pillsFor(shelf) {
  const counts = shelf?.counts || {}, facets = shelf?.facets || {};
  const shortCount = (facets.length || []).find(item => item.value === "short")?.count || 0;
  const top = (facets.subject || [])[0];
  return [
    { key: "short", text: "Something short", enabled: shortCount > 0, filters: { length: "short" }, from: ["want", "owned"], about: "short books you own or want · under 250 pages" },
    { key: "owned", text: "Something I own", enabled: (counts.owned || 0) > 0, filters: {}, from: ["owned"], about: "books you own and haven’t started" },
    ...(top ? [{ key: "subject", text: `More ${lower(top.label)}`, enabled: top.count > 0, filters: { subject: String(top.value) }, from: ["want", "owned"], about: `${lower(top.label)} you own or want` }] : []),
    { key: "waiting", text: "Waiting longest", enabled: (counts.want || 0) + (counts.owned || 0) > 0, filters: {}, from: ["want", "owned"], about: "books you’ve been waiting longest to read", oldest: true },
  ];
}

const pagesFor = (pill, sort) => Promise.all(pill.from.map(source => getLibraryPage({ facet: source === "want" ? "want" : "all", ...(source === "owned" ? { owned: "true" } : {}), sort, limit: "100", ...pill.filters })));

async function fetchPicks(pill, oldest) {
  let lists, flip = false;
  if (pill.oldest) {
    // The server can sort oldest first; until it can, the newest 100 are read from the other end.
    try { lists = await pagesFor(pill, "added_oldest"); } catch { lists = await pagesFor(pill, "added"); flip = true; }
  } else lists = await pagesFor(pill, "added");
  const seen = new Set(), merged = [];
  for (const entry of lists.flatMap(page => page.items)) if (!seen.has(entry.id) && startable(entry)) { seen.add(entry.id); merged.push(entry); }
  const cards = (flip ? merged.reverse() : merged).map(cardFromEntry);
  // The oldest saved book on the shelf (from the reading-life figures) is always the first pick for "Waiting longest".
  if (pill.oldest && oldest?.entry_id) {
    const first = { entry_id: oldest.entry_id, book_id: oldest.book_id ?? null, title: oldest.title, authors: [], cover_url: oldest.cover_url || null, owned: false, want: true, page_count: null, label: "Want to read" };
    const known = cards.find(card => card.entry_id === first.entry_id);
    return [known || first, ...cards.filter(card => card.entry_id !== first.entry_id)];
  }
  return cards;
}

export default function HelpMeChoose({ shelf, oldest, readOnly }) {
  const library = useUserBooks();
  // "Something new" is Next Read's engine (catalogue picks, filters, rotation); it lives in the same panel as the shelf pills.
  const pills = [...pillsFor(shelf), ...(library.nextRead ? [{ key: "next", text: "Something new", enabled: true, next: true }] : [])], usable = pills.filter(pill => pill.enabled);
  const go = useNavigate(), command = useReadingCommand("That book couldn’t be started. Please try again.");
  const [active, setActive] = useState(null), [results, setResults] = useState(null), [turn, setTurn] = useState(0), [failed, setFailed] = useState(false), [loading, setLoading] = useState(false);
  const request = useRef(0), [pending, setPending] = useState(null);
  const pill = pills.find(item => item.key === active);
  useEffect(() => {
    if (!pill || pill.next) return undefined;
    const token = ++request.current;
    fetchPicks(pill, oldest).then(cards => { if (token === request.current) { setResults(cards); setFailed(false); setLoading(false); } }, () => { if (token === request.current) { setResults([]); setFailed(true); setLoading(false); } });
    return () => { request.current += 1; };
  }, [pill, oldest]);
  if (!usable.length) return null;
  // The cards already on screen stay (dimmed) until the new ones arrive, so the page never collapses and grows back.
  const choose = key => { if (key === active) return; setActive(key); setLoading(true); setTurn(0); setFailed(false); };
  // Try again walks through the results three at a time and only repeats a book once they have all been shown.
  const pages = results?.length ? Math.ceil(results.length / PICKS_PER_TRY) : 0;
  const shown = results ? results.slice((turn % Math.max(pages, 1)) * PICKS_PER_TRY, (turn % Math.max(pages, 1)) * PICKS_PER_TRY + PICKS_PER_TRY) : [];
  const start = card => { setPending(card.entry_id); command.run(() => startReading(card.entry_id), () => go(`/my-books/${card.entry_id}`)); };
  return <section className="bv-choose" aria-labelledby="bv-choose-title">
    <div className="bv-choose-head"><h2 id="bv-choose-title">Can’t decide?</h2><p className="bv-muted">{pill?.next ? "Books you don’t have yet" : "Pick from your own shelf"}</p></div>
    <div className="bv-pills" role="group" aria-label="Help me choose">
      {usable.map(item => <button key={item.key} type="button" className="bv-pill" aria-pressed={active === item.key} onClick={() => choose(item.key)}>{item.text}</button>)}
    </div>
    {pill && <div className="bv-results" aria-busy={(!pill.next && loading) || undefined}>
    {pill.next && <NextReadSection panel />}
    {!pill.next && <div role="status" aria-live="polite">
      {results === null ? <p className="bv-muted">Looking through your shelf…</p> : failed ? <p className="bv-muted">We couldn’t look that up just now.</p> : !results.length ? <p className="bv-muted">Nothing on your shelf matches that.</p> : <>
        <div className={`bv-picks${loading ? " bv-picks--busy" : ""}`}>{shown.map(card => <PickCard key={card.entry_id} card={card} href={`/my-books/${card.entry_id}`} onStart={start} pending={pending === card.entry_id} disabled={readOnly || command.pending || loading} />)}</div>
        <div className="bv-choose-foot">{results.length > PICKS_PER_TRY && <Button variant="secondary" disabled={loading} onClick={() => setTurn(value => value + 1)}>Try again</Button>}
          {!loading && <p className="bv-help">{shown.length} {shown.length === 1 ? pill.about.replace(/\bbooks\b/, "book") : pill.about}</p>}</div>
      </>}
    </div>}
    </div>}
    {command.error && <p className="bv-field-error" role="alert">{command.error}</p>}
  </section>;
}
