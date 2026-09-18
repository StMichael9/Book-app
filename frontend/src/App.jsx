import { useEffect, useMemo, useRef, useState } from "react";
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
import { X } from "lucide-react";

const THEME_STORAGE_KEY = "shelfbound-theme";

function getInitialTheme() {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme === "dark" || storedTheme === "light"
      ? storedTheme
      : "light";
  } catch {
    return "light";
  }
}

function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const preferencesTriggerRef = useRef(null);
  const preferencesDialogRef = useRef(null);

  const closePreferences = ({ restoreFocus = true } = {}) => {
    setIsPreferencesOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => preferencesTriggerRef.current?.focus(), 0);
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
    }
  }, [theme]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);

  useEffect(() => {
    if (!isPreferencesOpen) return undefined;

    preferencesDialogRef.current?.querySelector("button")?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePreferences();
        return;
      }

      if (event.key !== "Tab" || !preferencesDialogRef.current) return;

      const focusableElements = preferencesDialogRef.current.querySelectorAll(
        "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) return;
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isPreferencesOpen]);

  useEffect(() => {
    if (!isAuthenticated) setIsPreferencesOpen(false);
  }, [isAuthenticated]);

  return (
    <div className="app-shell">
      <Header
        theme={theme}
        setTheme={setTheme}
        isPreferencesOpen={isPreferencesOpen}
        onOpenPreferences={(trigger) => {
          preferencesTriggerRef.current = trigger;
          setIsPreferencesOpen(true);
        }}
        onClosePreferences={() => closePreferences({ restoreFocus: false })}
      />

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

      {isPreferencesOpen && (
        <div
          className="preferences-overlay"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closePreferences();
          }}
        >
          <section
            ref={preferencesDialogRef}
            className="preferences-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preferences-dialog-title"
          >
            <div className="preferences-dialog__header">
              <div>
                <p className="eyebrow">Your preferences</p>
                <h2 id="preferences-dialog-title">Your reading shelf</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close preferences"
                title="Close preferences"
                onClick={closePreferences}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <PreferencesPage
              panel
              onClose={closePreferences}
              onSaved={closePreferences}
            />
          </section>
        </div>
      )}
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
  };

  const updateDiscoveryFilters = (nextFilters) => {
    setDiscoveryFilters((current) => ({ ...current, ...nextFilters }));
    setPage(1);
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
  const requestTagsKey = requestFilters.tags.join("\u0000");

  useEffect(() => {
    let ignore = false;

    const loadBooks = async () => {
      setLoading(true);
      setError("");

      try {
        const request = getBooks({
          book: requestFilters.book,
          author: requestFilters.author,
          tags: requestTagsKey ? requestTagsKey.split("\u0000") : [],
          exclude_owned: discoveryFilters.excludeOwned,
          shelf_status: discoveryFilters.shelfStatus,
          page,
          size,
          cacheScope: isAuthenticated ? "authenticated" : "public",
        });

        const payload = await request;

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
          setError(
            loadError.status === 429
              ? "Books are taking a moment to load. Please try again shortly."
              : loadError.message || "Unable to load books right now.",
          );
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
    discoveryFilters.excludeOwned,
    discoveryFilters.shelfStatus,
    isAuthenticated,
    isDiscoveryMode,
    page,
    requestFilters.author,
    requestFilters.book,
    requestTagsKey,
    size,
  ]);

  const handlePageChange = (nextPage) => {
    if (nextPage < 1) return;
    setPage(nextPage);
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
