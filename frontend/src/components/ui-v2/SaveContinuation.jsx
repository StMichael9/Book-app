import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { useReader } from "./readerState.js";
import { validBookId } from "./data.js";
import { Button } from "./primitives.jsx";

// Keep continuation feedback next to the book's shelf actions.
export default function SaveContinuation() {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const library = useUserBooks();
  const reader = useReader();
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const attempted = useRef("");
  const continueSave = useEffectEvent((book, shelf) => reader.saveBook(book, shelf, true));
  const bookId = validBookId(location.pathname.match(/^\/book\/(\d+)$/)?.[1]);
  const status = new URLSearchParams(location.search).get("save");
  useEffect(() => {
    if (!bookId || !["want", "owned"].includes(status) || !auth.isAuthenticated || auth.isLoading || !reader.libraryReady || library.loading || library.error) return undefined;
    const key = `${location.pathname}:${location.search}:${retry}`;
    if (attempted.current === key) return undefined;
    attempted.current = key;
    let active = true;
    setFailed(false);
    continueSave({ id: bookId }, status).then((success) => {
      if (!active) return;
      if (success) {
        const params = new URLSearchParams(location.search); params.delete("save");
        navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
      } else setFailed(true);
    });
    return () => { active = false; };
  }, [bookId, status, auth.isAuthenticated, auth.isLoading, reader.libraryReady, library.loading, library.error, location.pathname, location.search, retry, navigate]);
  return failed && bookId && ["want", "owned"].includes(status) ? <div className="bv-notice bv-notice--error bv-save-retry"><p role="alert">You’re signed in, but this book couldn’t be saved. Please try again.</p><Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Retry save</Button></div> : null;
}
