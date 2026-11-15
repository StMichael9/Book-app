import { apiRequest } from "./client.js";

// Book suggestions as a reader types (T61). Public; under two characters the server answers []. The caller debounces,
// aborts stale requests and never uses /books?q= for this, which is slow and rate-limited.
export const getBookSuggestions = (query, signal) => apiRequest(`/autocomplete/books?${new URLSearchParams({ q: query, limit: "6" })}`, { signal, skipRefresh: true });
