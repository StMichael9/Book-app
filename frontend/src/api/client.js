const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;

const DEFAULT_API_BASE_URL = isDev
  ? "http://localhost:8000"
  : "https://book-app-8bn6.onrender.com";

export const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) ||
  DEFAULT_API_BASE_URL;

let refreshPromise = null;

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    }).finally(() => {
      refreshPromise = null;
    });
  }

  const response = await refreshPromise;
  if (!response.ok) return false;
  return true;
}

export async function apiRequest(path, options = {}) {
  const { skipRefresh = false, ...requestOptions } = options;
  const url = `${API_BASE_URL}${path}`;

  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(requestOptions.headers || {}),
    },
    ...requestOptions,
  });

  if (response.status === 401 && !skipRefresh && path !== "/auth/refresh") {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiRequest(path, { ...requestOptions, skipRefresh: true });
    }
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errorPayload = await response.json();
      detail = errorPayload?.detail || "";
    } catch {
      detail = "";
    }

    const error = new Error(detail || `Request failed (${response.status})`);
    error.status = response.status;
    error.detail = detail;
    throw error;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
