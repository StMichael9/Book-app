import { apiRequest, refreshSession, withSessionChange } from "./client.js";

export { refreshSession };

export function registerUser(credentials) {
  return apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials),
    skipRefresh: true,
  });
}

export function loginUser(credentials) {
  return withSessionChange(() => apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
    skipRefresh: true,
  }));
}

export function logoutUser() {
  return withSessionChange(() => apiRequest("/auth/logout", {
    method: "POST",
    skipRefresh: true,
  }));
}

export function requestPasswordReset(email) {
  return apiRequest("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
    skipRefresh: true,
  });
}

export function resetPassword(token, password) {
  return withSessionChange(async () => {
    const result = await apiRequest("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
      skipRefresh: true,
    });
    window.dispatchEvent(new Event("bookvane:session-expired"));
    return result;
  });
}
