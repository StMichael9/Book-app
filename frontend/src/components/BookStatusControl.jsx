import { useState } from "react";

import { useAuth } from "../hooks/AuthContext.jsx";
import { useUserBooks } from "../hooks/UserBooksContext.jsx";

export default function BookStatusControl({ bookId, compact = false }) {
  const { isAuthenticated } = useAuth();
  const { booksById, updateStatus, clearStatus } = useUserBooks();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const currentStatus = booksById[bookId]?.status || "";

  const changeStatus = async (nextStatus) => {
    if (!isAuthenticated) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    setPending(true);
    setError("");
    try {
      if (currentStatus === nextStatus) {
        await clearStatus(bookId);
      } else {
        await updateStatus(bookId, nextStatus);
      }
    } catch (statusError) {
      setError(statusError.message || "Unable to update this shelf.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={`book-status ${compact ? "book-status-compact" : ""}`}>
      <div className="book-status-actions" aria-label="Book shelf status">
        <button
          type="button"
          className={currentStatus === "owned" ? "status-button active" : "status-button"}
          onClick={() => changeStatus("owned")}
          disabled={pending}
        >
          {currentStatus === "owned" ? "Owned" : "Own"}
        </button>
        <button
          type="button"
          className={currentStatus === "want" ? "status-button active" : "status-button"}
          onClick={() => changeStatus("want")}
          disabled={pending}
        >
          {currentStatus === "want" ? "Want to read" : "Want"}
        </button>
      </div>
      {error && <span className="status-error">{error}</span>}
    </div>
  );
}