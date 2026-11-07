import { useSyncExternalStore } from "react";
import { createReadingAttempt, getReadingWorkspace } from "../../../api/reading.js";
import { localToday } from "../localToday.js";

export const MAX_PINS = 5;
export const UP_NEXT_SHOWN = 4;
export const PICKS_PER_TRY = 3;

export function greetingFor(name, now = new Date()) {
  const first = String(name || "").trim().split(/\s+/)[0];
  if (!first) return "Home";
  const hour = now.getHours();
  return `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${first}`;
}

const NARROW = "(max-width: 700px)";
const subscribe = notify => { const query = window.matchMedia(NARROW); query.addEventListener("change", notify); return () => query.removeEventListener("change", notify); };
export const useNarrow = () => useSyncExternalStore(subscribe, () => window.matchMedia(NARROW).matches, () => false);

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
  return { entry_id: entry.id, book_id: entry.book?.id ?? null, title: book.title, authors: (book.authors || []).map(author => author.name).filter(Boolean), cover_url: book.cover_image_url || null, owned: Boolean(entry.is_owned), want: Boolean(entry.is_wanted), page_count: entry.book?.page_count ?? null, label: label(entry) };
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
