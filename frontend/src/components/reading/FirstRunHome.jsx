import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Download, ScanBarcode, Search } from "lucide-react";
import { getBooks } from "../../api/books.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { catalogueResponse, firstImpressionOrder, useRequest } from "../ui-v2/data.js";
import { BookGrid, BookSkeletons, Button, EmptyState, PageHeading, TextLink, ActionLink } from "../ui-v2/primitives.jsx";
import { useNarrow } from "./home/homeLogic.js";
import { useScan } from "../ui-v2/scanKit.js";

const PICKS = 10, HIDDEN_KEY = "bv-start-hidden";
const readHidden = () => { try { return localStorage.getItem(HIDDEN_KEY) !== null; } catch { return false; } };

function Row({ icon: Icon, title, line, tile, ...props }) {
  const content = <>
    <span className={`bv-start-tile${tile ? " is-green" : ""}`} aria-hidden="true"><Icon /></span>
    <span className="bv-start-text"><strong>{title}</strong><small>{line}</small></span>
    <ChevronRight className="bv-start-go" aria-hidden="true" />
  </>;
  return props.to ? <Link className="bv-start-row" {...props}>{content}</Link> : <button type="button" className="bv-start-row" {...props}>{content}</button>;
}

// Start your shelf: the ways to fill a first shelf, as one card. Scan is for phones with a camera; Import shows only when import is on.
function StartShelf({ narrow }) {
  const library = useUserBooks(), navigate = useNavigate();
  const [hidden, setHidden] = useState(readHidden), { openScan } = useScan();
  const canScan = narrow && Boolean(navigator.mediaDevices?.getUserMedia);
  if (hidden) return null;
  const hide = () => { try { localStorage.setItem(HIDDEN_KEY, "1"); } catch { /* the choice just won't be kept */ } setHidden(true); };
  // The header search is on wider screens only; a phone opens Discover with its search field focused.
  const search = () => {
    const field = !narrow && document.querySelector(".bv-header-search input");
    if (field) field.focus(); else navigate("/browse", { state: { focusSearch: true } });
  };
  return <section className="bv-start-shelf" aria-labelledby="bv-start-shelf-title">
    <div className="bv-start-head"><h2 id="bv-start-shelf-title">Start your shelf</h2><button type="button" className="bv-start-hide" onClick={hide}>Hide</button></div>
    <div className="bv-start-rows">
      {canScan && <Row icon={ScanBarcode} tile title="Scan books" line="Point your camera at the barcodes" onClick={() => openScan()} />}
      {library.libraryImport && !library.readOnly && <Row icon={Download} title="Import from Goodreads or StoryGraph" line="Bring your shelves, reading dates and notes" to="/switch" />}
      <Row icon={Search} title="Search" line="Find a book by title or author" onClick={search} />
    </div>
  </section>;
}

// Home for an account with no books yet: ways to fill a first shelf. The card sits above the picks so it stays in view; the
// "shelf started" note sits right below the grid, where the third save happens.
export default function FirstRunHome() {
  const auth = useAuth(), library = useUserBooks(), narrow = useNarrow();
  const request = useRequest(async () => catalogueResponse(await getBooks({ size: 30, cacheScope: `session:${auth.sessionGeneration}` })), `first-run:${auth.sessionGeneration}`);
  const picks = firstImpressionOrder(request.data?.items || []).slice(0, PICKS);
  const saved = picks.filter(book => library.booksById[book.id]?.is_owned || library.booksById[book.id]?.is_wanted).length;
  return <section className="bv-container bv-reading-home bv-first-run">
    <div className="bv-home-heading"><PageHeading title="Welcome. Let’s fill your first shelf." /></div>
    <StartShelf narrow={narrow} />
    <p className="bv-first-run-prefs"><TextLink to="/preferences">Tell us what you like (optional)</TextLink></p>
    <section aria-labelledby="bv-first-run-pick"><h2 id="bv-first-run-pick">Pick a few books</h2>
      {request.loading ? <BookSkeletons count={5} /> : request.error ? <EmptyState error title="The books couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Your library is unchanged.</EmptyState> : <BookGrid books={picks} />}
    </section>
    {saved >= 3 && <p role="status" className="bv-first-run-done"><strong>Your shelf is started.</strong> <ActionLink to="/my-books">Open My Books</ActionLink></p>}
  </section>;
}
