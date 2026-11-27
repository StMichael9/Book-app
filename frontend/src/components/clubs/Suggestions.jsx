import { useState } from "react";
import { Plus } from "lucide-react";
import { closeVote, getSuggestions, removeSuggestion, setVote } from "../../api/clubs.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { BookCover } from "../ui-v2/primitives.jsx";
import { useRequest } from "../ui-v2/data.js";
import ClubMenu from "./ClubMenu.jsx";
import { AddBookSheet, ConfirmSheet } from "./ClubSheets.jsx";
import { CANCEL, CHOOSE_NEXT_BOOK, CLOSE_THE_VOTE, REMOVE, SUGGEST_A_BOOK, VOTE, VOTED, chosenLine, votesOf } from "./clubCopy.js";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";
const authorOf = book => { const first = book?.authors?.[0]; return typeof first === "string" ? first : first?.name || ""; };

// Choose the next book: members suggest books and vote (a toggle, as many as they like); owners and admins close the vote, and the top book becomes
// Up next. If the club can't be asked, the card simply isn't there.
export default function Suggestions({ clubId, mod, onChanged }) {
  const auth = useAuth();
  const [version, setVersion] = useState(0), [sheet, setSheet] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [chosen, setChosen] = useState(null), [local, setLocal] = useState({});
  const request = useRequest(() => getSuggestions(clubId), `club-suggestions:${clubId}:${auth.sessionGeneration}:${version}`);
  if (request.error || (!request.data && !chosen)) return null;
  const items = (request.data?.items || []).map(item => (local[item.id] ? { ...item, ...local[item.id] } : item));
  const reload = () => { setLocal({}); setVersion(value => value + 1); };
  async function vote(item) {
    const want = !item.my_vote;
    setError(""); setLocal(current => ({ ...current, [item.id]: { my_vote: want, votes: Math.max(0, item.votes + (want ? 1 : -1)) } }));
    try { const saved = await setVote(clubId, item.id, want); setLocal(current => ({ ...current, [item.id]: { my_vote: saved?.my_vote ?? want, votes: saved?.votes ?? item.votes + (want ? 1 : -1) } })); }
    catch { setLocal(current => { const rest = { ...current }; delete rest[item.id]; return rest; }); setError(SAVE_FAILED); }
  }
  async function remove(item) {
    setError("");
    try { await removeSuggestion(clubId, item.id); reload(); } catch { setError(SAVE_FAILED); }
  }
  async function close() {
    setBusy(true); setError("");
    try { const result = await closeVote(clubId); setChosen({ title: result.title, votes: result.votes }); setSheet(null); reload(); onChanged(); }
    catch { setError(SAVE_FAILED); }
    setBusy(false);
  }
  return <section className="bv-club-choose" aria-labelledby="bv-club-choose-h">
    <div className="bv-club-choose-head"><h2 id="bv-club-choose-h" className="bv-club-label">{CHOOSE_NEXT_BOOK}</h2>
      <button type="button" className="bv-club-pill" onClick={() => setSheet("suggest")}><Plus aria-hidden="true" />{SUGGEST_A_BOOK}</button></div>
    {chosen && <p className="bv-club-note" role="status">{chosenLine(chosen.title, chosen.votes)}</p>}
    {items.length > 0 && <ul className="bv-club-suggestions">{items.map(item => <li key={item.id} className="bv-club-suggestion">
      <span className="bv-club-sug-cover"><BookCover book={{ title: item.book.title, cover_image_url: item.book.cover_image_url, authors: [] }} size="small" decorative /></span>
      <span className="bv-club-sug-text"><strong>{item.book.title}</strong><small>{[authorOf(item.book), votesOf(item.votes)].filter(Boolean).join(" · ")}</small></span>
      <button type="button" className={`bv-club-vote${item.my_vote ? " is-on" : ""}`} aria-pressed={item.my_vote} aria-label={`${item.my_vote ? VOTED : VOTE}: ${item.book.title}`} onClick={() => vote(item)}>{item.my_vote ? VOTED : VOTE}</button>
      {(item.mine || mod) && <ClubMenu label={`More actions for ${item.book.title}`} items={[{ label: REMOVE, danger: true, onSelect: () => remove(item) }]} />}
    </li>)}</ul>}
    {error && <p className="bv-field-error" role="alert">{error}</p>}
    {mod && items.length > 0 && <button type="button" className="bv-club-link-button" onClick={() => setSheet("close")}>{CLOSE_THE_VOTE}</button>}
    {sheet === "suggest" && <AddBookSheet open suggest onClose={() => setSheet(null)} clubId={clubId} onAdded={() => { setSheet(null); setChosen(null); reload(); }} />}
    {sheet === "close" && <ConfirmSheet title={CLOSE_THE_VOTE} confirmLabel={CLOSE_THE_VOTE} cancelLabel={CANCEL} pending={busy} error={error} onClose={() => { setSheet(null); setError(""); }} onConfirm={close} />}
  </section>;
}
