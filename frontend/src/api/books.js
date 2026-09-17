import { apiRequest } from "./client.js";

export async function getBooks(params = {}) {
  const searchParams = new URLSearchParams();
  const tagValues = Array.isArray(params.tag)
    ? params.tag
    : Array.isArray(params.tags)
      ? params.tags
      : params.tag
        ? [params.tag]
        : [];

  if (params.book) searchParams.set("book", params.book);
  if (params.author) searchParams.set("author", params.author);
  tagValues.forEach((tag) => searchParams.append("tag", tag));
  if (params.page) searchParams.set("page", String(params.page));
  if (params.size) searchParams.set("size", String(params.size));
  if (params.exclude_owned === true) searchParams.set("exclude_owned", "true");
  if (params.shelf_status === "owned" || params.shelf_status === "want") {
    searchParams.set("shelf_status", params.shelf_status);
  }

  const query = searchParams.toString();
  const path = query ? `/books?${query}` : "/books";
  return apiRequest(path);
}

export async function getBookById(id) {
  return apiRequest(`/books/${id}`);
}
