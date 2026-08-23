import { apiRequest } from "./client.js";

export async function suggestAuthors(q) {
  const trimmed = q.trim();
  if (!trimmed) return [];

  try {
    return await apiRequest(
      `/autocomplete/authors?q=${encodeURIComponent(trimmed)}`,
    );
  } catch {
    return [];
  }
}

export async function suggestTags(q) {
  const trimmed = q.trim();
  if (!trimmed) return [];

  try {
    return await apiRequest(
      `/autocomplete/tags?q=${encodeURIComponent(trimmed)}`,
    );
  } catch {
    return [];
  }
}
