import { useEffect, useMemo, useState } from "react";

import { suggestAuthors, suggestTags } from "../../api/autocomplete.js";
import { useDebounce } from "../../hooks/useDebounce.js";

export default function AutocompleteInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  type,
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const debouncedValue = useDebounce(value, 300);

  useEffect(() => {
    const runLookup = async () => {
      const trimmed = debouncedValue.trim();

      if (!trimmed) {
        setItems([]);
        setOpen(false);
        return;
      }

      setLoading(true);
      try {
        const lookup = type === "author" ? suggestAuthors : suggestTags;
        const result = await lookup(trimmed);
        setItems(Array.isArray(result) ? result : []);
        setOpen(true);
      } catch {
        setItems([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    };

    runLookup();
  }, [debouncedValue, type]);

  const displayItems = useMemo(() => items.slice(0, 6), [items]);

  return (
    <div className="field-group autocomplete-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (value.trim() && displayItems.length) setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        placeholder={placeholder}
      />

      {open && !loading && displayItems.length > 0 ? (
        <div
          className="suggestion-box"
          role="listbox"
          aria-label={`${label} suggestions`}
        >
          {displayItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="suggestion-item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(item.name);
                setOpen(false);
                setItems([]);
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}

      {open && !loading && value.trim() && displayItems.length === 0 ? (
        <div className="suggestion-box suggestion-empty" role="status">
          <span>No matches found.</span>
        </div>
      ) : null}
    </div>
  );
}
