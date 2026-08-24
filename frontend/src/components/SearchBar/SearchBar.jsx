import { useMemo, useState } from "react";

import AutocompleteInput from "./AutocompleteInput.jsx";

export default function SearchBar({ onSearch, activeFilters }) {
  const [book, setBook] = useState("");
  const [author, setAuthor] = useState("");
  const [tag, setTag] = useState("");

  const pills = useMemo(
    () =>
      [
        book && `Title: ${book}`,
        author && `Author: ${author}`,
        tag && `Tag: ${tag}`,
      ].filter(Boolean),
    [book, author, tag],
  );

  const handleSubmit = (event) => {
    event.preventDefault();
    onSearch({ book, author, tag });
  };

  const handleReset = () => {
    setBook("");
    setAuthor("");
    setTag("");
    onSearch({ book: "", author: "", tag: "" });
  };

  return (
    <>
      <form
        className="controls-panel"
        onSubmit={handleSubmit}
        aria-label="Book filters"
      >
        <div className="field-group search-field">
          <label htmlFor="book-search">Title</label>
          <input
            id="book-search"
            type="text"
            value={book}
            onChange={(event) => setBook(event.target.value)}
            placeholder="Search by title"
          />
        </div>

        <AutocompleteInput
          id="author-filter"
          label="Author"
          value={author}
          onChange={setAuthor}
          placeholder="Search by author"
          type="author"
        />

        <AutocompleteInput
          id="tag-filter"
          label="Tag"
          value={tag}
          onChange={setTag}
          placeholder="Search by tag"
          type="tag"
        />

        <div className="controls-actions">
          <button type="submit" className="primary-button">
            Search
          </button>
          <button type="button" className="reset-button" onClick={handleReset}>
            Reset
          </button>
        </div>
      </form>

      {pills.length > 0 && (
        <div className="results-header" aria-live="polite">
          <div>
            <p className="eyebrow">Results</p>
            <h3>{activeFilters.total ?? 0} books found</h3>
          </div>

          <div className="filter-pills">
            {pills.map((filter) => (
              <span key={filter} className="filter-pill">
                {filter}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
