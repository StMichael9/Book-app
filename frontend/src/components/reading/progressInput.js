// The progress box takes one thing: a page ("52") or a percent ("35%"). The unit is whatever was typed.

// The progress save will send the reader's local day as `on` once the backend accepts it (T55). Until then the endpoint rejects
// unknown fields, so it stays off. Switch it on here, in this one place.
export const SEND_PROGRESS_DAY = false;

export const UNREADABLE = "Type a page, like 52, or a percent, like 35%.";

export function parseProgress(text) {
  const clean = String(text ?? "").trim();
  const percent = clean.match(/^(\d{1,3})\s*%$/);
  if (percent) return Number(percent[1]) <= 100 ? { unit: "percent", value: Number(percent[1]) } : null;
  const page = clean.match(/^(\d{1,6})$/);
  return page ? { unit: "pages", value: Number(page[1]) } : null;
}

export const percentOf = (progress, total) => progress.unit === "percent" ? progress.value : total ? Math.min(100, Math.round(100 * progress.value / total)) : null;
export const pageOf = (progress, total) => progress.unit === "pages" ? progress.value : total ? Math.round(total * progress.value / 100) : null;
export const isLast = (progress, total) => progress.unit === "percent" ? progress.value >= 100 : Boolean(total) && progress.value >= total;

export function savedLine(progress, total) {
  const percent = percentOf(progress, total), page = pageOf(progress, total);
  return progress.unit === "pages"
    ? `Saved. Page ${progress.value}${percent != null ? `, ${percent}%` : ""}.`
    : `Saved. ${progress.value}%${page != null ? `, about page ${page}` : ""}.`;
}

// The attempt's saved progress, in the unit the reader used.
export function currentProgress(attempt) {
  const value = attempt?.progress_value;
  if (value == null) return null;
  return { unit: attempt.progress_unit === "percent" ? "percent" : "pages", value };
}
