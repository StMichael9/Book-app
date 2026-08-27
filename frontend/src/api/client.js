const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;

const DEFAULT_API_BASE_URL = isDev
  ? "http://localhost:8000"
  : "https://book-app-8bn6.onrender.com";

export const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) ||
  DEFAULT_API_BASE_URL;

export async function apiRequest(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const message = `Request failed (${response.status})`;
    throw new Error(message);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
