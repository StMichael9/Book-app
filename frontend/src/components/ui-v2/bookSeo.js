import { useEffect } from "react";
import { coverSrc } from "../../api/coverUrl.js";

const SITE = "https://bookvane.me";
const LD_ID = "bv-book-ld";

const names = book => (book.authors || []).map(author => author?.name).filter(Boolean);

// The first sentence-ish ~155 characters of the stored Open Library text, cut at a word and never mid-entity.
function summary(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= 155) return clean;
  const cut = clean.slice(0, 155), space = cut.lastIndexOf(" ");
  return `${(space > 100 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

// What search engines and link previews read for a book. `description` is only ever the stored Open Library text on the
// book record (never the Google Books text the page may show), with a plain fallback built from the facts we hold.
export function bookSeo(book) {
  const authors = names(book), by = authors.length ? ` by ${authors.join(", ")}` : "";
  const year = book.published_year != null && book.published_year > 0 ? `, ${book.published_year}` : "";
  const stored = summary(book.description);
  const description = stored || `${book.title}${by}${year}. Save it, track it and find what to read next on Bookvane.`;
  const image = book.cover_image_url ? new URL(coverSrc(book.cover_image_url, "large"), SITE).href : null;
  const url = `${SITE}/book/${book.id}`;
  const ld = { "@context": "https://schema.org", "@type": "Book", name: book.title, url,
    ...(authors.length ? { author: authors.map(name => ({ "@type": "Person", name })) } : {}),
    ...(image ? { image } : {}), ...(book.isbn13 ? { isbn: book.isbn13 } : {}),
    ...(book.page_count > 0 ? { numberOfPages: book.page_count } : {}),
    ...(book.published_year != null && book.published_year > 0 ? { datePublished: String(book.published_year) } : {}),
    ...(book.language ? { inLanguage: book.language } : {}) };
  return { title: `${book.title}${by} · Bookvane`, description, image, ld };
}

function setMeta(attribute, key, content) {
  let node = document.head.querySelector(`meta[${attribute}="${key}"]`);
  const created = !node;
  if (!node) { node = document.createElement("meta"); node.setAttribute(attribute, key); document.head.appendChild(node); }
  const previous = node.getAttribute("content");
  if (content == null) node.removeAttribute("content"); else node.setAttribute("content", content);
  return () => { if (created) node.remove(); else if (previous == null) node.removeAttribute("content"); else node.setAttribute("content", previous); };
}

// While a book's page is open the document describes that book; leaving it puts the defaults back.
export function useBookSeo(book) {
  const id = book?.id, title = book?.title, description = book?.description, image = book?.cover_image_url, year = book?.published_year,
    pages = book?.page_count, isbn = book?.isbn13, language = book?.language, authorKey = names(book || {}).join("\u0000");
  useEffect(() => {
    if (id == null || !title) return undefined;
    const seo = bookSeo({ id, title, description, cover_image_url: image, published_year: year, page_count: pages, isbn13: isbn, language, authors: authorKey ? authorKey.split("\u0000").map(name => ({ name })) : [] });
    const previousTitle = document.title;
    document.title = seo.title;
    const undo = [setMeta("name", "description", seo.description), setMeta("property", "og:title", seo.title), setMeta("property", "og:description", seo.description),
      setMeta("property", "og:type", "book"), ...(seo.image ? [setMeta("property", "og:image", seo.image)] : [])];
    const script = document.createElement("script");
    script.type = "application/ld+json"; script.id = LD_ID; script.textContent = JSON.stringify(seo.ld);
    document.head.appendChild(script);
    return () => { document.title = previousTitle; undo.forEach(restore => restore()); script.remove(); };
  }, [id, title, description, image, year, pages, isbn, language, authorKey]);
}
