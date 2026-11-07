import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getStats } from "../../../api/profile.js";
import { useAuth } from "../../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../../hooks/useReadingCommand.js";
import { useRequest } from "../../ui-v2/data.js";
import { YearInBooks } from "../../profile/YearShelf.jsx";
import { BookCover, Button, EmptyState, TextLink } from "../../ui-v2/primitives.jsx";
import { startReading } from "../home/homeLogic.js";
import { comparison, importNote, num, savedOn, yearsOf } from "./lifeLogic.js";
import "../../../styles/ui-v2/home.css";
import "../../../styles/ui-v2/reading-life.css";

const LENGTHS = [["short", "Short", "var(--bv-soft-green)"], ["medium", "Medium", "var(--bv-sage, #5f7d66)"], ["long", "Long", "var(--bv-green)"]];

function Figure({ value, label }) {
  return <div className="bv-life-fig"><dd>{value}</dd><dt>{label}</dt></div>;
}

function Figures({ stats }) {
  const books = stats.books_finished ?? stats.books ?? 0, pages = stats.pages ?? stats.pages_read ?? 0;
  return <dl className="bv-life-figures">
    <Figure value={num(books)} label={books === 1 ? "book finished" : "books finished"} />
    {stats.rereads > 0 && <Figure value={num(stats.rereads)} label={stats.rereads === 1 ? "reread, counted every time" : "rereads, counted every time"} />}
    <Figure value={num(pages)} label={`${pages === 1 ? "page" : "pages"}${stats.pages_unknown > 0 ? ` · ${num(stats.pages_unknown)} without page counts` : ""}`} />
    {stats.avg_length != null && <Figure value={num(Math.round(stats.avg_length))} label="pages, average length" />}
    {stats.median_days != null && <Figure value={`${stats.median_days} ${stats.median_days === 1 ? "day" : "days"}`} label="typical start to finish" />}
    {stats.stopped > 0 && <Figure value={num(stats.stopped)} label="stopped, and that’s fine" />}
  </dl>;
}

function Subjects({ items }) {
  const top = (items || []).slice(0, 5), max = Math.max(1, ...top.map(item => item.count));
  if (!top.length) return null;
  return <section className="bv-life-card" aria-labelledby="bv-life-subjects"><h3 id="bv-life-subjects">What you read</h3>
    <ul className="bv-life-bars">{top.map(item => <li key={item.name}><span>{item.name}</span><span className="bv-life-track" aria-hidden="true"><i style={{ width: `${Math.max(6, Math.round(100 * item.count / max))}%` }} /></span><b>{item.count}</b></li>)}</ul></section>;
}

function LengthAndAuthors({ stats }) {
  const mix = stats.length_mix || {}, total = LENGTHS.reduce((sum, [key]) => sum + (mix[key] || 0), 0);
  const known = stats.authors_new != null || stats.authors_returning != null;
  if (!total && !known) return null;
  return <section className="bv-life-card" aria-labelledby="bv-life-length"><h3 id="bv-life-length">Length and authors</h3>
    {total > 0 && <><div className="bv-life-stack" aria-hidden="true">{LENGTHS.filter(([key]) => mix[key] > 0).map(([key, , colour]) => <i key={key} style={{ width: `${100 * mix[key] / total}%`, background: colour }} />)}</div>
      <ul className="bv-life-legend">{LENGTHS.map(([key, text, colour]) => <li key={key}><i aria-hidden="true" style={{ background: colour }} />{text} {mix[key] || 0}</li>)}</ul>
      {mix.unknown > 0 && <p className="bv-help">{mix.unknown} without page counts aren’t included.</p>}</>}
    {known && <p className="bv-life-authors"><b>{num(stats.authors_new || 0)}</b> new {stats.authors_new === 1 ? "author" : "authors"}<br /><b>{num(stats.authors_returning || 0)}</b> you came back to</p>}</section>;
}

function Compared({ stats }) {
  const lines = comparison(stats);
  if (!lines.length) return null;
  return <section className="bv-life-card" aria-labelledby="bv-life-compare"><h3 id="bv-life-compare">Compared with {stats.year - 1}</h3><ul className="bv-life-compare">{lines.map(line => <li key={line}>{line}</li>)}</ul></section>;
}

