// Plain-language helpers for "Your reading life". No arrows, no red: differences are sentences.
export const num = value => Number(value).toLocaleString("en-US");
const plural = (count, one, many) => count === 1 ? one : many;

// The years offered in the switcher: T42's years_with_reading when it exists, otherwise the current year alone.
export function yearsOf(stats) {
  const given = Array.isArray(stats?.years_with_reading) ? stats.years_with_reading.filter(Number.isInteger) : [];
  const years = [...new Set([...given, stats?.year].filter(Number.isInteger))].sort((a, b) => a - b);
  return years;
}

// "2023 and 2024 include your import" (a year can mix imported and native finishes) (only when the data names imported years).
export function importNote(stats, years) {
  const imported = (Array.isArray(stats?.imported_years) ? stats.imported_years : []).filter(year => years.includes(year)).sort((a, b) => a - b);
  if (!imported.length) return "";
  const text = imported.length === 1 ? String(imported[0]) : `${imported.slice(0, -1).join(", ")} and ${imported.at(-1)}`;
  return `${text} ${imported.length === 1 ? "includes" : "include"} your import`;
}

export const hasData = figures => Boolean(figures && (figures.books > 0 || figures.pages > 0));

// Compared with the previous year, as short sentences. Anything equal or unknown is left out.
export function comparison(stats, genreLabel) {
  const now = { books: stats.books_finished ?? stats.books, pages: stats.pages ?? stats.pages_read, days: stats.median_days }, before = stats.previous;
  if (!hasData(before)) return [];
  const lines = [], books = now.books - before.books, pages = now.pages - before.pages;
  if (books) lines.push(`${num(Math.abs(books))} ${books > 0 ? "more" : "fewer"} ${plural(Math.abs(books), "book", "books")} than ${stats.year - 1}`);
  else lines.push(`The same number of books as ${stats.year - 1}`);
  if (pages) lines.push(`${num(Math.abs(pages))} ${pages > 0 ? "more" : "fewer"} pages`);
  if (now.days != null && before.median_days != null && now.days !== before.median_days) {
    const days = Math.abs(now.days - before.median_days);
    lines.push(`Books took about ${days} ${plural(days, "day", "days")} ${now.days < before.median_days ? "less" : "more"}`);
  }
  const top = stats.top_subjects?.[0], earlier = new Map((before.top_subjects || []).map(item => [item.name, item.count]));
  // The genre's name as written; a subject that isn't a genre gets no line.
  const label = top ? genreLabel(top.name) : null;
  if (label && (earlier.get(top.name) ?? 0) < top.count) lines.push(`More ${label}`);
  return lines;
}

export function savedOn(iso) {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
}
