import { useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { getBookById, getBooks } from "./api/books.js";
import Header from "./components/Header.jsx";
import Hero from "./components/Hero.jsx";
import Pagination from "./components/Pagination.jsx";
import ResultsList from "./components/ResultsList.jsx";
import SearchBar from "./components/SearchBar/SearchBar.jsx";
import BookDetailPage from "./components/BookDetailPage.jsx";

function App() {
  const [theme, setTheme] = useState("light");
  const location = useLocation();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);

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
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [page]);

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
          (nextFilters.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
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

export default App;
