import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { BookOpen, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { bookshopAffiliateUrl } from "../../api/affiliate.js";
import { useRequest } from "../ui-v2/data.js";
import { ActionLink, BookSkeletons, Button, EmptyState, NativeDialog, TextLink } from "../ui-v2/primitives.jsx";
import { LibraryEntryCard } from "./ReadingCards.jsx";
import { useLibraryNavigation } from "./libraryNavigationState.js";
import LibraryFilters from "./library/LibraryFilters.jsx";
import { SORTS, activeFilterCount, clearFilters, isFiltered, libraryKey, loadLibraryPage, readLibraryState, writeLibraryState } from "./library/libraryQuery.js";
import "../../styles/ui-v2/library.css";

const DESKTOP = "(min-width: 901px)";
const subscribeDesktop = notify => { const query = window.matchMedia(DESKTOP); query.addEventListener("change", notify); return () => query.removeEventListener("change", notify); };
const useDesktop = () => useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => true);

const books = count => `${count} ${count === 1 ? "book" : "books"}`;
const LENGTH_FALLBACK = { short: "Short", medium: "Medium", long: "Long" };
const FACET_NAME = { source: "source_label", year: "year_finished" };

function SortMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null), button = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    root.current?.querySelector('[aria-checked="true"]')?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  function onKeyDown(event) {
    if (!open) return;
    const items = [...root.current.querySelectorAll('[role="menuitemradio"]')], index = items.indexOf(document.activeElement);
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); button.current?.focus(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus(); }
    else if (event.key === "Tab") setOpen(false);
  }
  const current = SORTS.find(([key]) => key === value)[1];
  return <div className="bv-sort" ref={root} onKeyDown={onKeyDown}>
    <Button ref={button} variant="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>Sort: {current}<ChevronDown aria-hidden="true" /></Button>
    {open && <div className="bv-sort-menu" role="menu" aria-label="Sort your books">
      {SORTS.map(([key, text]) => <button key={key} type="button" role="menuitemradio" aria-checked={key === value} onClick={() => { setOpen(false); button.current?.focus(); onChange(key); }}>{text}</button>)}
    </div>}
  </div>;
}

