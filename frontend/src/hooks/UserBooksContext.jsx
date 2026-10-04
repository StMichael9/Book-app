import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { getMyBooks, removeBookStatus, setBookStatus } from "../api/userBooks.js";
import { useAuth } from "./AuthContext.jsx";

const UserBooksContext = createContext(null);

export function UserBooksProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [booksById, setBooksById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const sessionGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    setError("");

    if (!isAuthenticated) {
      setBooksById({});
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    getMyBooks()
      .then((items) => {
        if (!active) return;
        if (!Array.isArray(items)) throw new Error("Unable to load your saved books.");
        setBooksById(
          Object.fromEntries(
            items.map((item) => [
              item.book_id,
              { ...item, book: item.book },
            ]),
          ),
        );
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || "Unable to load your saved books.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      sessionGeneration.current += 1;
    };
  }, [isAuthenticated, loadAttempt]);

  const value = useMemo(
    () => ({
      booksById,
      loading,
      error,
      retryLoad() {
        setLoadAttempt((attempt) => attempt + 1);
      },
      async updateStatus(bookId, status) {
        const generation = sessionGeneration.current;
        const next = await setBookStatus(bookId, status);
        if (generation === sessionGeneration.current) {
          setBooksById((current) => ({ ...current, [bookId]: next }));
        }
        return next;
      },
      async clearStatus(bookId) {
        const generation = sessionGeneration.current;
        await removeBookStatus(bookId);
        if (generation !== sessionGeneration.current) return;
        setBooksById((current) => {
          const next = { ...current };
          delete next[bookId];
          return next;
        });
      },
    }),
    [booksById, loading, error],
  );

  return (
    <UserBooksContext.Provider value={value}>
      {children}
    </UserBooksContext.Provider>
  );
}

export function useUserBooks() {
  const context = useContext(UserBooksContext);
  if (!context) {
    throw new Error("useUserBooks must be used within UserBooksProvider");
  }
  return context;
}
