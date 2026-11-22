import { localToday } from "../reading/localToday.js";
export { shortDate } from "../reading/home/homeLogic.js";

// Six colours for a club's rule. The server keeps the value as text (up to 12 characters).
export const CLUB_COLORS = [
  ["#3f6b52", "Green"], ["#9c432d", "Rust"], ["#6b3f5e", "Plum"], ["#3d5a80", "Blue"], ["#a8812a", "Ochre"], ["#5b6770", "Slate"],
];
export const clubColor = club => club?.color || CLUB_COLORS[0][0];

export const members = n => `${n} ${n === 1 ? "member" : "members"}`;

// "p. 240" for a page checkpoint, "40%" for a percent one.
export const positionLabel = (unit, value) => (unit === "pages" ? `p. ${value}` : `${value}%`);

// How far a reader is, as the club book sees it: { unit, value } from the members list, turned into a page number and a 0 to 1 share.
export function pageOf(progress, pageCount) {
  if (!progress || progress.unit == null || progress.value == null) return null;
  if (progress.unit === "pages") return progress.value;
  return pageCount ? Math.round(progress.value * pageCount / 100) : null;
}
export function shareOf(progress, pageCount) {
  if (!progress || progress.unit == null || progress.value == null) return null;
  const share = progress.unit === "percent" ? progress.value / 100 : pageCount ? progress.value / pageCount : null;
  return share == null ? null : Math.max(0, Math.min(1, share));
}
export function checkpointShare(checkpoint, pageCount) {
  const share = checkpoint.unit === "percent" ? checkpoint.value / 100 : pageCount ? checkpoint.value / pageCount : null;
  return share == null ? null : Math.max(0, Math.min(1, share));
}

// The next checkpoint: the first one still ahead by date, else the first one the reader has not reached.
export function nextCheckpoint(book, myPage, today = localToday()) {
  const list = book?.checkpoints || [];
  const byDate = list.find(point => point.due_on && point.due_on >= today);
  if (byDate) return byDate;
  return list.find(point => point.unit === "pages" && myPage != null && point.value > myPage) || null;
}

const units = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
const relative = typeof Intl !== "undefined" && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;
// "2 days ago", from a timestamp.
export function ago(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (!relative || Number.isNaN(then)) return "";
  const seconds = Math.round((then - now) / 1000);
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return relative.format(seconds, "second");
}

// The server sends author names as plain text; the book components take { name }.
export const named = authors => (authors || []).map(author => (typeof author === "string" ? { name: author } : author));

export const initialOf = name => (String(name || "").trim()[0] || "?").toUpperCase();

// A server refusal's code, when it sent one.
export const codeOf = error => error?.detail?.code || "";
