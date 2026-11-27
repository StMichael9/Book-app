import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { listClubs } from "../../api/clubs.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useRequest } from "../ui-v2/data.js";

// The reader's clubs, asked for once per page (the request layer shares it with the clubs list, so it is never asked twice).
// `enabled` lets a page hold the request back (Home waits until its own data has rendered).
export function useMyClubs(enabled = true) {
  const auth = useAuth();
  const request = useRequest(() => listClubs(), `clubs:${auth.sessionGeneration}`, enabled && auth.isAuthenticated);
  return request.data?.items || [];
}

// True once `active` has been so and the browser is idle, so a request that is only decoration never delays first paint.
export function useAfterIdle(active) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active || ready) return undefined;
    const arrive = () => setReady(true);
    if (typeof requestIdleCallback === "function") { const id = requestIdleCallback(arrive, { timeout: 2000 }); return () => cancelIdleCallback(id); }
    const id = setTimeout(arrive, 200);
    return () => clearTimeout(id);
  }, [active, ready]);
  return ready;
}

// The first club (by list order) whose current book is this book, or null.
export const clubWithBook = (clubs, bookId) => (bookId == null ? null : clubs.find(club => club.current_book?.book_id === bookId) || null);

// "With {club}": a small green line, shown where a book is also a club's current book.
export default function WithClub({ club }) {
  if (!club) return null;
  return <p className="bv-with-club"><Link to={`/clubs/${club.id}`}><Users aria-hidden="true" />With {club.name}</Link></p>;
}
