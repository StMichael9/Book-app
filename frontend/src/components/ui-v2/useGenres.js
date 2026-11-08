import { getGenreIds, getGenres } from "../../api/genres.js";
import { useRequest } from "./data.js";

// One hook for every genre name in the app, fetched once and kept for the session. If the list can't be loaded the caller
// hides its genre controls: there is no fallback list and a raw key is never shown.
export function useGenres() {
  const list = useRequest(getGenres, "genres:list");
  const genres = list.data;
  const keys = genres ? genres.map(genre => genre.key) : [];
  const ids = useRequest(() => getGenreIds(keys), `genres:ids:${keys.join(",")}`, Boolean(genres?.length));
  const byKey = Object.fromEntries((genres || []).map(genre => [genre.key, genre]));
  return {
    genres, byKey, loading: list.loading, failed: Boolean(list.error), retry: list.retry,
    // The label for a key, or null when the key isn't a genre (a mood, a theme, anything unknown): callers hide it.
    labelFor: key => byKey[key]?.label ?? null,
    // The tag id behind a key, for the two places the API still takes ids; null until it is known.
    idFor: key => ids.data?.[key] ?? null,
    idsReady: Boolean(ids.data) && !ids.error,
  };
}
