import { API_BASE_URL, apiRequest } from "./client.js";

const PUBLIC_CACHE_TTL = 45_000;
const publicResponseCache = new Map();
const inFlightRequests = new Map();
const bookDetailsCache = new Map();
const bookDetailsInFlight = new Map();
const MAX_BOOK_DETAILS = 64;

export function getBooks(params = {}) {
  const { cacheScope = "public", ...requestParams } = params;
  const searchParams = new URLSearchParams();
  const tagValues = Array.isArray(requestParams.tag)
    ? requestParams.tag
    : Array.isArray(requestParams.tags)
      ? requestParams.tags
      : requestParams.tag
        ? [requestParams.tag]
        : [];

  // A shared ?q= link searches by title: the server only knows book= (T45 normalises it).
  const bookQuery = requestParams.book || requestParams.q;
  if (bookQuery) searchParams.set("book", bookQuery);
  if (requestParams.sort === "popular") searchParams.set("sort", "popular");
  if (requestParams.author) searchParams.set("author", requestParams.author);
  tagValues.forEach((tag) => searchParams.append("tag", tag));
  if (requestParams.page) searchParams.set("page", String(requestParams.page));
  if (requestParams.size) searchParams.set("size", String(requestParams.size));
  if (requestParams.exclude_owned === true) {
    searchParams.set("exclude_owned", "true");
  }
  if (
    requestParams.shelf_status === "owned" ||
    requestParams.shelf_status === "want"
  ) {
    searchParams.set("shelf_status", requestParams.shelf_status);
  }

  const query = searchParams.toString();
  const path = query ? `/books?${query}` : "/books";
  const requestKey = `${cacheScope}:${path}`;
  const now = Date.now();

  if (cacheScope === "public") {
    const cached = publicResponseCache.get(path);
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.value);
    }
    if (cached) publicResponseCache.delete(path);
  }

  const existingRequest = inFlightRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = apiRequest(path)
    .then((payload) => {
      if (cacheScope === "public") {
        publicResponseCache.set(path, {
          value: payload,
          expiresAt: Date.now() + PUBLIC_CACHE_TTL,
        });
      }
      return payload;
    })
    .finally(() => {
      if (inFlightRequests.get(requestKey) === request) {
        inFlightRequests.delete(requestKey);
      }
    });

  inFlightRequests.set(requestKey, request);
  return request;
}

export function getBookById(id) {
  // Only the public catalogue response belongs here. Owner reading, flags,
  // notes and history keep their existing session-scoped request paths.
  const key = `${API_BASE_URL}:${id}`;
  const cached = bookDetailsCache.get(key);
  if (cached?.expiresAt > Date.now()) {
    bookDetailsCache.delete(key);
    bookDetailsCache.set(key, cached);
    return Promise.resolve(cached.value);
  }
  bookDetailsCache.delete(key);
  if (bookDetailsInFlight.has(key)) return bookDetailsInFlight.get(key);
  const request = apiRequest(`/books/${id}`).then(payload => {
    if (!payload || !Number.isSafeInteger(payload.id)) throw new Error("Invalid catalogue response.");
    const value = Object.fromEntries(["id", "title", "subtitle", "description", "published_year",
      "cover_image_url", "page_count", "isbn13", "english_title", "authors", "tags", "owned_count", "want_count"]
      .filter(field => Object.hasOwn(payload, field)).map(field => [field, payload[field]]));
    bookDetailsCache.set(key, { value, expiresAt: Date.now() + PUBLIC_CACHE_TTL });
    while (bookDetailsCache.size > MAX_BOOK_DETAILS) bookDetailsCache.delete(bookDetailsCache.keys().next().value);
    return value;
  }).finally(() => {
    if (bookDetailsInFlight.get(key) === request) bookDetailsInFlight.delete(key);
  });
  bookDetailsInFlight.set(key, request);
  return request;
}

// The answer from "more books": cards like the catalogue's, with a work_key where ours have an id. It never blocks the
// catalogue results: a slow or failed answer is simply nothing (the server returns [] on its own failures too).
export const MORE_BOOKS_TIMEOUT_MS = 1500;
export async function getMoreBooks({ book = "", author = "", q = "" } = {}) {
  const params = new URLSearchParams();
  if (book || q) params.set("book", book || q);
  if (author) params.set("author", author);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MORE_BOOKS_TIMEOUT_MS);
  try {
    const payload = await apiRequest(`/books/more?${params}`, { signal: controller.signal });
    const list = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    return list.filter(item => item && typeof item.work_key === "string" && typeof item.title === "string")
      .map(item => ({ ...item, cover_image_url: item.cover_image_url ?? item.cover_url ?? null }));
  } catch { return []; } finally { clearTimeout(timer); }
}

// Makes a "more books" card a real book in the catalogue; resolves to its id.
export async function resolveWork(workKey) {
  const result = await apiRequest("/books/resolve", { method: "POST", body: JSON.stringify({ work_key: workKey }) });
  if (!Number.isSafeInteger(result?.id)) throw new Error("Invalid catalogue response.");
  return result.id;
}
