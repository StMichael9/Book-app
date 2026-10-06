const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;

const DEFAULT_API_BASE_URL = isDev
  ? "http://localhost:8000"
  : "https://book-app-8bn6.onrender.com";

export const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) ||
  DEFAULT_API_BASE_URL;

let refreshPromise = null;
let sessionChanges = 0;

export function refreshSession() {
  if (!refreshPromise) {
    // Allow Render's free-service wake-up, but never hold the account check
    // forever. Keep one in-flight rotation so retry/login cannot race cookies.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 90_000);
    refreshPromise = apiRequest("/auth/refresh", {
      method: "POST",
      skipRefresh: true,
      signal: controller.signal,
    }).catch(error => {
      if (error.name === "AbortError") throw new Error("The account check timed out. Please try again.");
      throw error;
    }).finally(() => {
      clearTimeout(deadline);
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

// Set the guard before waiting, so an unrelated 401 cannot start another
// rotation between the completed refresh and login/logout's cookie response.
export async function withSessionChange(change) {
  sessionChanges += 1;
  try {
    await refreshPromise?.catch(() => {});
    return await change();
  } finally {
    sessionChanges -= 1;
  }
}

export async function apiRequest(path, options = {}) {
  const { skipRefresh = false, ...requestOptions } = options;
  const url = `${API_BASE_URL}${path}`;

  const response = await fetch(url, {
    credentials: "include",
    headers: {
      ...(requestOptions.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(requestOptions.headers || {}),
    },
    ...requestOptions,
  });

  if (response.status === 401 && !skipRefresh && path !== "/auth/refresh" && sessionChanges === 0) {
    let refreshed = false;
    try {
      await refreshSession();
      refreshed = true;
    } catch (error) {
      // A network outage does not prove a session is invalid. Preserve the
      // account state and let the failed operation show its existing retry UI.
      if (error.status !== 401) throw error;
      window.dispatchEvent(new Event("bookvane:session-expired"));
    }
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
