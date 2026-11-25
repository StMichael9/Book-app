import { useState } from "react";
import { Link } from "react-router-dom";
import { deleteClubBook, updateClubBook } from "../../api/clubs.js";
import { BookCover, Button, GetACopy } from "../ui-v2/primitives.jsx";
import { authorLabel } from "../ui-v2/data.js";
import ClubMenu from "./ClubMenu.jsx";
import { ConfirmSheet } from "./ClubSheets.jsx";
import { monthShort, named, positionLabel, shortDate } from "./clubFormat.js";
import { ADD_A_BOOK, CANCEL, EDIT_READING_PLAN, FINISH_AND_START, FINISH_CONFIRM, FINISH_THIS_BOOK, NOW_READING, NO_DATE_YET, READ_TOGETHER, REMOVE_BOOK, REMOVE_BOOK_TEXT, REMOVE_FROM_HISTORY, START_READING_NOW, UP_NEXT, byDate, endDate, finishFirstText, finishFirstTitle, finishText, finishTitle, fromDate, removeBookTitle } from "./clubCopy.js";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";

// The reading plan as one line: each part's checkpoint with its date, the next one in bold, then the end.
function PlanLine({ book, next }) {
  const items = [...(book.checkpoints || []).map(point => ({ key: `c${point.id}`, text: byDate(positionLabel(point.unit, point.value), point.due_on ? shortDate(point.due_on) : ""), next: next?.id === point.id })),
    ...(book.ends_on ? [{ key: "end", text: endDate(shortDate(book.ends_on)) }] : [])];
  if (!items.length) return null;
  return <p className="bv-club-plan">{items.map((item, index) => <span key={item.key}>{index > 0 && " · "}{item.next ? <b>{item.text}</b> : item.text}</span>)}</p>;
}

// One book: its cover on the page, the title (a link to the book's page, for everyone), the author, the line that goes with it, and, for owners and
// admins, one "…" holding what they can do with it.
function BookRow({ book, large = false, menu, children }) {
  const authors = named(book.authors);
  return <li className={`bv-club-book${large ? " is-large" : ""}`}>
    <div className={`bv-club-cover${large ? "" : " is-small"}`}><BookCover book={{ title: book.title, cover_image_url: book.cover_image_url, authors }} size="small" decorative /></div>
    <div className="bv-club-book-text"><p className="bv-club-title"><Link to={`/book/${book.book_id}`}>{book.title}</Link></p>{large && authors.length > 0 && <p className="bv-club-author">{authorLabel({ authors })}</p>}{children}</div>
    {menu && <ClubMenu label={`More actions for ${book.title}`} items={menu} />}
  </li>;
}

const newestFirst = (a, b) => (b.ends_on || b.starts_on || "").localeCompare(a.ends_on || a.starts_on || "") || b.id - a.id;

// The Books tab: Add a book (owners and admins), Now reading with its plan, Up next, and Read together (the club's history, newest first).
export default function BooksTab({ clubId, books, current, next, mod, onAddBook, onEditPlan, onChanged }) {
  const upcoming = books.filter(book => book.status === "upcoming"), past = books.filter(book => book.status === "past").sort(newestFirst);
  const [ask, setAsk] = useState(null), [pending, setPending] = useState(false), [error, setError] = useState("");
  const close = () => { setAsk(null); setError(""); };
  const patch = (book, changes) => updateClubBook(clubId, book.id, changes);
  // Two calls, and on any failure the error shows and the club is fetched again, so the page shows what really happened.
  async function run(work) {
    setPending(true); setError("");
    try { await work(); setPending(false); close(); onChanged(); } catch { setError(SAVE_FAILED); setPending(false); onChanged(); }
  }
  const finish = () => run(async () => { await patch(current, { status: "past" }); if (upcoming[0]) await patch(upcoming[0], { status: "current" }); });
  const startNow = book => run(async () => { if (current) await patch(current, { status: "past" }); await patch(book, { status: "current" }); });
  const remove = () => run(() => deleteClubBook(clubId, ask.book.id));
  const startMenu = book => (current ? { label: START_READING_NOW, onSelect: () => setAsk({ kind: "start", book }) } : { label: START_READING_NOW, onSelect: () => startNow(book) });
  return <section className="bv-club-books-tab" aria-label="Books">
    {mod && <Button className="bv-club-primary" onClick={onAddBook}>{ADD_A_BOOK}</Button>}
    {!ask && error && <p className="bv-field-error" role="alert">{error}</p>}
    {current && <section aria-labelledby="bv-club-now-h"><h2 id="bv-club-now-h" className="bv-club-label">{NOW_READING}</h2>
      <ul className="bv-club-booklist"><BookRow book={current} large menu={mod ? [{ label: EDIT_READING_PLAN, onSelect: onEditPlan }, { label: FINISH_THIS_BOOK, onSelect: () => setAsk({ kind: "finish", book: current }) }, { label: REMOVE_BOOK, danger: true, onSelect: () => setAsk({ kind: "remove", book: current, label: REMOVE_BOOK }) }] : undefined}>
        <PlanLine book={current} next={next} /></BookRow></ul></section>}
    {upcoming.length > 0 && <section aria-labelledby="bv-club-up-h"><h2 id="bv-club-up-h" className="bv-club-label">{UP_NEXT}</h2>
      <ul className="bv-club-booklist">{upcoming.map(book => <BookRow key={book.id} book={book} menu={mod ? [startMenu(book), { label: REMOVE_BOOK, danger: true, onSelect: () => setAsk({ kind: "remove", book, label: REMOVE_BOOK }) }] : undefined}>
        <p className="bv-club-author">{book.starts_on ? fromDate(shortDate(book.starts_on)) : NO_DATE_YET}</p>{!mod && <GetACopy book={{ title: book.title, authors: named(book.authors) }} disclosure={false} />}</BookRow>)}</ul></section>}
    {past.length > 0 && <section aria-labelledby="bv-club-past-h"><h2 id="bv-club-past-h" className="bv-club-label">{READ_TOGETHER}</h2>
      <ul className="bv-club-booklist">{past.map(book => <BookRow key={book.id} book={book} menu={mod ? [{ label: REMOVE_FROM_HISTORY, danger: true, onSelect: () => setAsk({ kind: "remove", book, label: REMOVE_FROM_HISTORY }) }] : undefined}>
        <p className="bv-club-author">{monthShort(book.ends_on || book.starts_on)}</p></BookRow>)}</ul></section>}
    {ask?.kind === "finish" && <ConfirmSheet title={finishTitle(ask.book.title)} text={finishText(upcoming[0]?.title)} confirmLabel={FINISH_CONFIRM} cancelLabel={CANCEL} pending={pending} error={error} onClose={close} onConfirm={finish} />}
    {ask?.kind === "start" && <ConfirmSheet title={finishFirstTitle(current.title)} text={finishFirstText(current.title, ask.book.title)} confirmLabel={FINISH_AND_START} cancelLabel={CANCEL} pending={pending} error={error} onClose={close} onConfirm={() => startNow(ask.book)} />}
    {ask?.kind === "remove" && <ConfirmSheet title={removeBookTitle(ask.book.title)} text={REMOVE_BOOK_TEXT} confirmLabel={ask.label} cancelLabel={CANCEL} danger pending={pending} error={error} onClose={close} onConfirm={remove} />}
  </section>;
}
