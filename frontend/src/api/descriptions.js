import { apiRequest } from "./client.js";

// {text, source: "openlibrary" | "google" | null, link?}; the server decides which source answers.
export const getBookDescription = bookId => apiRequest(`/books/${Number(bookId)}/description`);
export const getEntryDescription = entryId => apiRequest(`/me/library/${Number(entryId)}/description`);
