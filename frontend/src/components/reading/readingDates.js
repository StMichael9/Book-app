// One date format on the reading page: "13 Nov 2026", or "13 Nov" in the journal for the current year.
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

export function formatDay(value, { journal = false, now = new Date() } = {}) {
  const day = typeof value === "string" ? value.slice(0, 10) : "";
  if (!isoDay.test(day)) return "";
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-GB", journal && sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}