export default function LibraryPage() {
  const auth = useAuth();
  const library = useUserBooks();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigation = useLibraryNavigation();
  const desktop = useDesktop();
  const paramsText = params.toString();
  // A new object only when the URL changes, so effects that depend on the state don't fire on every render.
  const state = useMemo(() => readLibraryState(new URLSearchParams(paramsText)), [paramsText]);
  const [reload, setReload] = useState(0);
  const [picked, setPicked] = useState({});
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState(state.q);
  const [seenQuery, setSeenQuery] = useState(state.q);
  if (seenQuery !== state.q) { setSeenQuery(state.q); setDraft(state.q); }
  const { rememberEntries } = library;
  const key = `${libraryKey(auth.sessionGeneration, state, library.revision)}${reload ? `:r${reload}` : ""}`;
  const request = useRequest(() => loadLibraryPage(state), key);
  useEffect(() => { if (request.data) rememberEntries(request.data.items); }, [request.data, rememberEntries]);

  // The last answer stays on screen while the next one loads, so the panel and tabs don't blink away.
  const [held, setHeld] = useState(null);
  if (request.data && request.data !== held) setHeld(request.data);
  const page = request.data || held;
  const refreshing = request.loading && Boolean(held);
  // The size of the whole library, for "N of M": remembered from the last view with nothing narrowing it.
  const [unfiltered, setUnfiltered] = useState(null);
  if (request.data && !isFiltered(state) && state.shelf === "all" && unfiltered !== request.data.counts.all) setUnfiltered(request.data.counts.all);

  // More pages append to the first one and are dropped whenever the first page changes.
  const [more, setMore] = useState({ base: null, items: [], next: null, loading: false, failed: false });
  const current = more.base === page ? more : { base: page, items: [], next: page?.next_cursor ?? null, loading: false, failed: false };
  async function showMore() {
    const base = page;
    setMore({ ...current, loading: true, failed: false });
    try {
      const next = await loadLibraryPage(state, current.next);
      rememberEntries(next.items);
      setMore(latest => latest.base === base ? { base, items: [...current.items, ...next.items], next: next.next_cursor, loading: false, failed: false } : latest);
    } catch (error) {
      // A cursor the server no longer accepts: start the list again from the first page.
      if (error.status === 422 && error.detail?.code === "invalid_cursor") { setMore({ base: null, items: [], next: null, loading: false, failed: false }); setReload(value => value + 1); }
      else setMore({ ...current, loading: false, failed: true });
    }
  }

  function rememberView() {
    navigation.remember(location.key, { href: location.pathname + location.search, previous: location.state?.libraryPrevious });
  }
  const apply = next => setParams(writeLibraryState(next));
  const labelFor = (group, value) => picked[`${group}:${value}`]
    ?? page?.facets?.[FACET_NAME[group] || group]?.find(item => String(item.value) === value)?.label
    ?? (group === "length" ? LENGTH_FALLBACK[value] : value);
  function toggle(group, value, label) {
    if (label) setPicked(known => ({ ...known, [`${group}:${value}`]: label }));
    apply({ ...state, [group]: state[group].includes(value) ? state[group].filter(item => item !== value) : [...state[group], value] });
  }
  const flag = name => apply({ ...state, [name]: !state[name] });

  const counts = page?.counts;
  const shelves = [["all", "All"], ...(library.readingActions ? [["reading", "Reading"]] : []), ["want", "Want to read"], ...(library.readingActions ? [["finished", "Finished"]] : [])];
  const moreShelves = library.readingActions ? [["paused", "Paused"], ["dnf", "Stopped"]] : [];
  const activeMore = moreShelves.find(([shelf]) => shelf === state.shelf);
  const shelfButton = ([shelf, text]) => <button key={shelf} type="button" className="bv-shelf-tab" aria-pressed={state.shelf === shelf} onClick={() => apply({ ...state, shelf })}>{text}<small>{counts?.[shelf] ?? "…"}</small></button>;

  const total = page?.total ?? 0;
  const items = page ? [...page.items, ...current.items] : [];
  const filtered = isFiltered(state);
  const chips = [
    state.q && ["q", `“${state.q}”`, () => apply({ ...state, q: "" })],
    state.owned && ["owned", "Owned", () => apply({ ...state, owned: false })],
    ...["subject", "author", "length", "source", "year"].flatMap(group => state[group].map(value => [`${group}:${value}`, labelFor(group, value), () => toggle(group, value)])),
    state.note && ["note", "Has my note", () => apply({ ...state, note: false })],
    state.recent && ["recent", "Just imported", () => apply({ ...state, recent: false })],
    state.label && ["label", `Import: ${state.label}`, () => apply({ ...state, label: "" })],
  ].filter(Boolean);
  const clearAll = () => apply(clearFilters(state));
  const filterCount = activeFilterCount(state);
  const affiliateLinks = state.shelf === "want" && items.some(entry => entry.book && bookshopAffiliateUrl(entry.book));
  const facets = <LibraryFilters facets={page?.facets} state={state} labelFor={labelFor} onToggle={toggle} onFlag={flag} />;

  return <section className="bv-container bv-reading-library bv-library">
    <div className="bv-library-head">
      <div><h1>My Books</h1>{page && <p className="bv-library-count" role="status">{filtered && unfiltered != null && unfiltered >= total ? `${total} of ${books(unfiltered)}` : books(total)}</p>}</div>
      {library.libraryImport && !library.readOnly && <ActionLink to="/my-books/import" variant="secondary" className="bv-button bv-button--secondary bv-import-link">Import books</ActionLink>}
    </div>
    <div className="bv-library-bar">
      <form className="bv-library-search bv-field" role="search" aria-label="Search your library" onSubmit={event => { event.preventDefault(); apply({ ...state, q: draft.trim() }); }}>
        <Search aria-hidden="true" />
        <input type="search" aria-label="Search title or author" enterKeyHint="search" value={draft} maxLength={200} placeholder="Search your books by title or author" onChange={event => setDraft(event.target.value)} />
      </form>
      <SortMenu value={state.sort} onChange={sort => apply({ ...state, sort })} />
      {!desktop && <Button variant="secondary" className="bv-filters-button" onClick={() => setSheet(true)}><SlidersHorizontal aria-hidden="true" />Filters{filterCount > 0 && <span className="bv-count-badge" aria-label={`, ${filterCount} active`}>{filterCount}</span>}</Button>}
    </div>
    <div className="bv-shelf-row">
      <div className="bv-shelf-tabs" role="group" aria-label="Shelf">
        {[...shelves, ...(activeMore ? [activeMore] : [])].map(shelfButton)}
        {moreShelves.length > 0 && <details className="bv-library-more"><summary>More filters<ChevronDown aria-hidden="true" /></summary>
          <div className="bv-more-menu">{moreShelves.filter(([shelf]) => shelf !== state.shelf).map(shelfButton)}</div></details>}
      </div>
      <button type="button" role="switch" aria-checked={state.owned} className="bv-owned-switch" onClick={() => flag("owned")}>Owned only<span className="bv-switch" aria-hidden="true" /></button>
    </div>
    {["reading", "paused", "finished", "dnf"].includes(state.shelf) && <p className="bv-help">Earlier readings are kept in each book’s Reading history.</p>}
    {chips.length > 0 && <div className="bv-chips" role="group" aria-label="Active filters">
      {chips.map(([id, text, remove]) => <button key={id} type="button" className="bv-chip" aria-label={`Remove filter: ${text}`} onClick={remove}>{text}<X aria-hidden="true" /></button>)}
      <button type="button" className="bv-link-button" onClick={clearAll}>Clear all</button>
    </div>}
    {library.readOnly && <p className="bv-notice" role="status">Your library is available to read. Changes are temporarily paused.</p>}
    <div className={`bv-library-body${desktop ? " has-panel" : ""}`}>
      {desktop && <aside className="bv-facet-panel" aria-label="Filters">{facets}</aside>}
      <div className="bv-library-results" aria-busy={refreshing}>
        {!page && request.loading ? <BookSkeletons /> : !page ? <EmptyState error icon={BookOpen} title="Your library couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Your saved books haven’t changed.</EmptyState>
          : items.length ? <>
            <div className="bv-book-grid">{items.map((entry, index) => <LibraryEntryCard key={entry.id} entry={entry} priority={index < 5} readingActions={library.readingActions} navigationState={{ libraryReturn: location.key }} onOpen={rememberView}
              buyUrl={state.shelf === "want" && entry.book ? bookshopAffiliateUrl(entry.book) : undefined} />)}</div>
            {affiliateLinks && <p className="bv-help">Bookshop links are affiliate links. Bookvane may earn a commission if you purchase through them.</p>}
            <div className="bv-show-more">
              {current.next && <Button variant="secondary" disabled={current.loading} onClick={showMore}>{current.loading ? "Loading…" : "Show more"}</Button>}
              {current.failed && <p className="bv-notice bv-notice--error" role="alert">More books couldn’t load. Try again.</p>}
              <p className="bv-muted" role="status">Showing {items.length} of {total}</p>
            </div>
          </> : filtered || state.shelf !== "all"
            ? <div className="bv-library-empty"><p>No books match these filters</p>{filtered ? <Button variant="secondary" onClick={clearAll}>Clear all</Button> : <Button variant="secondary" onClick={() => apply({ ...state, shelf: "all" })}>Show all books</Button>}</div>
            : <EmptyState icon={BookOpen} title="Give your books a home." action={<ActionLink to="/browse">Discover books</ActionLink>}>Mark a book Want to read or Owned to keep it here.</EmptyState>}
      </div>
    </div>
    {library.readingActions && !library.readOnly && <p className="bv-library-tools"><TextLink to="/my-books/private">Add one book manually</TextLink></p>}
    {!desktop && <NativeDialog open={sheet} onClose={() => setSheet(false)} title="Filters" className="bv-sheet">
      <div className="bv-sheet-body">{facets}</div>
      <div className="bv-sheet-foot"><Button onClick={() => setSheet(false)}>{`Show ${books(total)}`}</Button><Button variant="quiet" onClick={clearAll} disabled={!filtered}>Clear all</Button></div>
    </NativeDialog>}
  </section>;
}
