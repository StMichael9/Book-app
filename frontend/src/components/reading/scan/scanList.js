import { useCallback, useEffect, useRef, useState } from "react";
import { createPrivateEntry, ensureLibraryBook, lookupIsbn } from "../../../api/reading.js";

// The list of scanned books. Each row is one of: looking up, found, already on your shelf, not found (saved anyway) or failed (Retry).
// At most two lookups run at once, so one reader scanning quickly stays inside the service's limits.
export const MAX_LOOKUPS = 2;

// What a lookup answer means for a row.
export function rowFromAnswer(answer) {
  if (answer.on_shelf) return { state: "on_shelf", title: answer.title, authors: answer.authors || [], cover: answer.cover_url || null };
  if (answer.status === "catalogue") return { state: "found", bookId: answer.book_id, title: answer.title, authors: answer.authors || [], cover: answer.cover_url || null };
  if (answer.status === "open_library" && answer.title) return { state: "found", bookId: null, title: answer.title, authors: answer.authors || [], cover: answer.cover_url || null };
  return { state: "not_found", bookId: null, title: null, authors: [], cover: null };
}

export const isSaveable = row => row.state === "found" || row.state === "not_found";

// What "Add N books" sends for one row. `owned` is the one switch for the whole list. A book the catalogue already has is added to the
// shelf as it is; any other is saved as a private book that carries its ISBN, so the catalogue can find and link it later.
export function saveRow(row, owned, requestId) {
  const flags = owned ? { is_owned: true } : { is_wanted: true };
  if (row.state === "found" && row.bookId) return ensureLibraryBook(row.bookId, flags);
  return createPrivateEntry({
    request_id: requestId, title: row.title || `ISBN ${row.isbn}`, author: row.authors?.length ? row.authors.join(", ") : null,
    is_owned: owned, is_wanted: !owned, isbn: row.isbn,
  });
}

export function useScanList() {
  const [rows, setRows] = useState([]);
  const rowsRef = useRef([]), active = useRef(0), alive = useRef(true), controllers = useRef(new Map());
  const commit = next => { rowsRef.current = next; setRows(next); };
  const patch = (isbn, values) => commit(rowsRef.current.map(row => row.isbn === isbn ? { ...row, ...values } : row));

  const pump = useCallback(() => {
    while (alive.current && active.current < MAX_LOOKUPS) {
      const next = rowsRef.current.find(row => row.state === "waiting");
      if (!next) return;
      patch(next.isbn, { state: "looking" });
      active.current += 1;
      const controller = new AbortController();
      controllers.current.set(next.isbn, controller);
      lookupIsbn(next.isbn, controller.signal).then(answer => { if (alive.current && rowsRef.current.some(row => row.isbn === next.isbn)) patch(next.isbn, rowFromAnswer(answer)); },
        failure => { if (alive.current && !controller.signal.aborted && rowsRef.current.some(row => row.isbn === next.isbn)) patch(next.isbn, { state: "failed", status: failure?.status ?? 0 }); })
        .finally(() => { controllers.current.delete(next.isbn); active.current -= 1; pump(); });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = useCallback(isbn => {
    if (rowsRef.current.some(row => row.isbn === isbn)) return false;
    commit([{ isbn, state: "waiting", title: null, authors: [], cover: null, requestId: crypto.randomUUID() }, ...rowsRef.current]);
    pump();
    return true;
  }, [pump]);
  const remove = useCallback(isbn => { controllers.current.get(isbn)?.abort(); commit(rowsRef.current.filter(row => row.isbn !== isbn)); }, []);
  const retry = useCallback(isbn => { patch(isbn, { state: "waiting", status: undefined }); pump(); }, [pump]);
  const clear = useCallback(() => { for (const controller of controllers.current.values()) controller.abort(); commit([]); }, []);
  useEffect(() => { const running = controllers.current; alive.current = true; return () => { alive.current = false; for (const controller of running.values()) controller.abort(); }; }, []);
  return { rows, add, remove, retry, clear };
}
