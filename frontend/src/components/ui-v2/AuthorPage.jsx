import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getAuthor, getAuthorBooks } from "../../api/books.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { BookCard, BookSkeletons, Button, EmptyState } from "./primitives.jsx";
import { errorText, useDocumentTitle, useRequest } from "./data.js";
import "../../styles/ui-v2/author-links.css";

// /author/:id: the author's name, how many books they have here, and those books in the Browse grid, 24 to a page.
// Signed in, each card carries the same shelf marks as Browse. Nothing else: no bio, no photo.
export default function AuthorPage({ notFound }) {
  const { id } = useParams();
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const valid = /^[1-9]\d{0,9}$/.test(id || "");
  const page = Math.max(1, Number.parseInt(params.get("page"), 10) || 1);
  const scope = `${auth.isAuthenticated ? "in" : "out"}:${auth.sessionGeneration}`;
  const author = useRequest(() => getAuthor(id), `author:${id}`, valid);
  const books = useRequest(() => getAuthorBooks(id, page), `author-books:${scope}:${id}:${page}`, valid && !auth.isLoading);
  const name = author.data?.name;
  useDocumentTitle(name);
  useEffect(() => { if (valid && !name) document.title = "Author · Bookvane"; }, [valid, name]);
  if (!valid || author.error?.status === 404) return notFound;
  const count = author.data?.book_count;
  const pages = books.data?.pages || 1, total = books.data?.total ?? count ?? 0, size = books.data?.size || 24, items = books.data?.items || [];
  function movePage(number) {
    if (number < 1 || number > pages) return;
    const next = new URLSearchParams(params); next.set("page", String(number)); setParams(next);
    window.scrollTo(0, 0);
    document.getElementById("bv-main-title")?.focus({ preventScroll: true });
  }
  return <section className="bv-container bv-author-page">
    <header className="bv-page-heading">
      {author.error ? <h1 id="bv-main-title" tabIndex={-1}>Author</h1> : name ? <h1 id="bv-main-title" tabIndex={-1}>{name}</h1> : <div className="bv-skeleton bv-skeleton--title bv-author-page-name" aria-hidden="true" />}
      {count === 0 ? <p className="bv-muted">No books by this author yet.</p> : typeof count === "number" ? <p className="bv-muted">{count === 1 ? "1 book" : `${count.toLocaleString()} books`}</p> : null}
    </header>
    {author.error ? <EmptyState title="This author couldn’t load." error action={<Button onClick={author.retry}>Try again</Button>}>{errorText(author.error, "Please try again.")}</EmptyState>
      : count === 0 ? null
      : books.loading ? <BookSkeletons count={10} />
      : books.error ? <EmptyState title="The books couldn’t load." error action={<Button onClick={books.retry}>Try again</Button>}>{errorText(books.error, "Please try again.")}</EmptyState>
      : items.length ? <>
        <div className="bv-book-grid">{items.map((book, index) => <BookCard key={book.id} book={book} priority={index < 5} />)}</div>
        <div className="bv-pagination"><span>Showing {((page - 1) * size + 1).toLocaleString()}–{Math.min(page * size, total).toLocaleString()} of {total.toLocaleString()}</span>
          {pages > 1 && <nav aria-label="Results pages"><Button variant="secondary" disabled={page <= 1} onClick={() => movePage(page - 1)}><ArrowLeft aria-hidden="true" /><span>Previous</span></Button><span aria-current="page">Page {page} of {pages.toLocaleString()}</span><Button variant="secondary" disabled={page >= pages} onClick={() => movePage(page + 1)}><span>Next</span><ArrowRight aria-hidden="true" /></Button></nav>}
        </div>
      </> : page > 1 ? <EmptyState title="You’ve reached the end of these results." action={<Button onClick={() => movePage(1)}>Back to the first page</Button>}>Start again at page one.</EmptyState> : null}
  </section>;
}
