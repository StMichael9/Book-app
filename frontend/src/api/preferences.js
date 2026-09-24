import { apiRequest } from "./client.js";

export function getPreferences() {
  return apiRequest("/me/preferences");
}

export function savePreferences({ tagIds, sourceText }) {
  return apiRequest("/me/preferences", {
    method: "POST",
    body: JSON.stringify({ tag_ids: tagIds, source_text: sourceText }),
  });
}