import { useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { getBookById, getBooks } from "./api/books.js";
import Header from "./components/Header.jsx";
import Hero from "./components/Hero.jsx";
import Pagination from "./components/Pagination.jsx";
import ResultsList from "./components/ResultsList.jsx";
import SearchBar from "./components/SearchBar/SearchBar.jsx";
import "./App.css";

function App() {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <div className="app-shell">
      <Header />

      <button
        type="button"
        className="theme-toggle"
        onClick={() =>
          setTheme((current) => (current === "light" ? "dark" : "light"))
        }
        aria-label="Toggle warm dark mode"
      >
        {theme === "light" ? "Warm dark" : "Vintage light"}
      </button>

      <main className="page">
        <Routes>
          <Route path="/" element={<Navigate to="/browse" replace />} />
          <Route path="/browse" element={<HomePage />} />
          <Route path="/book/:bookId" element={<BookDetailPage />} />
        </Routes>
      </main>
    </div>
  );
}

function HomePage() {
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({ book: "", author: "", tags: [] });
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(true);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const paramTags = searchParams
      .getAll("tag")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const paramBook = searchParams.get("book")?.trim() ?? "";
    const paramAuthor = searchParams.get("author")?.trim() ?? "";

    if (paramBook || paramAuthor || paramTags.length > 0) {
      setFilters((current) => ({
        ...current,
        book: paramBook,
        author: paramAuthor,
        tags: paramTags,
      }));
      setPage(1);
      setHasSearched(true);
      return;
    }

    if (!searchParams.toString()) {
      setFilters({ book: "", author: "", tags: [] });
      setPage(1);
      setHasSearched(true);
    }
  }, [searchParams]);

  const runSearch = (nextFilters) => {
    const normalized = {
      book: nextFilters.book.trim(),
      author: nextFilters.author.trim(),
      tags: Array.from(
        new Set(
          (nextFilters.tags ?? [])
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ),
    };

    setFilters(normalized);
    setPage(1);
    setHasSearched(true);
  };

  useEffect(() => {
    let ignore = false;

    const loadBooks = async () => {
      setLoading(true);
      setError("");

      try {
        const payload = await getBooks({
          book: filters.book,
          author: filters.author,
          tags: filters.tags,
          page,
          size,
        });

        if (!ignore) {
          setBooks(Array.isArray(payload?.items) ? payload.items : []);
          setTotal(Number(payload?.total ?? 0));
          setSize(Number(payload?.size ?? size));
          setPage(Number(payload?.page ?? page));
        }
      } catch (loadError) {
        if (!ignore) {
          setBooks([]);
          setTotal(0);
          setError(loadError.message || "Unable to load books right now.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    if (hasSearched) {
      loadBooks();
    }

    return () => {
      ignore = true;
    };
  }, [filters, hasSearched, page, size]);

  const handlePageChange = (nextPage) => {
    if (nextPage < 1) return;
    setPage(nextPage);
    setHasSearched(true);
  };

  const totalPages = Math.max(1, Math.ceil(total / size || 1));

  const activeFilters = useMemo(
    () =>
      [
        filters.book && `Title: ${filters.book}`,
        filters.author && `Author: ${filters.author}`,
        ...filters.tags.map((tag) => `Tag: ${tag}`),
      ].filter(Boolean),
    [filters],
  );

  return (
    <>
      <Hero />
      <SearchBar onSearch={runSearch} activeFilters={{ total }} />

      <ResultsList
        books={books}
        loading={loading}
        error={error}
        query={filters.book}
        author={filters.author}
        tags={filters.tags}
      />

      <Pagination
        page={page}
        pages={totalPages}
        onPageChange={handlePageChange}
      />

      {activeFilters.length > 0 && (
        <div className="active-filter-summary" aria-live="polite">
          {activeFilters.map((filter) => (
            <span key={filter} className="filter-pill">
              {filter}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function BookDetailPage() {
  const { bookId } = useParams();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    const loadBook = async () => {
      setLoading(true);
      setError("");

      try {
        const nextBook = await getBookById(bookId);
        if (!ignore) {
          setBook(nextBook);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError.message || "Unable to load this book.");
          setBook(null);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    if (bookId) {
      loadBook();
    }

    return () => {
      ignore = true;
    };
  }, [bookId]);

  if (loading) {
    return <div className="loading-state">Loading book…</div>;
  }

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  if (!book) {
    return (
      <div className="empty-state">
        <p>This book could not be found.</p>
        <span>Try another title or head back to the full browse view.</span>
      </div>
    );
  }

  const coverText =
    (book.title || "Book")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "BK";

  return (
    <article className="book-detail">
      <Link to="/browse" className="back-link">
        ← Back to browse
      </Link>

      <div className="detail-layout">
        <div className="book-cover detail-cover" aria-label={book.title}>
          {book.cover_image_url ? (
            <img src={book.cover_image_url} alt={book.title} />
          ) : (
            <span>{coverText}</span>
          )}
        </div>

        <div className="detail-copy">
          <p className="eyebrow">Book details</p>
          <h2>{book.title}</h2>
          {book.subtitle ? (
            <p className="detail-subtitle">{book.subtitle}</p>
          ) : null}

          <div className="book-meta-row">
            <span>{book.published_year || "Year unknown"}</span>
            {book.page_count ? <span>{book.page_count} pages</span> : null}
          </div>

          <p className="author-line">
            {book.authors?.length
              ? book.authors.map((author) => author.name).join(", ")
              : "Unknown author"}
          </p>

          {book.tags?.length ? (
            <div className="tag-list">
              {book.tags.map((tag) => (
                <span key={`${book.id}-${tag.id}`} className="tag-chip">
                  {tag.name}
                  <small>{tag.type || "tag"}</small>
                </span>
              ))}
            </div>
          ) : null}

          {book.description ? (
            <section className="detail-section" aria-label="Description">
              <p className="detail-section-label">Description</p>
              <p className="description">{book.description}</p>
            </section>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default App;
