// Which books have already been asked "why this one?". Per browser, so Skip, Esc or Save never brings it back.
const KEY = "bookvane:why-asked:v1";

function read() {
  try { const value = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(value) ? value : []; } catch { return []; }
}

export const wasAsked = bookId => read().includes(bookId);

export function markAsked(bookId) {
  try { localStorage.setItem(KEY, JSON.stringify([...new Set([...read(), bookId])].slice(-500))); } catch { /* Optional. */ }
}
