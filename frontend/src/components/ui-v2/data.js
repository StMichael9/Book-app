import { useEffect, useEffectEvent, useState } from "react";
import { apiRequest } from "../../api/client.js";

export const SUBJECTS = [
  ["fantasy", "Fantasy"], ["mystery", "Mystery"], ["history", "History"],
  ["romance", "Romance"], ["science_fiction", "Science fiction"],
  ["classics", "Classics"], ["horror", "Horror"], ["thriller", "Thriller"],
  ["adventure", "Adventure"], ["humor", "Humor"], ["biography", "Biography"],
  ["poetry", "Poetry"], ["drama", "Drama"], ["young_adult", "Young adult"],
  ["philosophy", "Philosophy"],
];

export function subjectLabel(name = "") {
  return SUBJECTS.find(([slug]) => slug === name)?.[1] ||
    name.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function authorLabel(book) {
  return book.authors?.map((author) => author.name).filter(Boolean).join(", ") ||
    "Author not listed";
}

export function validBookId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function safeReturnTo(value, fallback = "/my-books") {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin ||
      /^\/(login|register|forgot-password|reset-password)(\/|$)/.test(url.pathname)) return fallback;
  return url.pathname + url.search;
}

export function errorText(error, fallback) {
  if (error?.status === 429) return "Too many requests just now. Please try again shortly.";
  if (error?.status >= 500 || error instanceof TypeError) return fallback;
  if (typeof error?.detail === "string") return error.detail;
  return fallback;
}

// Old requests may finish, but may never replace the current screen's data.
export function useRequest(load, key, enabled = true) {
  const loadCurrent = useEffectEvent(load);
  const [attempt, setAttempt] = useState(0);
  const token = `${key}:${attempt}`;
  const [state, setState] = useState({ token: null, data: null, error: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    Promise.resolve().then(() => loadCurrent()).then(
      (data) => { if (active) setState({ token, data, error: null }); },
      (error) => { if (active) setState({ token, data: null, error }); },
    );
    return () => { active = false; };
  }, [token, enabled]);
  const current = state.token === token;
  return {
    data: current ? state.data : null,
    loading: !enabled || !current,
    error: current ? state.error : null,
    retry: () => setAttempt((value) => value + 1),
  };
}

export function catalogueResponse(payload) {
  if (!Array.isArray(payload?.items) || !Number.isFinite(Number(payload.total))) {
    throw new Error("Invalid catalogue response.");
  }
  return { ...payload, total: Number(payload.total) };
}

let subjectOptionsPromise;
export function loadSubjectOptions() {
  if (!subjectOptionsPromise) {
    subjectOptionsPromise = Promise.all(SUBJECTS.map(async ([slug]) => {
      const results = await apiRequest(`/autocomplete/tags?q=${encodeURIComponent(slug)}`);
      if (!Array.isArray(results)) throw new Error("Unable to load subjects.");
      return results.find((tag) => tag.name === slug);
    })).then((tags) => tags.filter(Boolean)).catch((error) => {
      subjectOptionsPromise = null;
      throw error;
    });
  }
  return subjectOptionsPromise;
}
