import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getLibraryPage } from "../../../api/reading.js";
import { useReadingCommand } from "../../../hooks/useReadingCommand.js";
import { BookCover, Button } from "../../ui-v2/primitives.jsx";
import { PICKS_PER_TRY, cardFromEntry, coverBook, startable, startReading } from "./homeLogic.js";

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

async function fetchPicks(pill) {
  const lists = await Promise.all(pill.from.map(source => getLibraryPage({ facet: source === "want" ? "want" : "all", ...(source === "owned" ? { owned: "true" } : {}), sort: "added", limit: "100", ...pill.filters })));
  const seen = new Set(), merged = [];
  for (const entry of lists.flatMap(page => page.items)) if (!seen.has(entry.id) && startable(entry)) { seen.add(entry.id); merged.push(entry); }
  // Newest saved first from the server; "waiting longest" reads it from the other end.
  return (pill.oldest ? merged.reverse() : merged).map(cardFromEntry);
}

export default function HelpMeChoose({ shelf, readOnly }) {
  const pills = pillsFor(shelf), usable = pills.filter(pill => pill.enabled);
  const go = useNavigate(), command = useReadingCommand("That book couldn’t be started. Please try again.");
  const [active, setActive] = useState(null), [results, setResults] = useState(null), [turn, setTurn] = useState(0), [failed, setFailed] = useState(false);
  const request = useRef(0), [pending, setPending] = useState(null);
  const pill = pills.find(item => item.key === active);
  useEffect(() => {
    if (!pill) return undefined;
    const token = ++request.current;
    fetchPicks(pill).then(cards => { if (token === request.current) { setResults(cards); setFailed(false); } }, () => { if (token === request.current) { setResults([]); setFailed(true); } });
    return () => { request.current += 1; };
  }, [pill]);
  if (!usable.length) return null;
  const choose = key => { setActive(key); setResults(null); setTurn(0); setFailed(false); };
  // Try again walks through the results three at a time and only repeats a book once they have all been shown.
  const pages = results?.length ? Math.ceil(results.length / PICKS_PER_TRY) : 0;
  const shown = results ? results.slice((turn % Math.max(pages, 1)) * PICKS_PER_TRY, (turn % Math.max(pages, 1)) * PICKS_PER_TRY + PICKS_PER_TRY) : [];
  const start = card => { setPending(card.entry_id); command.run(() => startReading(card.entry_id), () => go(`/my-books/${card.entry_id}`)); };
  return <section className="bv-choose" aria-labelledby="bv-choose-title">
    <div className="bv-choose-head"><h2 id="bv-choose-title">Can’t decide?</h2><p className="bv-muted">Pick from your own shelf</p></div>
    <div className="bv-pills" role="group" aria-label="Help me choose">
      {pills.map(item => <button key={item.key} type="button" className="bv-pill" aria-pressed={active === item.key} disabled={!item.enabled} onClick={() => choose(item.key)}>{item.text}</button>)}
    </div>
    {pill && <div role="status" aria-live="polite">
      {results === null ? <p className="bv-muted">Looking through your shelf…</p> : failed ? <p className="bv-muted">We couldn’t look that up just now.</p> : !results.length ? <p className="bv-muted">Nothing on your shelf matches that.</p> : <>
        <div className="bv-picks">{shown.map(card => <article key={card.entry_id} className="bv-pick">
          <BookCover book={coverBook(card)} /><h3>{card.title}</h3><p className="bv-author">{card.authors.join(", ") || "Author not listed"}</p>
          <Button variant="secondary" disabled={readOnly || command.pending} aria-label={`Start reading ${card.title}`} onClick={() => start(card)}>{pending === card.entry_id ? "Opening…" : "Start"}</Button></article>)}</div>
        <div className="bv-choose-foot">{results.length > PICKS_PER_TRY && <Button variant="secondary" onClick={() => setTurn(value => value + 1)}>Try again</Button>}
          <p className="bv-help">{shown.length} {shown.length === 1 ? pill.about.replace(/books/, "book") : pill.about}</p></div>
      </>}
    </div>}
    {command.error && <p className="bv-field-error" role="alert">{command.error}</p>}
  </section>;
}
