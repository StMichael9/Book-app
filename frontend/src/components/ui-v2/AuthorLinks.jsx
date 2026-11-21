import { Fragment } from "react";
import { Link } from "react-router-dom";
import "../../styles/ui-v2/author-links.css";

// Every author name, each its own link to /author/:id when it has an id, comma-separated. A name with no id stays plain text.
// Give `authors` ([{id, name}] or plain names) or `names` with a parallel `ids`. `primary` underlines the names at rest (the book page header).
// Put it beside a card's book link, never inside one: it makes anchors, and anchors don't nest.
const isId = value => Number.isSafeInteger(value) && value > 0;

export default function AuthorLinks({ authors, names, ids, primary = false, empty = "Author not listed" }) {
  const list = (authors ? authors.map(author => typeof author === "string" ? { name: author } : author) : (names || []).map((name, index) => ({ name, id: ids?.[index] })))
    .filter(author => author && typeof author.name === "string" && author.name.trim());
  if (!list.length) return empty;
  return list.map((author, index) => <Fragment key={`${author.id ?? "n"}-${index}`}>{index > 0 && ", "}
    {isId(author.id)
      ? <Link className={`bv-author-link${primary ? " is-primary" : ""}`} to={`/author/${author.id}`} onClick={event => event.stopPropagation()}>{author.name}</Link>
      : author.name}</Fragment>);
}
