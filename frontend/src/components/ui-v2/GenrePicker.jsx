import { useEffect, useId, useRef } from "react";
import { useGenres } from "./useGenres.js";
import "../../styles/ui-v2/genre-picker.css";

const GROUPS = [["fiction", "Fiction"], ["nonfiction", "Nonfiction and more"]];

// The one genre control: pills fed only by the genre list. Radios for one genre, checkboxes for several. No counts.
//   value: a key (single) or an array of keys (multiple).   compact: one wrapped row with no group headings.
//   includeAny: adds an "Any" pill that clears a single choice (client-side).
export default function GenrePicker({ value, onChange, multiple = false, includeAny = false, anyLabel = "Any", compact = false, scrollRow = false, label = "Genre", disabled = false, className = "", name }) {
  const { genres } = useGenres();
  const row = useRef(null);
  const id = useId(), field = name || `genre-${id}`;
  // A single line that scrolls sideways, with a fade at whichever edge has more; the chosen pill is kept in view.
  useEffect(() => {
    const node = row.current;
    if (!node || !scrollRow) return undefined;
    const fade = () => {
      const edge = 32, start = node.scrollLeft > 2, end = node.scrollLeft + node.clientWidth < node.scrollWidth - 2;
      node.style.setProperty("--bv-fade-start", start ? `${edge}px` : "0px");
      node.style.setProperty("--bv-fade-end", end ? `${edge}px` : "0px");
    };
    const checked = node.querySelector("input:checked")?.parentElement;
    if (checked && (checked.offsetLeft < node.scrollLeft || checked.offsetLeft + checked.offsetWidth > node.scrollLeft + node.clientWidth)) node.scrollLeft = Math.max(0, checked.offsetLeft - 16);
    fade();
    node.addEventListener("scroll", fade, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fade);
    observer?.observe(node);
    return () => { node.removeEventListener("scroll", fade); observer?.disconnect(); };
  });
  if (!genres?.length) return null;
  const chosen = multiple ? (Array.isArray(value) ? value : []) : (typeof value === "string" ? value : "");
  const isOn = key => multiple ? chosen.includes(key) : chosen === key;
  const toggle = (key, on) => onChange(multiple ? (on ? [...chosen, key] : chosen.filter(item => item !== key)) : key);
  const pill = (key, text, extra = {}) => <label key={key || "any"} className="bv-choice bv-genre-pill">
    <input type={multiple ? "checkbox" : "radio"} name={field} value={key} checked={extra.checked ?? isOn(key)} disabled={disabled} onChange={event => extra.onChange ? extra.onChange(event) : toggle(key, event.target.checked)} /><span>{text}</span></label>;
  const any = includeAny && !multiple ? pill("", anyLabel, { checked: chosen === "", onChange: () => onChange("") }) : null;
  const root = { role: multiple ? "group" : "radiogroup", "aria-label": label };
  if (compact) return <div ref={row} {...root} className={`bv-genre-picker bv-genre-picker--compact${scrollRow ? " bv-genre-picker--scroll" : ""} ${className}`.trim()}>{any}{genres.map(genre => pill(genre.key, genre.label))}</div>;
  return <div {...root} className={`bv-genre-picker ${className}`.trim()}>
    {any && <div className="bv-genre-pills">{any}</div>}
    {GROUPS.map(([group, heading]) => {
      const members = genres.filter(genre => genre.group === group);
      return members.length ? <div key={group} role="group" aria-labelledby={`${field}-${group}`} className="bv-genre-group"><h3 id={`${field}-${group}`} className="bv-genre-heading">{heading}</h3>
        <div className="bv-genre-pills">{members.map(genre => pill(genre.key, genre.label))}</div></div> : null;
    })}
  </div>;
}
