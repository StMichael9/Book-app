import { apiRequest } from "./client.js";

export async function getBooks(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.book) searchParams.set("book", params.book);
  if (params.author) searchParams.set("author", params.author);
  if (params.tag) searchParams.set("tag", params.tag);
  if (params.page) searchParams.set("page", String(params.page));
  if (params.size) searchParams.set("size", String(params.size));

  const query = searchParams.toString();
  const path = query ? `/books?${query}` : "/books";
  return apiRequest(path);
}

export async function getBookById(id) {
  return apiRequest(`/books/${id}`);
}
