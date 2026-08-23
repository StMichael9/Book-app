import { useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useParams,
} from "react-router-dom";

import { getBookById, getBooks } from "./api/books.js";
import Header from "./components/Header.jsx";
import Hero from "./components/Hero.jsx";
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
  const [filters, setFilters] = useState({ book: "", author: "", tag: "" });
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(true);

  const runSearch = (nextFilters) => {
    const normalized = {
      book: nextFilters.book.trim(),
      author: nextFilters.author.trim(),
      tag: nextFilters.tag.trim(),
    };

    setFilters(normalized);
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
          tag: filters.tag,
          page: 1,
          size: 20,
        });

        if (!ignore) {
          setBooks(Array.isArray(payload?.items) ? payload.items : []);
        }
      } catch (loadError) {
        if (!ignore) {
          setBooks([]);
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
  }, [filters, hasSearched]);

  const activeFilters = useMemo(
    () =>
      [
        filters.book && `Title: ${filters.book}`,
        filters.author && `Author: ${filters.author}`,
        filters.tag && `Tag: ${filters.tag}`,
      ].filter(Boolean),
    [filters],
  );

  return (
    <>
      <Hero />
      <SearchBar onSearch={runSearch} activeFilters={{ total: books.length }} />

      <ResultsList
        books={books}
        loading={loading}
        error={error}
        query={filters.book}
        author={filters.author}
        tag={filters.tag}
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
            <p className="description">{book.description}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default App;
