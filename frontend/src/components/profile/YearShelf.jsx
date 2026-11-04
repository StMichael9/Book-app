import { useEffect, useRef, useState } from "react";
import { MONTHS, clothFor, hash } from "./shelfData.js";

const books = count => `${count} ${count === 1 ? "book" : "books"}`;

// The spines rise once per page load, not on every visit to the hub.
let risen = false;

// One spine per finished book in its month, on an ink baseline. The colour and height are decoration only.
export function YearInBooks({ stats, own = true, chips = true }) {
  const [rise] = useState(() => !risen);
  useEffect(() => { risen = true; }, []);
  // How many spines fit a month at the minimum width (4 px on phones, 8 px on desktop); the rest show as "+N".
  const shelf = useRef(null), [capacity, setCapacity] = useState(Infinity);
  const present = Array.isArray(stats?.by_month);
  useEffect(() => {
    const node = shelf.current;
    if (!node) return undefined;
    // The column width comes from the shelf's own width, never from the spines inside it, so it can't feed back on itself.
    // An unmeasured (zero-width) shelf shows every spine.
    const measure = () => {
      const style = getComputedStyle(node), gap = Number.parseFloat(style.columnGap) || 0, pad = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const column = (node.clientWidth - pad - gap * 11) / 12;
      setCapacity(column > 0 ? Math.max(1, Math.floor((column + 1) / ((window.matchMedia("(min-width: 701px)").matches ? 8 : 4) + 1))) : Infinity);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [present]);
  if (!Array.isArray(stats?.by_month)) return null;
  const empty = !stats.books_finished;
  if (empty && !own) return null;
  const finished = <><strong>{books(stats.books_finished)}</strong> and <strong>{stats.pages_read.toLocaleString("en-US")} {stats.pages_read === 1 ? "page" : "pages"}</strong></>;
  return <section className="bv-profile-year" aria-labelledby="bv-year-heading"><h2 id="bv-year-heading">{own ? `Your ${stats.year}` : `${stats.year} in books`}</h2>
    {empty ? <p>Finish a book this year and it’ll show up here.</p>
      : <p>{own ? "You’ve finished " : "Finished "}{finished} this year.{stats.biggest_month ? ` ${MONTHS[stats.biggest_month - 1]} was ${own ? "your" : "their"} biggest month.` : ""}</p>}
    <div ref={shelf} className={`bv-shelf${rise ? " is-rising" : ""}`} aria-hidden="true">
      {stats.by_month.map((count, month) => <div key={month} className="bv-shelf-month" data-month={month + 1} style={{ "--bv-month": month }}>
        {count > capacity && <small className="bv-shelf-more">+{count - capacity}</small>}
        {Array.from({ length: Math.min(count, capacity) }, (_, index) => <i key={index} className="bv-shelf-spine" style={{ background: clothFor(stats.year, month, index), height: `${78 + hash(stats.year, month, index, "h") % 23}%` }} />)}</div>)}
    </div>
    <div className="bv-shelf-months" aria-hidden="true">{stats.by_month.map((_, month) => <span key={month} className={month + 1 === stats.biggest_month ? "is-top" : ""}>{"JFMAMJJASOND"[month]}</span>)}</div>
    <ul className="bv-sr-only">{stats.by_month.map((count, month) => <li key={month}>{MONTHS[month]}: {count}</li>)}</ul>
    {chips && stats.top_genres?.length > 0 && <p className="bv-muted bv-year-genres">Mostly {stats.top_genres.map(genre => `${genre.name} (${genre.count})`).join(" · ")}</p>}
  </section>;
}
