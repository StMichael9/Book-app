import { useState } from "react";
import { ensureLibraryBook } from "../../api/reading.js";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { BookCover, Button } from "../ui-v2/primitives.jsx";
import { authorLabel } from "../ui-v2/data.js";
import { checkpointPage, dayDate, pageOf, positionLabel, shareOf } from "./clubFormat.js";
import { ADD_TO_MY_SHELF, ADD_TO_MY_SHELF_HELP, MAKE_A_READING_PLAN, NOW_READING, NO_BOOK_CHOSEN, THIS_WEEK, UPDATE_MY_PAGE, UP_TO_DATE, nextPart, pastPage, readTo, youreOn } from "./clubCopy.js";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";

// This week: the book, where the club should be, where you are, and the one primary action. It changes with the situation:
// behind the part that's due, caught up, no reading plan yet, the book not on your shelf yet, and nothing being read.
export default function ThisWeek({ book, people, next, myPage, mine, onShelf, mod, update, onMakePlan, onShelfChanged }) {
  const library = useUserBooks();
  const [adding, setAdding] = useState(false), [error, setError] = useState("");
  if (!book) return <section className="bv-club-week" aria-labelledby="bv-club-week-h"><h2 id="bv-club-week-h" className="bv-club-label">{THIS_WEEK}</h2><p className="bv-club-week-none">{NO_BOOK_CHOSEN}</p></section>;
  const points = book.checkpoints || [], hasPlan = points.length > 0 || Boolean(book.ends_on);
  const target = checkpointPage(next, book.page_count);
  const caughtUp = Boolean(hasPlan && next && myPage != null && target != null && myPage >= target);
  const following = caughtUp ? points[points.findIndex(point => point.id === next.id) + 1] : null;
  const share = shareOf(mine, book.page_count);
  const past = target == null ? 0 : people.filter(member => member.shares_progress).filter(member => { const page = pageOf(member.progress, book.page_count); return page != null && page >= target; }).length;
  async function addToShelf() {
    if (adding) return;
    setAdding(true); setError("");
    try { const entry = await ensureLibraryBook(book.book_id, { is_wanted: true }); library.readingChanged(entry); onShelfChanged(); } catch { setError(SAVE_FAILED); }
    setAdding(false);
  }
  const shelved = onShelf !== false;
  return <section className="bv-club-week" aria-labelledby="bv-club-week-h">
    <h2 id="bv-club-week-h" className="bv-club-label">{hasPlan ? THIS_WEEK : NOW_READING}</h2>
    <div className="bv-club-week-body">
      <div className="bv-club-cover"><BookCover book={{ title: book.title, cover_image_url: book.cover_image_url, authors: book.authors }} size="small" /></div>
      <div className="bv-club-week-text">
        <p className="bv-club-title">{book.title}</p>
        {book.authors.length > 0 && <p className="bv-club-author">{authorLabel(book)}</p>}
        {hasPlan && next && <p className="bv-club-target">{caughtUp ? UP_TO_DATE : readTo(positionLabel(next.unit, next.value), dayDate(next.due_on))}</p>}
        {shelved && share != null && <progress className="bv-club-meter" value={Math.round(share * 100)} max="100" aria-label={`Reading progress for ${book.title}`} />}
        {shelved && myPage != null && <p className="bv-club-place">{youreOn(myPage)}{caughtUp && following && ` ${nextPart(positionLabel(following.unit, following.value), dayDate(following.due_on))}`}</p>}
        {shelved && !caughtUp && past > 0 && <p className="bv-club-group">{pastPage(past, target)}</p>}
        {shelved
          ? <Button variant={caughtUp ? "secondary" : "primary"} className="bv-club-primary" disabled={update.opening} onClick={update.open}>{UPDATE_MY_PAGE}</Button>
          : <><p className="bv-club-group">{ADD_TO_MY_SHELF_HELP}</p><Button className="bv-club-primary" disabled={adding} onClick={addToShelf}>{ADD_TO_MY_SHELF}</Button></>}
        {mod && !hasPlan && <button type="button" className="bv-club-link-button" onClick={onMakePlan}>{MAKE_A_READING_PLAN}</button>}
        {(error || update.error) && <p className="bv-field-error" role="alert">{error || update.error}</p>}
      </div>
    </div>
    {update.dialog}
  </section>;
}
