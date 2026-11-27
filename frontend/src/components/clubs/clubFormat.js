import { localToday } from "../reading/localToday.js";
import { NOT_SHARING } from "./clubCopy.js";
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
// A member's place as text: "p. 212", or "not sharing".
export function progressText(member, pageCount) {
  if (!member.shares_progress) return NOT_SHARING;
  const page = pageOf(member.progress, pageCount);
  if (page != null) return `p. ${page}`;
  return member.progress?.unit === "percent" ? `${member.progress.value}%` : "";
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

// "Thu 5 Dec" and "November 2026", from a date (YYYY-MM-DD).
const parse = iso => (iso ? new Date(`${iso}T00:00:00`) : null);
export const dayDate = iso => { const date = parse(iso); return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : ""; };
export const monthYear = iso => { const date = parse(iso); return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : ""; };

// The page a checkpoint stands for (a percent checkpoint needs the page count), or null.
export const checkpointPage = (point, pageCount) => (!point ? null : point.unit === "pages" ? point.value : pageCount ? Math.round(point.value * pageCount / 100) : null);

// "Oct 2026", for a book the club read together.
export const monthShort = iso => { const date = parse(iso); return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : ""; };

// Dates as YYYY-MM-DD in the reader's own calendar.
export const isoOf = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const addDays = (iso, days) => { const date = parse(iso); date.setDate(date.getDate() + days); return isoOf(date); };
const daysBetween = (from, to) => Math.round((parse(to) - parse(from)) / 86400000);

// A reading plan split evenly into `parts` parts from `start` to `finish`: the parts ending in checkpoints (pages, or percent when the page count
// is unknown) with a date each, and the last part ending the book on the finish date. Part n of N ends at n/N of the way, in pages and in days.
export function splitPlan({ start, finish, parts, pageCount }) {
  const count = Math.max(1, Math.min(8, Math.floor(parts) || 1)), span = Math.max(0, daysBetween(start, finish));
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1, last = number === count, due = last ? finish : addDays(start, Math.round(span * number / count));
    const value = pageCount ? Math.round(pageCount * number / count) : Math.round(100 * number / count);
    return { number, last, unit: pageCount ? "pages" : "percent", value, due_on: due };
  });
}

// A meeting's moment, in the reader's own locale and timezone: "Thu 5 Dec, 7:00 pm"; its calendar day (YYYY-MM-DD); and the short day for a list card.
export const meetingWhen = iso => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }); };
export const meetingDay = iso => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "" : isoOf(date); };
export const meetingShort = iso => dayDate(meetingDay(iso));

// The code as typed: capitals, with spaces and dashes ignored. Other characters are not turned away here; the server answers 404 for a code that is not one.
export const cleanCode = text => String(text ?? "").toUpperCase().replace(/[\s-]/g, "");

// The join page a decoded QR code points to: https://bookvane.me/c/{token}, or /c/{token} on this site. Anything else is null.
export function inviteTokenOf(text, origin = typeof window === "undefined" ? "https://bookvane.me" : window.location.origin) {
  try {
    const url = new URL(String(text), origin);
    if (!["https://bookvane.me", origin].includes(url.origin)) return null;
    return /^\/c\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1] || null;
  } catch { return null; }
}
