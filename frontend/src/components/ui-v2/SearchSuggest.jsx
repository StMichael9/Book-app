import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getBookSuggestions } from "../../api/suggest.js";
import { BookCover } from "./primitives.jsx";
import { SEARCH_SUGGEST } from "./searchSuggestFlag.js";

const MIN_CHARS = 2, DEBOUNCE_MS = 150, MAX_CACHED = 100;
// Answers for this session, by query; memory only.
const answers = new Map();
const fold = text => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// A suggestion as the rows need it. The API sends the first author; tolerate a name or an object.
function normalize(item) {
  if (!item || !Number.isSafeInteger(item.id) || typeof item.title !== "string" || !item.title.trim()) return null;
  const first = Array.isArray(item.authors) ? item.authors[0] : null;
  const author = typeof first === "string" ? first : typeof first?.name === "string" ? first.name : "";
  return { id: item.id, title: item.title, author: author.trim(), year: Number.isInteger(item.year) ? item.year : null, cover: typeof item.cover_url === "string" ? item.cover_url : null };
}

// The typed letters inside a title, ignoring case and accents: [before, match, after] in the title's own letters.
function splitMatch(title, query) {
  const wanted = fold(query.trim());
  if (!wanted) return [title, "", ""];
  let folded = "";
  const map = [];
  [...title].forEach((character, index) => { for (const piece of fold(character)) { folded += piece; map.push(index); } });
  const at = folded.indexOf(wanted);
  if (at < 0) return [title, "", ""];
  const letters = [...title], start = map[at], end = map[at + wanted.length - 1] + 1;
  return [letters.slice(0, start).join(""), letters.slice(start, end).join(""), letters.slice(end).join("")];
}

// Suggestions for the typed text. An answer is used only while it still belongs to what is in the field.
function useSuggestions(text, enabled) {
  const query = text.trim(), key = fold(query);
  const [state, setState] = useState({ key: "", items: null, failed: false });
  const active = enabled && query.length >= MIN_CHARS;
  useEffect(() => {
    if (!active || answers.has(key)) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getBookSuggestions(query, controller.signal).then(payload => {
        if (controller.signal.aborted) return;
        const items = (Array.isArray(payload) ? payload : []).map(normalize).filter(Boolean).slice(0, 6);
        answers.set(key, items);
        while (answers.size > MAX_CACHED) answers.delete(answers.keys().next().value);
        setState({ key, items, failed: false });
      }, () => { if (!controller.signal.aborted) setState({ key, items: null, failed: true }); });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, key, query]);
  const cached = answers.get(key);
  const items = !active ? null : cached ?? (state.key === key ? state.items : null);
  const failed = active && !cached && state.key === key && state.failed;
  return { items, failed, active };
}

// The search field with its suggestion list (the ARIA combobox pattern). `children` (an icon) sit beside the field. The list
// is positioned against the nearest positioned ancestor, which is the search form.
export default function SearchSuggest({ value, onChange, onSeeAll, inputProps = {}, children }) {
  const navigate = useNavigate();
  const listId = useId(), id = suffix => `${listId}${suffix}`;
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const { items, failed, active } = useSuggestions(value, SEARCH_SUGGEST);
  const query = value.trim();
  const visible = SEARCH_SUGGEST && open && active && !failed && items !== null;
  const rows = visible ? items.length + 1 : 0; // the books, then "See all results"
  const current = visible && highlight >= 0 && highlight < rows ? highlight : -1;
  const announcement = visible ? (items.length ? `${items.length} ${items.length === 1 ? "book" : "books"}` : "No books match") : "";

  function openBook(book) { setOpen(false); setHighlight(-1); navigate(`/book/${book.id}`); }
  function seeAll() { setOpen(false); setHighlight(-1); onSeeAll(); }
  function choose(index) { if (index < items.length) openBook(items[index]); else seeAll(); }

  function onKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!active || failed || items === null) return;
      event.preventDefault();
      if (!visible) { setOpen(true); return; }
      setHighlight(index => (event.key === "ArrowDown" ? (index + 1) % rows : (index <= 0 ? rows - 1 : index - 1)));
    } else if (event.key === "Enter" && current >= 0) {
      event.preventDefault();
      choose(current);
    } else if (event.key === "Escape") {
      if (visible) { event.preventDefault(); setOpen(false); setHighlight(-1); }
      else if (value) { event.preventDefault(); onChange(""); }
    }
  }

  return <>
    {children}
    <input {...inputProps} value={value} onChange={event => { setOpen(true); setHighlight(-1); onChange(event.target.value); }}
      {...(SEARCH_SUGGEST ? { role: "combobox", "aria-autocomplete": "list", "aria-expanded": visible, "aria-controls": id("-list"), "aria-activedescendant": current >= 0 ? id(`-row-${current}`) : undefined,
        autoComplete: "off", onKeyDown, onBlur: () => { setOpen(false); setHighlight(-1); } } : {})} />
    {SEARCH_SUGGEST && <>
      <div className="bv-sr-only" role="status" aria-live="polite">{announcement}</div>
      {visible && <div className="bv-suggest">
        {!items.length && <p className="bv-suggest-empty">No books match “{query}”</p>}
        <ul role="listbox" id={id("-list")} aria-label="Book suggestions">
          {items.map((book, index) => {
            const [before, match, after] = splitMatch(book.title, query);
            return <li key={book.id} id={id(`-row-${index}`)} role="option" aria-selected={current === index} className={`bv-suggest-row${current === index ? " is-active" : ""}`}
              onMouseDown={event => event.preventDefault()} onClick={() => openBook(book)}>
              <span className="bv-suggest-cover"><BookCover book={{ title: book.title, authors: book.author ? [{ name: book.author }] : [], cover_image_url: book.cover }} size="small" decorative /></span>
              <span className="bv-suggest-text">
                <span className="bv-suggest-title">{before}{match && <span className="bv-suggest-match">{match}</span>}{after}</span>
                {(book.author || book.year) && <span className="bv-suggest-meta">{[book.author, book.year].filter(Boolean).join(" · ")}</span>}
              </span>
            </li>;
          })}
          <li id={id(`-row-${items.length}`)} role="option" aria-selected={current === items.length} className={`bv-suggest-row bv-suggest-all${current === items.length ? " is-active" : ""}`}
            onMouseDown={event => event.preventDefault()} onClick={seeAll}>
            <span className="bv-suggest-text"><span className="bv-suggest-all-text">See all results for “{query}”</span></span>
            <span className="bv-suggest-hint" aria-hidden="true">Enter</span>
          </li>
        </ul>
      </div>}
    </>}
  </>;
}
