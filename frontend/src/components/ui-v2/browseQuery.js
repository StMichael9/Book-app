// What Discover asks the catalogue for, from the address. Shared by the page and by the early start (api/earlyStart.js), so both
// make the same request under the same cache key.
export function readBrowseQuery(params, signedIn) {
  const book = params.get("book") || "";
  const author = params.get("author") || "";
  // A shared link can carry ?q= : one phrase that is looked for in titles and authors.
  const query = (params.get("q") || "").trim();
  const tags = [...new Set(params.getAll("tag").filter(Boolean))];
  const page = Math.max(1, parseInt(params.get("page"), 10) || 1);
  const exclude = signedIn && params.get("exclude_owned") === "true";
  const shelf = signedIn && ["want", "owned"].includes(params.get("shelf_status")) ? params.get("shelf_status") : "";
  return { book, author, query, tags, page, exclude, shelf, searching: Boolean(book || author || query) };
}

// Personalized ordering and in-flight requests belong to one session, not to every account that is signed in in this app.
export const browseScope = (signedIn, generation, preferencesVersion, shelfRevision) => (signedIn ? `session:${generation}:${preferencesVersion}:${shelfRevision}` : "public");
export const browseKey = (scope, queryKey, preferencesVersion) => `browse:${scope}:${queryKey}:${preferencesVersion}`;

export const browseRequestParams = (query, cacheScope) => ({
  book: query.book, author: query.author, q: query.query, ...(query.searching ? {} : { sort: "popular" }), tags: query.tags,
  exclude_owned: query.exclude, shelf_status: query.shelf, page: query.page, size: 20, cacheScope,
});
