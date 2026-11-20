import { updateReadingAttempt } from "../../api/reading.js";
import { formatDay } from "./readingDates.js";

// The one place that knows how a reading's notes are stored. Today a reading keeps a single `attempt.note`, and paragraphs are
// separated by a blank line. When per-note storage lands (attempt.notes, with POST/PATCH/DELETE endpoints) only this file changes:
// the cards render from notesOf() and save through addNote / editNote / removeNote.

// Notes in the order written, oldest first: {id, text, written_at, progress_unit, progress_value}. The id is the paragraph's place for now.
export function notesOf(attempt) {
  return String(attempt?.note || "").split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
    .map((text, index) => ({ id: index, text, written_at: null, progress_unit: null, progress_value: null }));
}

// The optional "date · page" line above a card. It exists only when a date or a page was stored with the note; otherwise null,
// so no line and no empty space is drawn.
export function noteMeta(note) {
  const day = note.written_at ? formatDay(note.written_at) : "";
  const page = note.progress_value != null ? (note.progress_unit === "percent" ? `${note.progress_value}%` : `page ${note.progress_value}`) : "";
  return [day, page].filter(Boolean).join(" · ") || null;
}

const join = texts => (texts.length ? texts.join("\n\n") : null);
const send = (attempt, version, texts) => updateReadingAttempt(attempt.id, { expected_version: version, note: join(texts) });

export const addNote = (attempt, version, text) => send(attempt, version, [...notesOf(attempt).map(note => note.text), text.trim()]);
export const removeNote = (attempt, version, id) => send(attempt, version, notesOf(attempt).filter(note => note.id !== id).map(note => note.text));
// Saving an emptied note removes it.
export const editNote = (attempt, version, id, text) => text.trim()
  ? send(attempt, version, notesOf(attempt).map(note => note.id === id ? text.trim() : note.text))
  : removeNote(attempt, version, id);
