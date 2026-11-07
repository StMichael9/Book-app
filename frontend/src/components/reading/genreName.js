// Genres arrive as lower-case names or raw slugs ("historical-fiction", "science_fiction"). Readers see sentence case.
const KNOWN = { "sci-fi": "Science fiction", scifi: "Science fiction", ya: "Young adult", "non-fiction": "Nonfiction", "true-crime": "True crime" };

export function genreName(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase();
  if (KNOWN[key]) return KNOWN[key];
  const text = key.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
