import { useSyncExternalStore } from "react";
import { createReadingAttempt, getReadingWorkspace } from "../../../api/reading.js";
import { localToday } from "../localToday.js";

export const MAX_PINS = 5;
// Up next and Can't decide? fill a 5-column row on a desktop; from tablet width down they sit in a 2-column grid, so four (two rows of two).
export const UP_NEXT_SHOWN = 5;
export const UP_NEXT_SHOWN_COMPACT = 4;
export const PICKS_PER_TRY = 5;
export const PICKS_PER_TRY_PHONE = 4;

export function greetingFor(name, now = new Date()) {
  const first = String(name || "").trim().split(/\s+/)[0];
  if (!first) return "Home";
  const hour = now.getHours();
  return `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${first}`;
}

const mediaHook = text => {
  const subscribe = notify => { const query = window.matchMedia(text); query.addEventListener("change", notify); return () => query.removeEventListener("change", notify); };
  return () => useSyncExternalStore(subscribe, () => window.matchMedia(text).matches, () => false);
};
export const useNarrow = mediaHook("(max-width: 700px)");
// From 1100px Home is two columns: Reading now as a list on the left, Up next as a numbered pile on the right.
export const useWide = mediaHook("(min-width: 1100px)");
// At 900px and under Home's book grids drop to two columns.
export const useCompact = mediaHook("(max-width: 900px)");

export const shortDate = iso => {
  const date = iso ? new Date(`${iso}T00:00:00`) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
};

export const progressOf = attempt => {
  const value = attempt?.progress_value;
  if (value == null) return null;
  const percent = attempt.progress_unit === "percent";
  const max = percent ? 100 : attempt.total_pages || null;
  return { value, percent, max, label: percent ? `${value}%` : `Page ${value}${max ? ` of ${max}` : ""}` };
};

// A book is open to starting while it has no reading, finished or stopped state on it.
export const startable = entry => !["reading", "paused", "finished", "dnf"].includes(entry.reading_state);
const bookOf = entry => entry.book || { title: entry.private_title, cover_image_url: entry.private_catalogue?.cover_image_url, authors: entry.private_author ? [{ name: entry.private_author }] : [] };
const label = entry => entry.is_owned ? "Owned" : "Want to read";

// One shape for a card, whether it came from a pin or from the library.
export function cardFromEntry(entry) {
  const book = bookOf(entry);
  return { entry_id: entry.id, book_id: entry.book?.id ?? null, title: book.title, authors: (book.authors || []).map(author => author.name).filter(Boolean), author_ids: (book.authors || []).filter(author => author.name).map(author => author.id ?? null), cover_url: book.cover_image_url || null, owned: Boolean(entry.is_owned), want: Boolean(entry.is_wanted), page_count: entry.book?.page_count ?? null, label: label(entry) };
}
export const cardFromPin = pin => ({ ...pin, authors: pin.authors || [], label: pin.owned ? "Owned" : "Want to read", pinned: true });
export const coverBook = card => ({ title: card.title, cover_image_url: card.cover_url, authors: card.authors.map(name => ({ name })) });

// "Suggested from your shelf": books you own and haven't started first, then Want to read, oldest saved first within each.
export function suggestions(items, count = UP_NEXT_SHOWN) {
  const open = items.filter(entry => startable(entry) && (entry.is_owned || entry.is_wanted)).reverse();
  return [...open.filter(entry => entry.is_owned), ...open.filter(entry => !entry.is_owned)].slice(0, count).map(cardFromEntry);
}

// Starting a book from Home is the same action as everywhere else: a new reading, started today.
export async function startReading(entryId) {
  const workspace = await getReadingWorkspace(entryId);
  if (["reading", "paused"].includes(workspace.current_attempt?.state)) return { entry: workspace.entry };
  return createReadingAttempt(crypto.randomUUID(), { entry_id: entryId, expected_version: workspace.entry.version, started_via: "next_read", started_on: localToday() });
}
