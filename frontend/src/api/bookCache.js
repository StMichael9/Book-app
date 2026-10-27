import snapshot from "../data/book-snapshot.json";

// Public /books responses for the landing page and Discover's first page only. Never account, library or reading data.
const PREFIX = "bookvane:books:";
const VERSION = "v1";
const MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_BYTES = 200 * 1024;
const BUILD = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
const PAGE_SIZE = { landing: 30, browse: 20 };

const isId = value => Number.isSafeInteger(value) && value > 0;
const text = value => (typeof value === "string" ? value : null);
const count = value => (Number.isSafeInteger(value) ? value : null);
const key = (scope, view) => `${PREFIX}${VERSION}:${BUILD}:${scope}:${view}`;

function pickBook(book) {
  if (!book || !isId(book.id) || typeof book.title !== "string" || !book.title.trim()) return null;
  return {
    id: book.id, title: book.title, subtitle: text(book.subtitle),
    authors: (Array.isArray(book.authors) ? book.authors : [])
      .filter(author => author && isId(author.id) && typeof author.name === "string").map(author => ({ id: author.id, name: author.name })),
    cover_image_url: text(book.cover_image_url), published_year: count(book.published_year),
    page_count: count(book.page_count), english_title: text(book.english_title),
  };
}

// Only the card fields survive, so nothing else in a response can reach storage.
function sanitize(payload, view) {
  const items = (Array.isArray(payload?.items) ? payload.items : []).map(pickBook).filter(Boolean).slice(0, PAGE_SIZE[view]);
  if (!items.length) return null;
  const total = Number(payload.total);
  return { items, total: Number.isFinite(total) && total >= items.length ? total : items.length, page: 1, size: Number(payload.size) || PAGE_SIZE[view] };
}

export function snapshotFor(view) {
  return sanitize({ items: snapshot.items.slice(0, PAGE_SIZE[view]), total: snapshot.total, size: PAGE_SIZE[view] }, view);
}

export function readBookCache(view, scope) {
  try {
    const name = key(scope, view);
    const entry = JSON.parse(localStorage.getItem(name));
    if (!entry || typeof entry.savedAt !== "number" || Date.now() - entry.savedAt > MAX_AGE || entry.savedAt > Date.now() + 60_000) {
      if (entry) localStorage.removeItem(name);
      return null;
    }
    return sanitize(entry.data, view);
  } catch {
    return null;
  }
}

export function writeBookCache(view, scope, payload) {
  try {
    const data = sanitize(payload, view);
    if (!data) return;
    const value = JSON.stringify({ savedAt: Date.now(), data });
    if (new TextEncoder().encode(value).length > MAX_BYTES) return;
    // Entries from other builds can never be read again, so they should not pile up.
    for (const name of Object.keys(localStorage)) {
      if (name.startsWith(PREFIX) && !name.startsWith(`${PREFIX}${VERSION}:${BUILD}:`)) localStorage.removeItem(name);
    }
    localStorage.setItem(key(scope, view), value);
  } catch {
    // Optional: a full, blocked or disabled store only means a slower next visit.
  }
}

// A bare "was signed in" flag, with no account data. It only lets the landing page decide, before the account check
// returns, whether to paint the public books at once (a guest) or keep waiting (a reader about to be sent Home).
const SESSION_HINT = "bookvane:session-hint:v1";

export function likelySignedIn() {
  try { return localStorage.getItem(SESSION_HINT) === "1"; } catch { return false; }
}

export function rememberSignedIn(signedIn) {
  try {
    if (signedIn) localStorage.setItem(SESSION_HINT, "1");
    else localStorage.removeItem(SESSION_HINT);
  } catch {
    // Optional: without it a returning reader just sees the public books a moment sooner.
  }
}

// With a scope, only that account scope's copies go ("member" when an anonymous start finds no session).
export function clearBookCache(scope = null) {
  try {
    for (const name of Object.keys(localStorage)) {
      if (name.startsWith(PREFIX) && (!scope || name.includes(`:${scope}:`))) localStorage.removeItem(name);
    }
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
