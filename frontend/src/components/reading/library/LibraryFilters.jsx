import { useEffect, useState } from "react";
import { searchLibraryFacet } from "../../../api/reading.js";
import { libraryApiParams } from "./libraryQuery.js";

const TOP = 5;
const GROUP_TITLES = { subject: "Genre", author: "Author", length: "Length", source: "Imported from", year: "Year finished" };
const ALL_LABELS = { subject: "All genres", author: "All authors", source: "All imports", year: "All years" };
const FACET_KEY = { subject: "subject", author: "author", length: "length", source: "source_label", year: "year_finished" };

function Option({ checked, disabled, label, count, onChange }) {
  return <label className={`bv-check${count === 0 && !checked ? " is-zero" : ""}`}>
    <input type="checkbox" checked={checked} disabled={disabled && !checked} onChange={onChange} />
    <span className="bv-check-label">{label}</span>{count !== undefined && <span className="bv-check-count">{count}</span>}
  </label>;
}

// Find an author among all of them (a library can hold far more than the top few). Results replace the list while typing.
function AuthorSearch({ state, onFound }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const needle = text.trim();
    if (!needle) { onFound(null); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = libraryApiParams(state, { search: false });
      params.delete("q"); params.set("q", needle);
      searchLibraryFacet("author", params, controller.signal).then(result => onFound(Array.isArray(result?.items) ? result.items : []), () => {});
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
    // The search re-runs when the text or the other filters change.
  }, [text, state, onFound]);
  return <input type="search" className="bv-facet-search" aria-label="Find an author" placeholder="Find an author…" value={text} maxLength={100} onChange={event => setText(event.target.value)} />;
}

function Group({ group, options, state, labelFor, onToggle, extra, search, found }) {
  const [expanded, setExpanded] = useState(false);
  const selected = state[group];
  const list = found ?? options;
  // A chosen option stays on show even when it isn't among the top few or the search results.
  const chosenOnly = selected.filter(value => !list.some(item => String(item.value) === value));
  const rows = [...chosenOnly.map(value => ({ value, label: labelFor(group, value), count: undefined })), ...list];
  const shown = expanded || found ? rows : rows.filter((item, index) => index < TOP || selected.includes(String(item.value)));
  const id = `bv-facet-${group}`;
  return <fieldset className="bv-facet-group" aria-labelledby={id}>
    <legend id={id}>{GROUP_TITLES[group]}</legend>
    {search}
    {extra}
    {shown.map(item => <Option key={item.value} label={item.label} count={item.count} checked={selected.includes(String(item.value))}
      disabled={item.count === 0} onChange={() => onToggle(group, String(item.value), item.label)} />)}
    {!found && rows.length > TOP && ALL_LABELS[group] && <button type="button" className="bv-facet-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : ALL_LABELS[group]}</button>}
  </fieldset>;
}

// The groups, with live counts from the last response. Used in the desktop panel and the phone sheet.
export default function LibraryFilters({ facets, state, labelFor, onToggle, onFlag }) {
  const [found, setFound] = useState(null);
  const optionsOf = group => facets?.[FACET_KEY[group]] || [];
  const showYear = state.shelf === "all" || state.shelf === "finished";
  const hasSources = optionsOf("source").length > 0 || state.source.length > 0 || state.recent;
  return <div className="bv-facets">
    {optionsOf("subject").length > 0 && <Group group="subject" options={optionsOf("subject")} state={state} labelFor={labelFor} onToggle={onToggle} />}
    {(optionsOf("author").length > 0 || state.author.length > 0) && <Group group="author" options={optionsOf("author")} state={state} labelFor={labelFor} onToggle={onToggle} found={found}
      search={<AuthorSearch state={state} onFound={setFound} />} />}
    <Group group="length" options={optionsOf("length")} state={state} labelFor={labelFor} onToggle={onToggle} />
    {hasSources && <Group group="source" options={optionsOf("source")} state={state} labelFor={labelFor} onToggle={onToggle}
      extra={<Option label="Just imported" checked={state.recent} onChange={() => onFlag("recent")} />} />}
    {showYear && (optionsOf("year").length > 0 || state.year.length > 0) && <Group group="year" options={optionsOf("year")} state={state} labelFor={labelFor} onToggle={onToggle} />}
    <fieldset className="bv-facet-group"><legend>More</legend><Option label="Has my note" checked={state.note} onChange={() => onFlag("note")} /></fieldset>
  </div>;
}
