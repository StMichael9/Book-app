// Merging the catalogue's results with the "more books" results into one list, with no trace of where a card came from.
const strip = value => String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export const normalTitle = value => strip(value).replace(/^(the|a|an) /, "");
const firstAuthor = book => {
  const first = Array.isArray(book.authors) ? book.authors[0] : null;
  return strip(typeof first === "string" ? first : first?.name || book.author || "");
};
export const bookKey = book => `${normalTitle(book.title)}|${firstAuthor(book)}`;

// Our results stay exactly where they are. The other results follow them, exact title match first and then the most
// popular, without repeating a book we already show. (With no results of our own the same ranking is the whole list.)
export function mergeResults(ours, more, query = "") {
  const seen = new Set(ours.map(bookKey)), wanted = normalTitle(query);
  const extra = [];
  for (const card of more || []) { const key = bookKey(card); if (!seen.has(key)) { seen.add(key); extra.push(card); } }
  const rank = card => (wanted && normalTitle(card.title) === wanted ? 1 : 0);
  const ordered = extra.map((card, index) => ({ card, index })).sort((a, b) => rank(b.card) - rank(a.card) || (b.card.popularity || 0) - (a.card.popularity || 0) || a.index - b.index);
  return [...ours, ...ordered.map(entry => entry.card)];
}

// With no exact title match among our own results the whole list is ranked once: an exact title first, then the most
// popular. Our own books keep their order ahead of the others unless they carry a popularity of their own.
export function rankAll(ours, more, query = "") {
  const wanted = normalTitle(query), seen = new Set(), all = [];
  for (const card of [...ours, ...(more || [])]) { const key = bookKey(card); if (!seen.has(key)) { seen.add(key); all.push(card); } }
  const score = (card, index) => card.popularity ?? (card.work_key ? 0 : 1e9 - index);
  return all.map((card, index) => ({ card, index })).sort((a, b) =>
    (wanted && normalTitle(b.card.title) === wanted ? 1 : 0) - (wanted && normalTitle(a.card.title) === wanted ? 1 : 0) || score(b.card, b.index) - score(a.card, a.index)).map(entry => entry.card);
}
