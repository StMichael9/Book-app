import { apiRequest } from "./client.js";

export function getMyBooks(status) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiRequest(`/me/books${query}`);
}

export function setBookStatus(bookId, status) {
  return apiRequest(`/books/${bookId}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export function removeBookStatus(bookId) {
  return apiRequest(`/books/${bookId}/status`, {
    method: "DELETE",
  });
}