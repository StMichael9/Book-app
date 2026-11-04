export const HANDLE = /^[a-z0-9-]{3,30}$/;
export const HANDLE_ERROR = "Use 3–30 lowercase letters, numbers or hyphens.";
export const isHandleError = message => /username|lowercase/.test(message || "");

export function saveMessage(error) {
  const code = error?.detail?.code;
  if (code === "handle_taken") return "That username is taken.";
  if (code === "handle_reserved") return "That username isn’t available.";
  if (code?.startsWith("handle_")) return HANDLE_ERROR;
  return "We couldn’t save that. Please try again.";
}
