import { apiRequest } from "./client.js";

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
  return apiRequest("/auth/refresh", {
    method: "POST",
    skipRefresh: true,
  });
}

export function logoutUser() {
  return apiRequest("/auth/logout", {
    method: "POST",
    skipRefresh: true,
  });
}