import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getLibraryPage } from "../../../api/reading.js";
import { useReadingCommand } from "../../../hooks/useReadingCommand.js";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { useGenres } from "../../ui-v2/useGenres.js";
import { Button } from "../../ui-v2/primitives.jsx";
import PickCard from "./PickCard.jsx";
import NextReadSection from "../NextReadSection.jsx";
import { PICKS_PER_TRY, PICKS_PER_TRY_PHONE, cardFromEntry, startable, startReading, useCompact } from "./homeLogic.js";

// On a shelf this small the whole shelf is already in hand, so a pill whose books are the same as an earlier pill's is dropped.
// The books for each pill are worked out from that one library response (no extra requests). "More <subject>" can't be told
// from the shelf alone, so it is always kept.
const SMALL_SHELF = 30;
const SHORT_PAGES = 250;
function foldSameBooks(pills, shelf, excluded) {
  const items = shelf?.items, all = shelf?.counts?.all;
  if (!Array.isArray(items) || !Number.isFinite(all) || all > SMALL_SHELF || items.length < all) return pills;
  const open = items.filter(entry => startable(entry) && (entry.is_owned || entry.is_wanted));
  // Books already shown in Up next are not offered again, so a pill left with nothing is dropped.
  const left = open.filter(entry => !excluded.has(entry.id));
  const idsFor = {
    short: left.filter(entry => entry.book?.page_count > 0 && entry.book.page_count < SHORT_PAGES),
    owned: left.filter(entry => entry.is_owned),
    waiting: left,
  };
  const seen = new Set();
  return pills.filter(pill => {
    const books = idsFor[pill.key];
    if (!books) return true;
    if (!books.length) return false;
    const key = books.map(entry => entry.id).sort((x, y) => x - y).join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// What each pill asks of /me/library. Books come from Want to read and from what you own, so most pills ask twice and merge.
function pillsFor(shelf, genreLabel) {
  const counts = shelf?.counts || {}, facets = shelf?.facets || {};
  const shortCount = (facets.length || []).find(item => item.value === "short")?.count || 0;
  const topFacet = (facets.subject || [])[0], topLabel = topFacet ? genreLabel(topFacet.label) : null, top = topLabel ? { ...topFacet, label: topLabel } : null;
  return [
    { key: "short", text: "Something short", enabled: shortCount > 0, filters: { length: "short" }, from: ["want", "owned"], about: "short books you own or want · under 250 pages" },
    { key: "owned", text: "Something I own", enabled: (counts.owned || 0) > 0, filters: {}, from: ["owned"], about: "books you own and haven’t started" },
    ...(top ? [{ key: "subject", text: `More ${top.label}`, enabled: top.count > 0, filters: { subject: String(top.value) }, from: ["want", "owned"], about: `${top.label} you own or want` }] : []),
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

// `exclude` is the entry ids Up next is showing. Pass a memoised array: a list rebuilt on every render would make this redo its work each time.
const NONE = [];
export default function HelpMeChoose({ shelf, oldest, readOnly, exclude = NONE }) {
  const library = useUserBooks();
  // A facet names its subject; it is shown only if that subject is one of the genres, under the genre's own label.
  const { labelOf: genreLabel } = useGenres();
  // "Something new" is Next Read's engine (catalogue picks, filters, rotation); it lives in the same panel as the shelf pills.
  // Memoised so the active pill keeps its identity between renders: the fetch effect depends on it, and a fresh object
  // every render would refetch (and discard) after each result, looping on /me/library.
  const hasNext = Boolean(library.nextRead);
  const pills = useMemo(() => [...pillsFor(shelf, genreLabel), ...(hasNext ? [{ key: "next", text: "Something new", enabled: true, next: true }] : [])], [shelf, hasNext, genreLabel]), enabled = pills.filter(pill => pill.enabled);
  const go = useNavigate(), command = useReadingCommand("That book couldn’t be started. Please try again.");
  const [active, setActive] = useState(null), [results, setResults] = useState(null), [turn, setTurn] = useState(0), [failed, setFailed] = useState(false), [loading, setLoading] = useState(false);
  const request = useRef(0), [pending, setPending] = useState(null);
  const compact = useCompact();
  const excluded = useMemo(() => new Set(exclude), [exclude]);
  const usable = foldSameBooks(enabled, shelf, excluded);
  // The first available filter is already chosen on load, so the box opens with books and never a bare row of buttons.
  const activeKey = active ?? usable[0]?.key ?? null;
  const pill = pills.find(item => item.key === activeKey);
  // Only "Waiting longest" uses the oldest-waiting figure, so a late stats answer must not refetch the other pills.
  const oldestUsed = pill?.oldest ? oldest : null;
  // The pill object is rebuilt when the genre names arrive; only what it asks for decides whether to fetch again.
  const ask = pill && !pill.next ? JSON.stringify({ filters: pill.filters, from: pill.from, oldest: Boolean(pill.oldest) }) : null;
  useEffect(() => {
    if (!ask) return undefined;
    const token = ++request.current;
    fetchPicks(JSON.parse(ask), oldestUsed).then(cards => { if (token === request.current) { setResults(cards); setFailed(false); setLoading(false); } }, () => { if (token === request.current) { setResults([]); setFailed(true); setLoading(false); } });
    return () => { request.current += 1; };
  }, [ask, oldestUsed]);
  if (!usable.length) return null;
  // Taken out of the fetched picks here, not in the request, so Up next's books never cost another /me/library call.
  const picks = results && excluded.size ? results.filter(card => !excluded.has(card.entry_id)) : results;
  const perTry = compact ? PICKS_PER_TRY_PHONE : PICKS_PER_TRY;
  // The cards already on screen stay (dimmed) until the new ones arrive, so the page never collapses and grows back.
  const choose = key => { if (key === activeKey) return; setActive(key); setLoading(true); setTurn(0); setFailed(false); };
  // Try again walks through the results five at a time (four on a phone or tablet) and only repeats a book once they have all been shown.
  const pages = picks?.length ? Math.ceil(picks.length / perTry) : 0;
  const shown = picks ? picks.slice((turn % Math.max(pages, 1)) * perTry, (turn % Math.max(pages, 1)) * perTry + perTry) : [];
  const start = card => { setPending(card.entry_id); command.run(() => startReading(card.entry_id), () => go(`/my-books/${card.entry_id}`)); };
  return <section className="bv-choose" aria-labelledby="bv-choose-title">
    <div className="bv-choose-head"><h2 id="bv-choose-title">Can’t decide?</h2><p className="bv-muted">{pill?.next ? "Books you don’t have yet" : "Pick from your own shelf"}</p></div>
    <div className="bv-pills" role="group" aria-label="Help me choose">
      {usable.map(item => <button key={item.key} type="button" className="bv-pill" aria-pressed={activeKey === item.key} onClick={() => choose(item.key)}>{item.text}</button>)}
    </div>
    {pill && <div className={`bv-results${!pill.next && !loading && picks !== null && (failed || !picks.length) ? " bv-results--quiet" : ""}`} aria-busy={(!pill.next && loading) || undefined}>
    {pill.next && <NextReadSection panel />}
    {!pill.next && <div role="status" aria-live="polite">
      {picks === null ? <p className="bv-muted">Looking through your shelf…</p> : failed ? <p className="bv-muted">We couldn’t look that up just now.</p> : !picks.length ? <p className="bv-muted">Nothing on your shelf matches that.</p> : <>
        <div className={`bv-picks${loading ? " bv-picks--busy" : ""}`}>{shown.map(card => <PickCard key={card.entry_id} card={card} href={`/my-books/${card.entry_id}`} onStart={start} pending={pending === card.entry_id} disabled={readOnly || command.pending || loading} />)}</div>
        <div className="bv-choose-foot">{picks.length > perTry && <Button variant="secondary" disabled={loading} onClick={() => setTurn(value => value + 1)}>Try again</Button>}
          {!loading && <p className="bv-help">{shown.length} {shown.length === 1 ? pill.about.replace(/\bbooks\b/, "book") : pill.about}</p>}</div>
      </>}
    </div>}
    </div>}
    {command.error && <p className="bv-field-error" role="alert">{command.error}</p>}
  </section>;
}
