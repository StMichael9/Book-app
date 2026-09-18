import { apiRequest } from "./client.js";

const PUBLIC_CACHE_TTL = 45_000;
const publicResponseCache = new Map();
const inFlightRequests = new Map();

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

  if (requestParams.book) searchParams.set("book", requestParams.book);
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
      console.log("CACHE HIT", requestKey);
      return Promise.resolve(cached.value);
    }
    if (cached) publicResponseCache.delete(path);
  }

  const existingRequest = inFlightRequests.get(requestKey);
  if (existingRequest) {
    console.log("IN FLIGHT HIT", requestKey);
    return existingRequest;
  }

  console.log("NETWORK REQUEST", requestKey);
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

export async function getBookById(id) {
  return apiRequest(`/books/${id}`);
}
