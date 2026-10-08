import { safeReturnTo, validBookId } from "./data.js";

const STORAGE_KEY = "bookvane-recovery-intent";
const LIFETIME = 30 * 60 * 1000;

export function accountIntent(params) {
  const returnTo = safeReturnTo(params.get("returnTo"));
  const id = validBookId(params.get("bookId"));
  const status = params.get("save");
  const intent = id && ["want", "owned"].includes(status) &&
    new URL(returnTo, window.location.origin).pathname === `/book/${id}` ? { id, status } : null;
  return { returnTo, intent };
}

// Carry only validated navigation context, never reset tokens or credentials.
export function accountQuery(params) {
  const { returnTo, intent } = accountIntent(params);
  const query = new URLSearchParams();
  if (params.has("returnTo") || intent) query.set("returnTo", returnTo);
  if (intent) {
    query.set("bookId", String(intent.id));
    query.set("save", intent.status);
  }
  return query;
}

export function clearRecoveryIntent(bookId) {
  try {
    if (bookId) {
      const record = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      if (!record || accountIntent(new URLSearchParams(record.query)).intent?.id !== bookId) return;
    }
    sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* Recovery also works without optional tab storage. */ }
}

export function rememberRecoveryIntent(params) {
  if (!accountIntent(params).intent) { clearRecoveryIntent(); return; }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      query: accountQuery(params).toString(), expiresAt: Date.now() + LIFETIME,
    }));
  } catch { /* The same-page query still preserves the intent. */ }
}

export function recoveryQuery(params) {
  if (["returnTo", "bookId", "save"].some((key) => params.has(key))) return accountQuery(params);
  try {
    const record = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (typeof record?.query === "string" && Number.isFinite(record.expiresAt) && record.expiresAt > Date.now()) {
      const query = new URLSearchParams(record.query);
      if (accountIntent(query).intent) return accountQuery(query);
    }
  } catch { /* A fragment-only reset link can still be used normally. */ }
  return new URLSearchParams();
}

export function accountPath(path, query) {
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}