function ShelfCard({ shelf, readOnly }) {
  const go = useNavigate(), command = useReadingCommand("That book couldn’t be started. Please try again.");
  const [pending, setPending] = useState(false);
  if (!shelf) return null;
  const waiting = shelf.oldest_waiting, saved = savedOn(waiting?.saved_at);
  const start = () => { setPending(true); command.run(() => startReading(waiting.entry_id), () => go(`/my-books/${waiting.entry_id}`)); };
  return <section className="bv-life-card" aria-labelledby="bv-life-shelf"><h3 id="bv-life-shelf">Your shelf</h3>
    <p className="bv-life-line"><b>{num(shelf.owned_unfinished || 0)}</b> {shelf.owned_unfinished === 1 ? "book you own and haven’t read" : "books you own and haven’t read"} · <b>{num(shelf.want || 0)}</b> on Want to read</p>
    {waiting && <div className="bv-life-wait"><div className="bv-life-wait-cover"><BookCover book={{ title: waiting.title, cover_image_url: waiting.cover_url, authors: [] }} /></div>
      <div><p className="bv-help">Waiting longest{saved ? ` · saved ${saved}` : ""}</p><p className="bv-life-wait-title">{waiting.title}</p>
        <Button variant="secondary" disabled={readOnly || command.pending} aria-label={`Start reading ${waiting.title}`} onClick={start}>{pending && command.pending ? "Opening…" : "Start reading"}</Button></div></div>}
    {command.error && <p className="bv-field-error" role="alert">{command.error}</p>}</section>;
}

function AllTime({ totals }) {
  if (!totals) return null;
  return <section className="bv-life-card" aria-labelledby="bv-life-all"><h3 id="bv-life-all">All time</h3>
    <p className="bv-life-big"><b>{num(totals.books)}</b> {totals.books === 1 ? "book" : "books"}<br /><b>{num(totals.pages)}</b> {totals.pages === 1 ? "page" : "pages"}</p>
    <p className="bv-help">Includes your imported history.</p></section>;
}

export default function ReadingLifePage() {
  const auth = useAuth(), { readOnly } = useUserBooks(), [params, setParams] = useSearchParams();
  // The page opens on the current year; that first answer also says which years there are to switch between.
  const base = useRequest(() => getStats(), `life:${auth.sessionGeneration}:base`);
  const years = yearsOf(base.data), asked = params.get("year");
  const allTime = asked === "all", chosen = Number(asked);
  const year = !allTime && years.includes(chosen) ? chosen : base.data?.year;
  const other = Boolean(base.data) && !allTime && year !== base.data.year;
  const picked = useRequest(() => getStats(year), `life:${auth.sessionGeneration}:${year}`, other);
  const select = value => setParams(value === base.data.year ? {} : { year: String(value) }, { replace: true });

  if (base.loading) return <section className="bv-container bv-life" aria-busy="true"><p role="status" className="bv-muted">Opening your reading life…</p></section>;
  if (base.error || !base.data) return <section className="bv-container bv-life"><EmptyState error title="Your reading life couldn’t load." action={<Button onClick={base.retry}>Try again</Button>}>Your books haven’t changed.</EmptyState></section>;

  const stats = allTime ? base.data : other ? picked.data : base.data;
  const note = importNote(base.data, years);
  const totals = base.data.all_time, subjects = totals?.top_subjects;
  const empty = stats && !allTime && !(stats.books_finished ?? stats.books);
  return <section className="bv-container bv-life">
    <div className="bv-life-head">
      <div><h1>Your reading life</h1><p className="bv-muted">Private to you</p></div>
      <div className="bv-life-switch">
        <div className="bv-pills" role="group" aria-label="Year">
          {years.map(item => <button key={item} type="button" className="bv-pill" aria-pressed={!allTime && year === item} onClick={() => select(item)}>{item}</button>)}
          <button type="button" className="bv-pill" aria-pressed={allTime} onClick={() => setParams({ year: "all" }, { replace: true })}>All time</button>
        </div>
        {note && <p className="bv-help">{note}</p>}
      </div>
    </div>
    {allTime ? <div className="bv-life-cols bv-life-cols--all"><AllTime totals={totals} /><Subjects items={subjects} /></div>
      : !stats ? (picked.error ? <EmptyState error title="That year couldn’t load." action={<Button onClick={picked.retry}>Try again</Button>}>Your books haven’t changed.</EmptyState> : <p role="status" className="bv-muted">Opening {year}…</p>)
      : <>
        {empty ? <p className="bv-life-empty">Nothing finished in {stats.year} yet. <TextLink to="/my-books">Open My Books</TextLink> to pick something to read.</p> : <Figures stats={stats} />}
        <div className="bv-life-card bv-life-year"><h3>Your {stats.year} on the shelf</h3>
          <YearInBooks stats={{ ...stats, pages_read: stats.pages_read ?? stats.pages }} chips={false} bare /></div>
        {!empty && <div className="bv-life-cols"><Subjects items={stats.top_subjects} /><LengthAndAuthors stats={stats} /><Compared stats={stats} /></div>}
        {empty && <div className="bv-life-cols"><Compared stats={stats} /></div>}
        <div className="bv-life-cols bv-life-cols--shelf"><ShelfCard shelf={base.data.shelf} readOnly={readOnly} /><AllTime totals={totals} /></div>
      </>}
  </section>;
}
