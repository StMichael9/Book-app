import { useMemo, useState } from "react";

import AutocompleteInput from "./AutocompleteInput.jsx";

export default function SearchBar({ onSearch, activeFilters }) {
  const [book, setBook] = useState("");
  const [author, setAuthor] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState([]);

  const addTag = (nextTag) => {
    const trimmed = nextTag.trim();
    if (!trimmed) return;

    setTags((current) =>
      current.includes(trimmed) ? current : [...current, trimmed],
    );
    setTagInput("");
  };

  const removeTag = (tagToRemove) => {
    setTags((current) => current.filter((tag) => tag !== tagToRemove));
  };

  const pills = useMemo(
    () =>
      [
        book && `Title: ${book}`,
        author && `Author: ${author}`,
        ...tags.map((tag) => `Tag: ${tag}`),
      ].filter(Boolean),
    [book, author, tags],
  );

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextTags = Array.from(
      new Set([...tags, tagInput.trim()].filter(Boolean)),
    );

    setTags(nextTags);
    setTagInput("");
    onSearch({ book, author, tags: nextTags });
  };

  const handleReset = () => {
    setBook("");
    setAuthor("");
    setTagInput("");
    setTags([]);
    onSearch({ book: "", author: "", tags: [] });
  };

  return (
    <>
      <form
        className="controls-panel"
        onSubmit={handleSubmit}
        aria-label="Book filters"
      >
        <div className="field-group">
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
          value={tagInput}
          onChange={setTagInput}
          onSelect={addTag}
          selectedValues={tags}
          placeholder="Search by tag"
          type="tag"
        />

        {tags.length > 0 && (
          <div className="filter-pills" aria-label="Selected tags">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="filter-pill tag-chip"
                onClick={() => removeTag(tag)}
              >
                {tag} ×
              </button>
            ))}
          </div>
        )}

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
