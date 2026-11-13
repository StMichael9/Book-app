import { useEffect, useState } from "react";
import { searchLibraryFacet } from "../../../api/reading.js";
import { libraryApiParams } from "./libraryQuery.js";

const TOP = 5;
const GROUP_TITLES = { subject: "Genre", author: "Author", length: "Length" };
const ALL_LABELS = { subject: "All genres", author: "All authors" };

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

function Group({ group, options, state, labelFor, onToggle, search, found }) {
  const [expanded, setExpanded] = useState(false);
  const selected = state[group];
  const list = found ?? options;
  // A chosen option stays on show even when it isn't among the top few or the search results.
  const chosenOnly = selected.filter(value => !list.some(item => String(item.value) === value));
  // An option with no name to show is left out (a subject that isn't a genre): its key is never shown.
  const rows = [...chosenOnly.map(value => ({ value, label: labelFor(group, value), count: undefined })), ...list].filter(item => item.label);
  const shown = expanded || found ? rows : rows.filter((item, index) => index < TOP || selected.includes(String(item.value)));
  const id = `bv-facet-${group}`;
  return <fieldset className="bv-facet-group" aria-labelledby={id}>
    <legend id={id}>{GROUP_TITLES[group]}</legend>
    {search}
    {shown.map(item => <Option key={item.value} label={item.label} count={item.count} checked={selected.includes(String(item.value))}
      disabled={item.count === 0} onChange={() => onToggle(group, String(item.value), item.label)} />)}
    {!found && rows.length > TOP && ALL_LABELS[group] && <button type="button" className="bv-facet-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : ALL_LABELS[group]}</button>}
  </fieldset>;
}

// The groups, with live counts from the last response. Used in the desktop panel and the phone sheet.
export default function LibraryFilters({ facets, state, labelFor, onToggle }) {
  const [found, setFound] = useState(null);
  const optionsOf = group => facets?.[group] || [];
  // Genres go by the app's one genre list: each option takes its name from there.
  const genres = optionsOf("subject").map(item => ({ ...item, label: labelFor("subject", String(item.value)) })).filter(item => item.label);
  return <div className="bv-facets">
    {genres.length > 0 && <Group group="subject" options={genres} state={state} labelFor={labelFor} onToggle={onToggle} />}
    {(optionsOf("author").length > 0 || state.author.length > 0) && <Group group="author" options={optionsOf("author")} state={state} labelFor={labelFor} onToggle={onToggle} found={found}
      search={<AuthorSearch state={state} onFound={setFound} />} />}
    <Group group="length" options={optionsOf("length")} state={state} labelFor={labelFor} onToggle={onToggle} />
  </div>;
}
