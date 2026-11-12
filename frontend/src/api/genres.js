import { apiRequest } from "./client.js";

// The one genre list: [{ key, label, group: "fiction" | "nonfiction" }]. Nothing else in the app names a genre.
export async function getGenres() {
  const list = await apiRequest("/genres");
  if (!Array.isArray(list) || list.some(item => typeof item?.key !== "string" || typeof item.label !== "string")) throw new Error("Unable to load genres.");
  return list.map(item => ({ key: item.key, label: item.label, group: item.group === "nonfiction" ? "nonfiction" : "fiction", ...(Number.isInteger(item.id) ? { id: item.id } : {}) }));
}

// A genre's key is its tag's name; preferences and the Next Read subject still go by the tag's id.
export async function getGenreIds(keys) {
  const query = new URLSearchParams();
  keys.forEach(key => query.append("name", key));
  const tags = await apiRequest(`/autocomplete/tags/batch?${query}`);
  if (!Array.isArray(tags)) throw new Error("Unable to load genres.");
  return Object.fromEntries(tags.filter(tag => keys.includes(tag?.name) && Number.isInteger(tag.id)).map(tag => [tag.name, tag.id]));
}
