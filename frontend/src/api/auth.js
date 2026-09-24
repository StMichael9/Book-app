import { apiRequest } from "./client.js";

let initialRefreshPromise = null;

export function registerUser(credentials) {
  return apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials),
    skipRefresh: true,
  });
}

export function loginUser(credentials) {
  return apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
    skipRefresh: true,
  });
}

export function refreshSession() {
  if (!initialRefreshPromise) {
    initialRefreshPromise = apiRequest("/auth/refresh", {
      method: "POST",
      skipRefresh: true,
    }).finally(() => {
      initialRefreshPromise = null;
    });
  }
  return initialRefreshPromise;
}

export function logoutUser() {
  return apiRequest("/auth/logout", {
    method: "POST",
    skipRefresh: true,
  });
}

export function requestPasswordReset(email) {
  return apiRequest("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
    skipRefresh: true,
  });
}

export function resetPassword(token, password) {
  return apiRequest("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
    skipRefresh: true,
  });
}
