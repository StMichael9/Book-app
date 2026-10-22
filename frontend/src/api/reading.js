import { apiRequest } from "./client.js";

export const getReadingCapabilities = () => apiRequest("/me/reading-capabilities");
export const lookupLibraryBooks = (bookIds, signal) => apiRequest("/me/library/lookup", {
  method: "POST", body: JSON.stringify({ book_ids: bookIds }), signal,
});
export const ensureLibraryBook = (bookId, flags) => apiRequest(`/me/library/books/${bookId}`, {
  method: "PUT", body: JSON.stringify(flags),
});
export const getLibraryPage = (params) => apiRequest(`/me/library?${new URLSearchParams(params)}`);
export const getReadingHome = () => apiRequest("/me/home");
export const getNextRead = (values) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (key === "exclude") for (const identity of value) params.append("exclude", identity);
    else if (value !== "" && value != null) params.set(key, String(value));
  }
  return apiRequest(`/me/next-read?${params}`);
};
export const getReadingWorkspace = (id) => apiRequest(`/me/library/${id}/reading`);
export const getReadingHistory = (id, cursor = "") => apiRequest(`/me/library/${id}/attempts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
export const createReadingAttempt = (id, data) => apiRequest(`/me/reading-attempts/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const updateReadingAttempt = (id, data) => apiRequest(`/me/reading-attempts/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const getReadingAttempt = (id) => apiRequest(`/me/reading-attempts/${id}`);
export const createPrivateEntry = (data) => apiRequest("/me/library/private", { method: "POST", body: JSON.stringify(data) });
export const findPrivateMatches = (title) => apiRequest(`/me/library/private-matches?${new URLSearchParams({ title })}`);
export const updateLibraryEntry = (id, data) => apiRequest(`/me/library/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteReadingAttempt = (id, version) => apiRequest(`/me/reading-attempts/${id}`, {
  method: "DELETE", body: JSON.stringify({ expected_version: version, confirmed: true }),
});
export const forgetLibraryEntry = (id, version) => apiRequest(`/me/library/${id}`, {
  method: "DELETE", body: JSON.stringify({ expected_version: version, confirmed: true }),
});
export const getReadingExport = () => apiRequest("/me/reading-export", { responseType: "response" });
export const getLibraryCsvExport = () => apiRequest("/me/library/export.csv", { responseType: "response" });
