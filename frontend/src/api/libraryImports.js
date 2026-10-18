import { apiRequest } from "./client.js";

const root = "/me/library-imports";
const messages = {
  active_import_exists: "You already have a saved import. Resume it or cancel its future work before starting another.",
  batch_content_changed: "This file differs from the saved upload. Reselect the original file, or cancel and start a separate import.",
  column_clarification_required: "Choose the ambiguous columns before checking your file.",
  upload_manifest_mismatch: "The upload was incomplete or did not match its acknowledgements. Reselect the same file to resume safely.",
  preview_changed: "Your preview changed. Reload the saved import and review it before confirming.",
  unresolved_rows_require_decision: "Resolve the exceptions, approve private entries, or explicitly choose to skip unresolved rows.",
  import_capacity_pause: "Importing is paused to preserve database space for your existing books and other readers. No existing data was removed.",
  import_staging_limit_cancel_or_use_smaller_file: "This file’s preview exceeds the temporary-data limit. Cancel this import and split the file into smaller collections. Nothing was silently truncated.",
  import_input_limit: "This upload exceeds the supported row, text or data-size limits. Use a smaller file; nothing was truncated.",
  import_expired: "The seven-day resume window expired. Your committed books remain. Start another import with your original file.",
  import_not_found: "This saved import is unavailable for your account.",
  private_title_required: "A private book needs a title. Supply a title in your source file or skip the row.",
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
