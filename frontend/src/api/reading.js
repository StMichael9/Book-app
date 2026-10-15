import { apiRequest } from "./client.js";

export const getReadingCapabilities = () => apiRequest("/me/reading-capabilities");
export const lookupLibraryBooks = (bookIds, signal) => apiRequest("/me/library/lookup", {
  method: "POST", body: JSON.stringify({ book_ids: bookIds }), signal,
});
export const ensureLibraryBook = (bookId, flags) => apiRequest(`/me/library/books/${bookId}`, {
  method: "PUT", body: JSON.stringify(flags),
});
export const getLibraryPage = (params) => apiRequest(`/me/library?${new URLSearchParams(params)}`);
