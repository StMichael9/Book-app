import { apiRequest } from "./client.js";

const root = "/me/library-imports";
// Covers and descriptions fill in after an import; this says how many are still being looked up.
export const importEnrichment = (runId, signal) => apiRequest(`/me/library/imports/${encodeURIComponent(runId)}/enrichment`, { signal });
const messages = {
  active_import_exists: "You already have an import waiting. Continue it or start over.",
  batch_content_changed: "This file is different from the one you started with. Choose the original file, or start over.",
  column_clarification_required: "Choose the ambiguous columns before checking your file.",
  upload_manifest_mismatch: "Your upload didn’t finish cleanly. Choose the same file again to carry on.",
  preview_changed: "Your import changed while you were looking. Open it again and review it before adding.",
  unresolved_rows_require_decision: "Some books still need a choice. Make a choice, or skip them.",
  import_capacity_pause: "Importing is paused for a little while to keep Bookvane running smoothly. Your library hasn’t changed.",
  import_staging_limit_cancel_or_use_smaller_file: "This file is too large to check in one go. Split it into smaller files and import them one at a time.",
  import_input_limit: "This file is too large. Use a smaller file; nothing was cut off.",
  import_expired: "This import expired. Books already added stay. Start again with your original file.",
  import_not_found: "This saved import is unavailable for your account.",
  private_title_required: "A book needs a title. Add a title in your file or skip it.",
};
async function request(path, options) {
  try { return await apiRequest(path, options); }
  catch (error) {
    if (messages[error.detail?.code]) error.message = messages[error.detail.code];
    throw error;
  }
}
const write = (path, data, signal, method = "POST") => request(`${root}${path}`, { method, body: JSON.stringify(data), signal });
export const inspectImport = (headers, mapping, signal) => write("/inspect", { headers, ...(mapping ? { mapping } : {}) }, signal);
export const startImport = (data, signal) => write("", data, signal);
export const recentImports = signal => request(root, { signal });
export const getImport = (id, signal) => request(`${root}/${id}`, { signal });
export const uploadImport = (id, ordinal, rows, signal) => write(`/${id}/batches/${ordinal}`, { rows }, signal, "PUT");
export const finalizeImport = (id, data, signal) => write(`/${id}/finalize-upload`, data, signal);
export const advanceImport = (id, signal) => write(`/${id}/advance`, {}, signal);
export const importRows = (id, after = 0, onlyReview = false, signal) => request(`${root}/${id}/rows?after=${after}&only_review=${onlyReview}`, { signal });
export const decideImport = (id, ordinal, data, signal) => write(`/${id}/rows/${ordinal}`, data, signal, "PATCH");
export const confirmImport = (id, data, signal) => write(`/${id}/confirm`, data, signal);
export const cancelImport = (id, signal) => write(`/${id}/cancel`, {}, signal);
export const forgetRemovedMarkers = signal => write("/forget-removed-markers", { confirmed: true }, signal);
export const importedSources = (entryId, after = "") => request(`/me/library/${entryId}/imported-sources${after ? `?after=${encodeURIComponent(after)}` : ""}`);
export const removeImportedSource = (entryId, recordId) => request(`/me/library/${entryId}/imported-sources/${recordId}`, { method: "DELETE" });
export const exportLibraryCsv = signal => request(`${root}/export.csv`, { responseType: "response", signal });
export const exportImportReport = (id, signal) => request(`${root}/${id}/report.csv`, { responseType: "response", signal });
