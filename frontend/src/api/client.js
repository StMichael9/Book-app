const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;

const DEFAULT_API_BASE_URL = isDev
  ? "http://localhost:8000"
  : "https://book-app-8bn6.onrender.com";

export const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) ||
  DEFAULT_API_BASE_URL;

let refreshPromise = null;
let serviceDown = false;

// The site stays up when the API or its database is down, so tell the shell once per change and
// let it show the calm "trouble on our end" banner. A reader without internet is not our outage.
function setServiceDown(down) {
  if (down === serviceDown) return;
  if (down && typeof navigator !== "undefined" && navigator.onLine === false) return;
  serviceDown = down;
  window.dispatchEvent(new Event(down ? "bookvane:unavailable" : "bookvane:available"));
}

export function isServiceDown() {
  return serviceDown;
}

// Asks the API whether it can reach the database again; the banner calls this while it is shown.
export async function checkService() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });
    setServiceDown(!response.ok);
  } catch {
    setServiceDown(true);
  }
  return !serviceDown;
}
let sessionChanges = 0;
let sessionEpoch = 0;

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
  sessionEpoch += 1;
  sessionChanges += 1;
  try {
    await refreshPromise?.catch(() => {});
    return await change();
  } finally {
    sessionChanges -= 1;
  }
}

export async function apiRequest(path, options = {}) {
  const epoch = sessionEpoch;
  const { skipRefresh = false, responseType, ...requestOptions } = options;
  const url = `${API_BASE_URL}${path}`;

  let response;
  try {
    response = await fetch(url, {
      credentials: "include",
      headers: {
        ...(requestOptions.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(requestOptions.headers || {}),
      },
      ...requestOptions,
    });
  } catch (error) {
    // Render's own 502 page carries no CORS headers, so an outage reaches the browser as a network error.
    if (error.name !== "AbortError") setServiceDown(true);
    throw error;
  }
  setServiceDown([502, 503, 504].includes(response.status));

  if (response.status === 401 && !skipRefresh && path !== "/auth/refresh" && sessionChanges === 0 && epoch === sessionEpoch) {
    let refreshed = false;
    try {
      await refreshSession();
      refreshed = true;
    } catch (error) {
      // A network outage does not prove a session is invalid. Preserve the
      // account state and let the failed operation show its existing retry UI.
      if (error.status !== 401) throw error;
      if (epoch === sessionEpoch && sessionChanges === 0) window.dispatchEvent(new Event("bookvane:session-expired"));
    }
    if (refreshed && epoch === sessionEpoch && sessionChanges === 0) {
      return apiRequest(path, { ...requestOptions, responseType, skipRefresh: true });
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

    const message = typeof detail === "string" ? detail : detail?.message;
    const error = new Error(message || `Request failed (${response.status})`);
    error.status = response.status;
    error.detail = detail;
    throw error;
  }

  if (responseType === "response") return response;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
