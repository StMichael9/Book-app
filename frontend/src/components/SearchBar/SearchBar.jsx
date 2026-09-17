import { useEffect, useMemo, useState } from "react";

import AutocompleteInput from "./AutocompleteInput.jsx";

export default function SearchBar({
  onSearch,
  activeFilters,
  initialFilters,
  excludeOwned,
  shelfStatus,
  onDiscoveryFilterChange,
}) {
  const [book, setBook] = useState("");
  const [author, setAuthor] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    setBook(initialFilters.book);
    setAuthor(initialFilters.author);
    setTags(initialFilters.tags);
  }, [initialFilters]);

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
  const activeFilterCount =
    Number(Boolean(author)) +
    tags.length +
    Number(Boolean(excludeOwned)) +
    Number(Boolean(shelfStatus));

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
    onDiscoveryFilterChange({ excludeOwned: false, shelfStatus: "" });
    onSearch({ book: "", author: "", tags: [] });
  };

  return (
    <>
      <form
        className="discovery-header"
        onSubmit={handleSubmit}
        aria-label="Book discovery"
      >
        <div className="discovery-header__copy">
          <p className="eyebrow">Discover</p>
          <h1>Find your next read.</h1>
          <p>Search by title, author, or the mood you want to live inside.</p>
        </div>

        <div className="discovery-search-row">
          <div className="field-group">
            <label htmlFor="book-search">Search books</label>
            <input
              id="book-search"
              type="text"
              value={book}
              onChange={(event) => setBook(event.target.value)}
              placeholder="Search by title..."
            />
          </div>
          <button type="submit" className="primary-button">
            Search
          </button>
        </div>

        <button
          type="button"
          className="filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="browse-filters-panel"
          onClick={() => setFiltersOpen((current) => !current)}
        >
          <span>
            Filters{activeFilterCount > 0 ? ` · ${activeFilterCount} active` : " (optional)"}
          </span>
          <span aria-hidden="true">{filtersOpen ? "−" : "+"}</span>
        </button>

        {filtersOpen && (
          <div id="browse-filters-panel" className="filters-panel">
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

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={excludeOwned}
                onChange={(event) =>
                  onDiscoveryFilterChange({ excludeOwned: event.target.checked })
                }
              />
              <span>Exclude books I own</span>
            </label>

            <div className="field-group">
              <label htmlFor="shelf-status-filter">Shelf status</label>
              <select
                id="shelf-status-filter"
                value={shelfStatus}
                onChange={(event) =>
                  onDiscoveryFilterChange({ shelfStatus: event.target.value })
                }
              >
                <option value="">Any shelf status</option>
                <option value="owned">Owned</option>
                <option value="want">Want to read</option>
              </select>
            </div>

            <div className="controls-actions">
              <button type="button" className="reset-button" onClick={handleReset}>
                Reset
              </button>
            </div>
          </div>
        )}
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
