import { getLibraryPage } from "../../../api/reading.js";

// The library view lives in the URL: shelf, Owned, sort, search and every filter. These helpers turn the URL into a
// state object and a state object into the API query (and back), so Back and shared links restore the view.
export const SHELVES = ["all", "reading", "want", "finished", "paused", "dnf"];
export const SORTS = [["added", "Recently added"], ["title", "Title"], ["author", "Author (surname)"], ["finished", "Date finished"], ["updated", "Recently updated"]];
export const PAGE_SIZE = 24;
export const MAX_RESTORE = 100;
const GROUPS = { subject: "subject", author: "author", length: "length", source: "source_label", year: "year_finished" };
export const FILTER_GROUPS = Object.keys(GROUPS);
export const JUST_IMPORTED_DAYS = 7;

const numeric = values => values.filter(value => /^\d{1,9}$/.test(value));

export function readLibraryState(params) {
  const status = params.get("status");
  const sort = params.get("sort");
  return {
    q: params.get("q") || "",
    // An older link with status=owned means "Owned on any shelf".
    shelf: SHELVES.includes(status) ? status : "all",
    owned: params.get("owned") === "1" || status === "owned",
    sort: SORTS.some(([key]) => key === sort) ? sort : "added",
    subject: numeric(params.getAll("subject")),
    author: params.getAll("author").slice(0, 50),
    length: params.getAll("length").filter(value => ["short", "medium", "long"].includes(value)),
    source: params.getAll("source").slice(0, 50),
    year: numeric(params.getAll("year")),
    note: params.get("note") === "1",
    recent: params.get("imported") === "week",
    label: params.get("label") || "",
  };
}

export function writeLibraryState(state) {
  const out = new URLSearchParams();
  if (state.q) out.set("q", state.q);
  if (state.shelf !== "all") out.set("status", state.shelf);
  if (state.owned) out.set("owned", "1");
  if (state.sort !== "added") out.set("sort", state.sort);
  for (const group of FILTER_GROUPS) for (const value of state[group]) out.append(group, value);
  if (state.note) out.set("note", "1");
  if (state.recent) out.set("imported", "week");
  if (state.label) out.set("label", state.label);
  return out;
}

export function activeFilterCount(state) {
  return FILTER_GROUPS.reduce((total, group) => total + state[group].length, 0) + (state.note ? 1 : 0) + (state.recent ? 1 : 0);
}

// Anything that narrows the list apart from the shelf: the count in the head reads "N of M" while one of these is on.
export const isFiltered = state => Boolean(state.q || state.owned || state.label || activeFilterCount(state));

export const clearFilters = state => ({ ...state, q: "", owned: false, label: "", note: false, recent: false, subject: [], author: [], length: [], source: [], year: [] });

const isoDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// The API's own names for the same state. `shelf` is the facet; Owned is a flag that combines with any shelf.
export function libraryApiParams(state, { search = true, now = new Date() } = {}) {
  const out = new URLSearchParams();
  if (search) out.set("q", state.q);
  out.set("facet", state.shelf);
  if (state.owned) out.set("owned", "true");
  out.set("sort", state.sort);
  for (const [group, name] of Object.entries(GROUPS)) for (const value of state[group]) out.append(name, value);
  if (state.note) out.set("has_note", "true");
  if (state.recent) out.set("imported_since", isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - JUST_IMPORTED_DAYS)));
  if (state.label) out.set("label", state.label);
  return out;
}

export const libraryKey = (generation, state, revision) => `library:${generation}:${libraryApiParams(state).toString()}:${revision}`;

export const defaultLibraryState = () => readLibraryState(new URLSearchParams());

// One page of the library for this state, checked for the shape the page relies on. The prefetcher uses it too.
export async function loadLibraryPage(state, cursor = "", limit = PAGE_SIZE) {
  const params = libraryApiParams(state);
  params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const page = await getLibraryPage(params);
  if (!Array.isArray(page?.items) || !page.counts || typeof page.total !== "number") throw new Error("Unable to load your library.");
  return page;
}
