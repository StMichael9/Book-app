import { useEffect, useState } from "react";

import { getMyBooks } from "../api/userBooks.js";
import BookCard from "./BookCard.jsx";

export default function MyBooksPage() {
  const [status, setStatus] = useState("owned");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getMyBooks(status)
      .then((nextItems) => {
        if (active) setItems(Array.isArray(nextItems) ? nextItems : []);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || "Unable to load your shelf.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status]);

  return (
    <section className="shelf-page">
      <div className="shelf-header">
        <div>
          <p className="eyebrow">Your library</p>
          <h2>My books</h2>
        </div>
        <div className="shelf-tabs" role="tablist" aria-label="My book shelves">
          {["owned", "want"].map((nextStatus) => (
            <button
              type="button"
              role="tab"
              aria-selected={status === nextStatus}
              className={status === nextStatus ? "shelf-tab active" : "shelf-tab"}
              key={nextStatus}
              onClick={() => setStatus(nextStatus)}
            >
              {nextStatus === "owned" ? "Owned" : "Want to read"}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error-message">{error}</p>}
      {loading ? (
        <div className="loading-state">Loading your shelf…</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p>{status === "owned" ? "No owned books yet." : "Your reading list is empty."}</p>
          <span>Browse the collection and add a book when one catches your eye.</span>
        </div>
      ) : (
        <section className="book-grid" aria-label={`${status} books`}>
          {items.map((item) => item.book && <BookCard key={item.id} book={item.book} />)}
        </section>
      )}
    </section>
  );
}