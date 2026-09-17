import { useEffect, useMemo, useState } from "react";
import { Route, Routes, useLocation, useSearchParams } from "react-router-dom";

import { getBooks } from "./api/books.js";
import AuthForm from "./components/AuthForm.jsx";
import Header from "./components/Header.jsx";
import Hero from "./components/Hero.jsx";
import LandingPage from "./components/LandingPage.jsx";
import Pagination from "./components/Pagination.jsx";
import PreferencesPage from "./components/PreferencesPage.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import ResultsList from "./components/ResultsList.jsx";
import SearchBar from "./components/SearchBar/SearchBar.jsx";
import BookDetailPage from "./components/BookDetailPage.jsx";
import MyBooksPage from "./components/MyBooksPage.jsx";
import { useAuth } from "./hooks/AuthContext.jsx";

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
      <Header theme={theme} setTheme={setTheme} />

      <button
        type="button"
        className="theme-toggle desktop-theme-toggle"
        onClick={() =>
          setTheme((current) => (current === "light" ? "dark" : "light"))
        }
        aria-label="Toggle warm dark mode"
      >
        {theme === "light" ? "Warm dark" : "Vintage light"}
      </button>

      <main className="page">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/browse" element={<HomePage />} />
          <Route path="/book/:bookId" element={<BookDetailPage />} />
          <Route path="/login" element={<AuthForm mode="login" />} />
          <Route path="/register" element={<AuthForm mode="register" />} />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <PreferencesPage onboarding />
              </ProtectedRoute>
            }
          />
          <Route
            path="/preferences"
            element={
              <ProtectedRoute>
                <PreferencesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-books"
            element={
              <ProtectedRoute>
                <MyBooksPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </div>
  );
}

function HomePage() {
  const { isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({ book: "", author: "", tags: [] });
  const [discoveryFilters, setDiscoveryFilters] = useState({
    excludeOwned: false,
    shelfStatus: "",
  });
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
    if (!isAuthenticated) {
      setDiscoveryFilters({ excludeOwned: false, shelfStatus: "" });
      setPage(1);
    }
  }, [isAuthenticated]);

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

  const updateDiscoveryFilters = (nextFilters) => {
    setDiscoveryFilters((current) => ({ ...current, ...nextFilters }));
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
          exclude_owned: discoveryFilters.excludeOwned,
          shelf_status: discoveryFilters.shelfStatus,
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
  }, [discoveryFilters, filters, hasSearched, page, size]);

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
      <SearchBar
        onSearch={runSearch}
        activeFilters={{ total }}
        excludeOwned={discoveryFilters.excludeOwned}
        onDiscoveryFilterChange={updateDiscoveryFilters}
      />

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
