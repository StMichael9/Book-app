import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { getMyBooks, removeBookStatus, setBookStatus } from "../api/userBooks.js";
import { useAuth } from "./AuthContext.jsx";

const UserBooksContext = createContext(null);

export function UserBooksProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [booksById, setBooksById] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    if (!isAuthenticated) {
      setBooksById({});
      return undefined;
    }

    setLoading(true);
    getMyBooks()
      .then((items) => {
        if (!active) return;
        setBooksById(
          Object.fromEntries(
            (Array.isArray(items) ? items : []).map((item) => [
              item.book_id,
              { ...item, book: item.book },
            ]),
          ),
        );
      })
      .catch(() => {
        if (active) setBooksById({});
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  const value = useMemo(
    () => ({
      booksById,
      loading,
      async updateStatus(bookId, status) {
        const next = await setBookStatus(bookId, status);
        setBooksById((current) => ({ ...current, [bookId]: next }));
        return next;
      },
      async clearStatus(bookId) {
        await removeBookStatus(bookId);
        setBooksById((current) => {
          const next = { ...current };
          delete next[bookId];
          return next;
        });
      },
    }),
    [booksById, loading],
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