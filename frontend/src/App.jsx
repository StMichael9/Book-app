import { useEffect, useMemo, useState } from "react";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";

import { getBooks } from "./api/books.js";
import AuthForm from "./components/AuthForm.jsx";
import BrowseShelf from "./components/BrowseShelf.jsx";
import Header from "./components/Header.jsx";
import LandingPage from "./components/LandingPage.jsx";
import Pagination from "./components/Pagination.jsx";
import PreferencesPage from "./components/PreferencesPage.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import ResultsList from "./components/ResultsList.jsx";
import SearchBar from "./components/SearchBar/SearchBar.jsx";
import BookDetailPage from "./components/BookDetailPage.jsx";
import MyBooksPage from "./components/MyBooksPage.jsx";
import { useAuth } from "./hooks/AuthContext.jsx";
import { BROWSE_SHELVES } from "./data/browseShelves.js";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
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

    setFilters({ book: paramBook, author: paramAuthor, tags: paramTags });
    setDiscoveryFilters({ excludeOwned: false, shelfStatus: "" });
    setPage(1);
    setHasSearched(false);
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

  const urlFilters = useMemo(
    () => ({
      book: searchParams.get("book")?.trim() ?? "",
      author: searchParams.get("author")?.trim() ?? "",
      tags: searchParams
        .getAll("tag")
        .map((tag) => tag.trim())
        .filter(Boolean),
    }),
    [searchParams],
  );
  const hasUrlFilters = Boolean(
    urlFilters.book || urlFilters.author || urlFilters.tags.length > 0,
  );
  const hasActiveFilters = Boolean(
    filters.book ||
    filters.author ||
    filters.tags.length > 0 ||
    discoveryFilters.excludeOwned ||
    discoveryFilters.shelfStatus,
  );
  const isDiscoveryMode =
    !hasUrlFilters && !hasActiveFilters && searchParams.get("view") !== "all";
  const requestFilters = useMemo(
    () => (hasUrlFilters ? urlFilters : filters),
    [filters, hasUrlFilters, urlFilters],
  );

  useEffect(() => {
    let ignore = false;

    const loadBooks = async () => {
      setLoading(true);
      setError("");

      try {
        const payload = await getBooks({
          book: requestFilters.book,
          author: requestFilters.author,
          tags: requestFilters.tags,
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

    if (!isDiscoveryMode) {
      loadBooks();
    } else {
      setBooks([]);
      setTotal(0);
      setLoading(false);
      setError("");
    }

    return () => {
      ignore = true;
    };
  }, [
    discoveryFilters,
    filters,
    hasSearched,
    isDiscoveryMode,
    page,
    requestFilters,
    size,
  ]);

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
      <SearchBar
        onSearch={runSearch}
        activeFilters={{ total }}
        initialFilters={filters}
        excludeOwned={discoveryFilters.excludeOwned}
        shelfStatus={discoveryFilters.shelfStatus}
        onDiscoveryFilterChange={updateDiscoveryFilters}
      />

      {isDiscoveryMode && (
        <section
          className="browse-discovery"
          aria-labelledby="browse-discovery-title"
        >
          <div className="browse-discovery__intro">
            <div>
              <p className="eyebrow">Curated shelves</p>
              <h2 id="browse-discovery-title">Find your next read</h2>
              <p>Follow a mood, a subject, or a story into something new.</p>
            </div>
            <Link className="browse-mode-link" to="/browse?view=all">
              Browse all books <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
          <div className="browse-shelves" aria-label="Editorial book shelves">
            {BROWSE_SHELVES.map((shelf) => (
              <BrowseShelf key={shelf.id} shelf={shelf} />
            ))}
          </div>
        </section>
      )}

      {!isDiscoveryMode && (
        <section
          className="browse-catalogue"
          aria-labelledby="browse-catalogue-title"
        >
          <div className="browse-catalogue__header">
            <div>
              <p className="eyebrow">The complete catalogue</p>
              <h2 id="browse-catalogue-title">All books</h2>
            </div>
            <Link className="browse-mode-link" to="/browse">
              <span aria-hidden="true">&larr;</span> Discover books
            </Link>
          </div>

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
        </section>
      )}
    </>
  );
}

export default App;
