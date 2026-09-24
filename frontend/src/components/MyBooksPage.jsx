import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { getMyBooks } from "../api/userBooks.js";
import BookCard from "./BookCard.jsx";
import { useAuth } from "../hooks/AuthContext.jsx";

const SHELVES = [
  {
    status: "owned",
    title: "Books You’ve Brought Home",
    description: "The books that belong on your shelf.",
    emptyMessage: "Your shelves are quiet for now. Find something worth bringing home.",
    emptyAction: "Browse books",
  },
  {
    status: "want",
    title: "Waiting for Their Turn",
    description: "Books you’re saving for a future read.",
    emptyMessage: "A few books are waiting to be discovered.",
    emptyAction: "Discover something new",
  },
];

const initialShelfState = {
  items: [],
  loading: true,
  error: false,
};

export default function MyBooksPage() {
  const { isAuthenticated } = useAuth();
  const activeRequestRef = useRef(null);
  const [shelves, setShelves] = useState({
    owned: initialShelfState,
    want: initialShelfState,
  });

  const loadShelf = useCallback((status, activeRef) => {
    setShelves((current) => ({
      ...current,
      [status]: { ...current[status], loading: true, error: false },
    }));

    return getMyBooks(status)
      .then((nextItems) => {
        if (!activeRef?.current) return;
        setShelves((current) => ({
          ...current,
          [status]: {
            items: Array.isArray(nextItems) ? nextItems : [],
            loading: false,
            error: false,
          },
        }));
      })
      .catch(() => {
        if (!activeRef?.current) return;
        setShelves((current) => ({
          ...current,
          [status]: { ...current[status], loading: false, error: true },
        }));
      });
  }, []);

  useEffect(() => {
    const activeRef = { current: true };
    activeRequestRef.current = activeRef;

    if (!isAuthenticated) {
      setShelves({
        owned: { ...initialShelfState, loading: false },
        want: { ...initialShelfState, loading: false },
      });
      return () => {
        activeRef.current = false;
        if (activeRequestRef.current === activeRef) {
          activeRequestRef.current = null;
        }
      };
    }

    setShelves({
      owned: initialShelfState,
      want: initialShelfState,
    });
    loadShelf("owned", activeRef);
    loadShelf("want", activeRef);
    return () => {
      activeRef.current = false;
      if (activeRequestRef.current === activeRef) {
        activeRequestRef.current = null;
      }
    };
  }, [isAuthenticated, loadShelf]);

  return (
    <section className="my-books-page">
      <header className="my-books-page__header">
        <p className="eyebrow">Your library</p>
        <h1>Your Library</h1>
        <p className="my-books-page__intro">
          The books you’ve gathered and the ones waiting to be read.
        </p>
      </header>

      <div className="my-books-page__shelves">
        {SHELVES.map((shelf) => (
          <LibraryShelf
            key={shelf.status}
            shelf={shelf}
            state={shelves[shelf.status]}
            onRetry={() => loadShelf(shelf.status, activeRequestRef.current)}
          />
        ))}
      </div>
    </section>
  );
}

function LibraryShelf({ shelf, state, onRetry }) {
  return (
    <section className="library-shelf" aria-labelledby={`${shelf.status}-shelf-title`}>
      <header className="library-shelf__header">
        <div>
          <h2 id={`${shelf.status}-shelf-title`}>{shelf.title}</h2>
          <p>{shelf.description}</p>
        </div>
      </header>

      {state.loading ? (
        <div className="library-shelf__state" role="status">
          <span className="library-shelf__state-mark" aria-hidden="true" />
          <span>Gathering the books on this shelf...</span>
        </div>
      ) : state.error ? (
        <div className="library-shelf__state library-shelf__state--error" role="alert">
          <p>We couldn’t open this shelf right now.</p>
          <button type="button" className="my-books-page__text-button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : state.items.length === 0 ? (
        <div className="library-shelf__state library-shelf__state--empty">
          <p>{shelf.emptyMessage}</p>
          <Link className="my-books-page__browse-link" to="/browse">
            {shelf.emptyAction} <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : (
        <div className="library-shelf__track" tabIndex="0" aria-label={`${shelf.title} books`}>
          <div className="library-shelf__books">
            {state.items.map(
              (item) => item.book && <BookCard key={item.id} book={item.book} showWantAffiliate={shelf.status === "want"} />,
            )}
          </div>
        </div>
      )}
    </section>
  );
}
