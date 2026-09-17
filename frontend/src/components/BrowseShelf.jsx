import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { getBooks } from "../api/books.js";
import BookCard from "./BookCard.jsx";

const SHELF_SIZE = 6;

function getBrowseHref(tags) {
  const searchParams = new URLSearchParams();
  searchParams.set("view", "all");
  tags.forEach((tag) => searchParams.append("tag", tag));
  return `/browse?${searchParams.toString()}`;
}

function mergeBooks(payloads) {
  const booksById = new Map();
  payloads.forEach((payload) => {
    (Array.isArray(payload?.items) ? payload.items : []).forEach((book) => {
      if (!booksById.has(book.id)) booksById.set(book.id, book);
    });
  });
  return Array.from(booksById.values()).slice(0, SHELF_SIZE);
}

export default function BrowseShelf({ shelf }) {
  const [books, setBooks] = useState([]);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let ignore = false;

    const loadShelf = async () => {
      setState("loading");

      const results = await Promise.allSettled(
        (shelf.requestTags ?? shelf.tags).map((tag) =>
          getBooks({ tag, page: 1, size: SHELF_SIZE }),
        ),
      );
      const successfulPayloads = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);

      if (!ignore) {
        if (successfulPayloads.length === 0) {
          setBooks([]);
          setState("error");
        } else {
          setBooks(mergeBooks(successfulPayloads));
          setState("ready");
        }
      }
    };

    loadShelf();

    return () => {
      ignore = true;
    };
  }, [shelf]);

  return (
    <section className="browse-shelf" aria-labelledby={`${shelf.id}-title`}>
      <div className="browse-shelf__header">
        <div>
          <p className="eyebrow">A shelf for browsing</p>
          <h2 id={`${shelf.id}-title`}>{shelf.title}</h2>
          <p className="browse-shelf__description">{shelf.description}</p>
        </div>
        <Link className="browse-shelf__view-all" to={shelf.viewAllHref ?? getBrowseHref(shelf.tags)}>
          <span>{shelf.viewAllLabel ?? "View all"}</span>
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>

      {state === "loading" && (
        <div className="browse-shelf__row browse-shelf__row--loading" aria-label={`Loading ${shelf.title}`}>
          {Array.from({ length: 4 }, (_, index) => (
            <div className="browse-shelf__skeleton" key={index} />
          ))}
        </div>
      )}

      {state === "error" && (
        <p className="browse-shelf__message">This shelf is unavailable right now.</p>
      )}

      {state === "ready" && books.length === 0 && (
        <p className="browse-shelf__message">No books on this shelf yet.</p>
      )}

      {state === "ready" && books.length > 0 && (
        <div className="browse-shelf__row" aria-label={`${shelf.title} books`}>
          {books.map((book) => (
            <div className="browse-shelf__card" key={book.id}>
              <BookCard book={book} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
