import { useState } from "react";
import { ensureLibraryBook, getReadingWorkspace, lookupLibraryBooks } from "../../api/reading.js";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import ProgressBox from "../reading/ProgressBox.jsx";
import { startReading } from "../reading/home/homeLogic.js";
import { NativeDialog } from "../ui-v2/primitives.jsx";
import { UPDATE_MY_PAGE } from "./clubCopy.js";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";

// The reader's own library entry for the club's book, with a reading started if there isn't one.
async function openEntry(bookId) {
  const found = (await lookupLibraryBooks([bookId]))?.items?.find(item => item.book_id === bookId);
  const entryId = found?.entry_id ?? (await ensureLibraryBook(bookId, { is_wanted: true })).id;
  await startReading(entryId);
  const workspace = await getReadingWorkspace(entryId);
  return { entry: workspace.entry, attempt: workspace.current_attempt };
}

// "Update my page": opens the existing ProgressBox in a sheet for the reader's own entry for the club's book. The card and the locked-posts line
// both use it. After a save the club's data is refreshed (onChanged), which also opens the posts the new page unlocks.
export function useUpdatePage({ book, onChanged }) {
  const library = useUserBooks();
  const [opening, setOpening] = useState(false), [error, setError] = useState(""), [box, setBox] = useState(null);
  async function open() {
    if (opening || !book) return;
    setOpening(true); setError("");
    try {
      const result = await openEntry(book.book_id);
      library.readingChanged(result.entry);
      setBox(result);
    } catch { setError(SAVE_FAILED); }
    setOpening(false);
  }
  const dialog = box && book ? <NativeDialog open onClose={() => setBox(null)} title={UPDATE_MY_PAGE} className="bv-club-sheet">
    <ProgressBox entry={box.entry} attempt={box.attempt} title={book.title} onSaved={result => { library.readingChanged(result?.entry); onChanged(); }} />
  </NativeDialog> : null;
  return { open, opening, error, dialog };
}
