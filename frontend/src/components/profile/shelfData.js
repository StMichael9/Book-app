import { AVATAR_COLOURS } from "./avatarData.js";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// A small stable hash, so a spine's height and cloth never change between visits.
export function hash(...parts) {
  let value = 2166136261;
  for (const char of parts.join(":")) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
}
export const clothFor = (...parts) => AVATAR_COLOURS[hash(...parts) % AVATAR_COLOURS.length][2];
// A book wears the same cloth on a list card, a list header and a list row.
export const bookCloth = bookId => clothFor("book", bookId);

// The reading-year chart is shown only once the reader has finished three books this calendar year; under that, nothing at all.
// Home and the profile share this one rule.
export const YEAR_CHART_MINIMUM = 3;
export const hasYearChart = stats => Array.isArray(stats?.by_month) && (stats.books_finished || 0) >= YEAR_CHART_MINIMUM;
