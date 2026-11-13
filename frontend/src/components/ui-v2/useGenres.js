import { useCallback } from "react";
import { getGenreIds, getGenres } from "../../api/genres.js";
import { useRequest } from "./data.js";

const plain = text => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// One hook for every genre name in the app, fetched once and kept for the session. If the list can't be loaded the caller
// hides its genre controls: there is no fallback list and a raw key is never shown.
export function useGenres() {
  const list = useRequest(getGenres, "genres:list");
  const genres = list.data;
  const keys = genres ? genres.map(genre => genre.key) : [];
  // Each genre carries its tag id when the list sends one; otherwise the ids are looked up once, by name.
  const missing = Boolean(genres?.length) && genres.some(genre => genre.id == null);
  const ids = useRequest(() => getGenreIds(keys), `genres:ids:${keys.join(",")}`, missing);
  const byKey = Object.fromEntries((genres || []).map(genre => [genre.key, genre]));
  // A subject as the reader's own figures name it (the genre's key, or its label in any case): the genre's label exactly
  // as written, or null when it isn't a genre.
  const labelOf = useCallback(name => { const wanted = plain(name); return (wanted && (genres || []).find(genre => plain(genre.key) === wanted || plain(genre.label) === wanted)?.label) || null; }, [genres]);
  return {
    genres, byKey, loading: list.loading, failed: Boolean(list.error), retry: list.retry,
    // The label for a key, or null when the key isn't a genre (a mood, a theme, anything unknown): callers hide it.
    labelFor: key => byKey[key]?.label ?? null,
    labelOf,
    // The tag id behind a key, for the two places the API still takes ids; null until it is known.
    idFor: key => byKey[key]?.id ?? ids.data?.[key] ?? null,
    idsReady: Boolean(genres?.length) && (!missing || (Boolean(ids.data) && !ids.error)),
  };
}
