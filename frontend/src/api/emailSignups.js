import { apiRequest } from "./client.js";

export function signUpForUpdates(email) {
  return apiRequest("/email-signups", {
    method: "POST",
    body: JSON.stringify({ email, consent: true }),
    skipRefresh: true,
  });
}
