import { Fragment } from "react";
import { Link } from "react-router-dom";
import "../../styles/ui-v2/author-links.css";

// Every author name, each its own link to /author/:id when it has an id, comma-separated. A name with no id stays plain text.
// Give `authors` ([{id, name}] or plain names) or `names` with a parallel `ids`. `primary` underlines the names at rest (the book page header).
// Put it beside a card's book link, never inside one: it makes anchors, and anchors don't nest.
const isId = value => Number.isSafeInteger(value) && value > 0;
const words = name => name.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// Each author once. Names that match ignoring case, spaces and punctuation are one author: the first is kept, or the first
// with an id. A short form ("J Joyce", "J. Joyce") goes when a full name with the same surname and first initial is listed.
function uniqueAuthors(list) {
  const kept = new Map();
  for (const author of list) {
    const key = words(author.name).join("");
    if (!kept.has(key)) kept.set(key, author);
    else if (!isId(kept.get(key).id) && isId(author.id)) kept.set(key, author);
  }
  const unique = [...kept.values()];
  const full = unique.map(author => words(author.name)).filter(parts => parts.length > 1 && parts[0].length > 1);
  return unique.filter(author => {
    const parts = words(author.name);
    if (parts.length < 2 || parts[0].length !== 1) return true;
    return !full.some(other => other[0][0] === parts[0] && other.at(-1) === parts.at(-1));
  });
}

export default function AuthorLinks({ authors, names, ids, primary = false, empty = "Author not listed" }) {
  const list = uniqueAuthors((authors ? authors.map(author => typeof author === "string" ? { name: author } : author) : (names || []).map((name, index) => ({ name, id: ids?.[index] })))
    .filter(author => author && typeof author.name === "string" && author.name.trim()));
  if (!list.length) return empty;
  return list.map((author, index) => <Fragment key={`${author.id ?? "n"}-${index}`}>{index > 0 && ", "}
    {isId(author.id)
      ? <Link className={`bv-author-link${primary ? " is-primary" : ""}`} to={`/author/${author.id}`} onClick={event => event.stopPropagation()}>{author.name}</Link>
      : author.name}</Fragment>);
}
