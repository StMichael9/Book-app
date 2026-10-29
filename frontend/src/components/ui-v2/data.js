import { useEffect, useEffectEvent, useState } from "react";
import { apiRequest } from "../../api/client.js";
import { getBookById } from "../../api/books.js";
import { prefetchWhenIdle } from "../../api/prefetchQueue.js";
import { prefetchRequest, readRequestCache, sharedRequest } from "../../api/requestCache.js";

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

export function englishTitle(book) {
  const english = typeof book?.english_title === "string" ? book.english_title.trim() : "";
  if (!english) return null;
  return english.toLowerCase() === (book.title || "").trim().toLowerCase() ? null : english;
}

export function formatYear(year) {
  return Number.isInteger(year) && year < 0 ? `${-year} BCE` : String(year);
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
  if (typeof error?.detail?.message === "string") return error.detail.message;
  return fallback;
}

// Old requests may finish, but may never replace the current screen's data.
// Stale-while-revalidate: an answer seen before (this tab, this session) is shown at once and the request still runs,
// so revisits and Back never start from an empty page. The store is memory only; see api/requestCache.js.
export function useRequest(load, key, enabled = true) {
  const loadCurrent = useEffectEvent(load);
  const [attempt, setAttempt] = useState(0);
  const token = `${key}:${attempt}`;
  const [state, setState] = useState({ token: null, data: null, error: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    // Shares the request with any prefetch already under way for this key; a failed request is forgotten, so retry asks again.
    sharedRequest(key, () => loadCurrent()).then(
      (data) => { if (active) setState({ token, data, error: null }); },
      (error) => { if (active) setState({ token, data: null, error }); },
    );
    return () => { active = false; };
  }, [token, enabled, key]);
  const current = state.token === token;
  const stale = current ? null : readRequestCache(key);
  return {
    data: current ? state.data : stale?.data ?? null,
    loading: enabled ? !(current || stale) : !stale,
    error: current ? state.error : null,
    retry: () => setAttempt((value) => value + 1),
  };
}

// Starts the book request ahead of a click; the book page finds the answer in the cache under the same key.
export const prefetchBook = id => prefetchRequest(`book:${id}`, () => getBookById(id));
// A card in view: fetched when the browser is idle, a few at a time (see api/prefetchQueue.js).
export const queueBook = id => prefetchWhenIdle(`book:${id}`, () => getBookById(id));

// The card fields a book page can draw before its own request returns.
export function bookSummary(book) {
  return { id: book.id, title: book.title, subtitle: book.subtitle ?? null, authors: book.authors || [], cover_image_url: book.cover_image_url ?? null,
    published_year: book.published_year ?? null, page_count: book.page_count ?? null, english_title: book.english_title ?? null };
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
    const query = new URLSearchParams();
    SUBJECTS.forEach(([slug]) => query.append("name", slug));
    subjectOptionsPromise = apiRequest(`/autocomplete/tags/batch?${query}`).then((tags) => {
      if (!Array.isArray(tags)) throw new Error("Unable to load subjects.");
      return SUBJECTS.map(([slug]) => tags.find(tag => tag.name === slug)).filter(Boolean);
    }).catch((error) => {
      subjectOptionsPromise = null;
      throw error;
    });
  }
  return subjectOptionsPromise;
}

// Names the browser tab after the book once it is known; routes set a generic title first.
export function useDocumentTitle(title) {
  useEffect(() => { if (title) document.title = `${title} · Bookvane`; }, [title]);
}

// Covered books with plain English-alphabet titles first, then the rest in catalogue order.
const plainTitle = title => Boolean(title) && /^[ -~\u2018\u2019\u201C\u201D\u2013\u2014]+$/.test(title);
// Stable first-impression order: covered books with plain titles first, then the rest in catalogue order.
export function firstImpressionOrder(items) {
  const rank = book => (book.cover_image_url ? 0 : 2) + (plainTitle(book.title) ? 0 : 1);
  return items.map((book, index) => ({ book, index })).sort((a, b) => rank(a.book) - rank(b.book) || a.index - b.index).map(({ book }) => book);
}
