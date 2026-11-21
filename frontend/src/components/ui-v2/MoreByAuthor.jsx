import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { getAuthorBooks } from "../../api/books.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { BookCover } from "./primitives.jsx";
import { bookSummary, useRequest } from "./data.js";
import "../../styles/ui-v2/book-page.css";

// "More by {author}" under a book: the first author that has an id, up to five of their other books (four on a phone, by CSS), each a
// cover and a title linking to its page. "See all" opens the author page. Hidden when there is no author id, when fewer than two other
// books are left, or if the books can't be had.
const SHOWN = 5;

export default function MoreByAuthor({ book }) {
  const auth = useAuth(), location = useLocation();
  const author = (book?.authors || []).find(item => Number.isSafeInteger(item?.id) && item.id > 0 && item.name);
  const scope = auth.isAuthenticated ? "in" : "out";
  const request = useRequest(() => getAuthorBooks(author.id, 1), `more-by:${scope}:${auth.sessionGeneration}:${author?.id}`, Boolean(author) && !auth.isLoading);
  if (!author || request.error) return null;
  const others = (request.data?.items || []).filter(item => item.id !== book.id).slice(0, SHOWN);
  if (!request.loading && others.length < 2) return null;
  const from = location.pathname + location.search;
  return <section className="bv-more-by" aria-labelledby="bv-more-by-title">
    <div className="bv-more-by-head">
      <h2 id="bv-more-by-title">More by {author.name}</h2>
      <Link className="bv-more-by-all" to={`/author/${author.id}`}><span>See all</span><ChevronRight aria-hidden="true" /></Link>
    </div>
    {request.loading
      ? <div className="bv-more-by-grid" role="status" aria-label="Loading books" aria-busy="true">{Array.from({ length: SHOWN }, (_, index) => <div key={index} aria-hidden="true"><div className="bv-skeleton bv-skeleton--cover" /><div className="bv-skeleton bv-skeleton--title" /></div>)}</div>
      : <ul className="bv-more-by-grid">{others.map(item => <li key={item.id}>
        <Link className="bv-book-link" to={`/book/${item.id}`} state={{ browseFrom: from, book: bookSummary(item) }} tabIndex={-1} aria-label={`View ${item.title}`}><BookCover book={item} /></Link>
        <h3><Link to={`/book/${item.id}`} state={{ browseFrom: from, book: bookSummary(item) }}>{item.title || "Untitled book"}</Link></h3>
      </li>)}</ul>}
  </section>;
}
