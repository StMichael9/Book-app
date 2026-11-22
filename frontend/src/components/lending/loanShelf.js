import { lookupLibraryBooks } from "../../api/reading.js";

// After a loan puts a book on the shelf, read its shelf state so the page and the shelf buttons agree.
export async function readShelfAfterLoan(library, bookId) {
  try {
    const { items } = await lookupLibraryBooks([bookId]);
    library.readingChanged(items?.find(item => item.book_id === bookId));
  } catch { library.readingChanged(); }
}
