import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { BookOpen, ChevronDown, LayoutGrid, List, Search, SlidersHorizontal, X } from "lucide-react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { bookshopAffiliateUrl } from "../../api/affiliate.js";
import { useRequest } from "../ui-v2/data.js";
import { ActionLink, BookSkeletons, Button, EmptyState, NativeDialog, TextLink } from "../ui-v2/primitives.jsx";
import { LibraryEntryCard, LibraryEntryRow } from "./ReadingCards.jsx";
import { LETTERS, entryLetter, letterId } from "./library/libraryIndex.js";
import { useLibraryNavigation } from "./libraryNavigationState.js";
import LibraryFilters from "./library/LibraryFilters.jsx";
import { MAX_RESTORE, PAGE_SIZE, SORTS, activeFilterCount, clearFilters, defaultLibraryState, isFiltered, libraryKey, loadLibraryPage, readLibraryState, writeLibraryState } from "./library/libraryQuery.js";
import "../../styles/ui-v2/library.css";

const DESKTOP = "(min-width: 901px)";
const subscribeDesktop = notify => { const query = window.matchMedia(DESKTOP); query.addEventListener("change", notify); return () => query.removeEventListener("change", notify); };
const useDesktop = () => useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => true);

const VIEW_KEY = "bookvane-library-view";
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "covers"; } catch { return "covers"; } };
const books = count => `${count} ${count === 1 ? "book" : "books"}`;
const LENGTH_FALLBACK = { short: "Short", medium: "Medium", long: "Long" };
const SHORT_SORT = { added: "Added", title: "Title", author: "Author", finished: "Finished", updated: "Updated" };
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
    <Button ref={button} variant="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><span className="bv-sort-long">Sort: {current}</span><span className="bv-sort-short" aria-hidden="true">{SHORT_SORT[value]}</span><ChevronDown aria-hidden="true" /></Button>
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
  const [view, setView] = useState(readView);
  const changeView = next => { setView(next); try { localStorage.setItem(VIEW_KEY, next); } catch { /* the choice just isn't remembered on this device */ } };
  const { rememberEntries } = library;
  // Coming back from a book, the view reloads as far as the reader had got with Show more (state left in history), then scrolls there.
  const navigate = useNavigate();
  const [restore] = useState(() => {
    const loaded = Number(location.state?.libraryLoaded);
    return Number.isInteger(loaded) && loaded > PAGE_SIZE ? { loaded: Math.min(loaded, MAX_RESTORE), scroll: Number(location.state?.libraryScroll) || 0 } : null;
  });
  const restoring = restore && !reload ? restore.loaded : PAGE_SIZE;
  const key = `${libraryKey(auth.sessionGeneration, state, library.revision)}${reload ? `:r${reload}` : ""}${restoring !== PAGE_SIZE ? `:n${restoring}` : ""}`;
  const request = useRequest(() => loadLibraryPage(state, "", restoring), key);
  const scrolled = useRef(false);
  useLayoutEffect(() => {
    if (restore && request.data && !scrolled.current) { scrolled.current = true; window.scrollTo({ top: restore.scroll, left: 0, behavior: "instant" }); }
  }, [restore, request.data]);
  useEffect(() => { if (request.data) rememberEntries(request.data.items); }, [request.data, rememberEntries]);

  // The last answer stays on screen while the next one loads, so the panel and tabs don't blink away.
  const [held, setHeld] = useState(null);
  if (request.data && request.data !== held) setHeld(request.data);
  const page = request.data || held;
  const refreshing = request.loading && Boolean(held);
  // The size of the whole library, for "N of M": one small unfiltered request, only while something narrows the list.
  const filtered = isFiltered(state);
  const everything = useRequest(() => loadLibraryPage(defaultLibraryState(), "", 1), `library-size:${auth.sessionGeneration}:${library.revision}`, filtered);
  const unfiltered = everything.data?.counts?.all ?? null;

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

  // The A–Z index: a tap on a letter loads more pages until that letter's group is on the page, then moves there.
  const jumpTo = useRef(null), [jumpTick, setJumpTick] = useState(0);
  useEffect(() => {
    const letter = jumpTo.current;
    if (!letter) return;
    const node = document.getElementById(letterId(letter));
    if (node) { jumpTo.current = null; node.scrollIntoView({ block: "start", behavior: "instant" }); node.focus({ preventScroll: true }); }
    else if (current.loading) return;
    else if (current.next && !current.failed) showMore();
    else jumpTo.current = null;
    // showMore closes over the latest pages; this re-runs as each page arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTick, current.next, current.loading, current.failed, current.items.length]);
  function rememberView() {
    const loaded = items.length > PAGE_SIZE ? items.length : 0, scroll = Math.round(window.scrollY);
    navigation.remember(location.key, { href: location.pathname + location.search, previous: location.state?.libraryPrevious, loaded, scroll });
    // Browser Back returns to this entry, so it carries how far the reader had got.
    if (loaded) navigate(location.pathname + location.search, { replace: true, state: { ...location.state, libraryLoaded: loaded, libraryScroll: scroll } });
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
  // In the list, books sit under their letter when sorted by title or author (consecutive runs, so the order never changes).
  const groups = view === "list" && page?.index ? items.reduce((out, entry) => {
    const letter = entryLetter(entry, state.sort);
    if (out.at(-1)?.letter === letter) out.at(-1).items.push(entry); else out.push({ letter, items: [entry] });
    return out;
  }, []) : [{ letter: null, items }];
  // After a chip comes off, focus goes to the next chip, or to the results heading when none are left; never to the page.
  const chipsNode = useRef(null), resultsHeading = useRef(null), focusChip = useRef(null);
  useEffect(() => {
    const index = focusChip.current;
    if (index == null) return;
    focusChip.current = null;
    const chipButtons = chipsNode.current?.querySelectorAll(".bv-chip");
    if (chipButtons?.length) chipButtons[Math.min(index, chipButtons.length - 1)].focus();
    else resultsHeading.current?.focus({ preventScroll: true });
  }, [paramsText]);
  const chips = [
    state.q && ["q", `“${state.q}”`, () => apply({ ...state, q: "" })],
    state.owned && ["owned", "Owned", () => apply({ ...state, owned: false })],
    ...["subject", "author", "length", "source", "year"].flatMap(group => state[group].map(value => [`${group}:${value}`, labelFor(group, value), () => toggle(group, value)])),
    state.note && ["note", "Has my note", () => apply({ ...state, note: false })],
    state.recent && ["recent", "Just imported", () => apply({ ...state, recent: false })],
    state.label && ["label", `Import: ${state.label}`, () => apply({ ...state, label: "" })],
  ].filter(Boolean);
  const clearAll = () => { focusChip.current = -1; apply(clearFilters(state)); };
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
      <div className="bv-view-toggle" role="group" aria-label="View">
        {[["covers", "Covers", LayoutGrid], ["list", "List", List]].map(([key, text, Icon]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => changeView(key)}><Icon aria-hidden="true" /><span className="bv-view-text">{text}</span></button>)}
      </div>
      {!desktop && <Button variant="secondary" className="bv-filters-button" onClick={() => setSheet(true)}><SlidersHorizontal aria-hidden="true" />Filters{filterCount > 0 && <><span className="bv-count-badge" aria-hidden="true">{filterCount}</span><span className="bv-sr-only">{` (${filterCount} active)`}</span></>}</Button>}
    </div>
    <div className="bv-shelf-row">
      <div className="bv-shelf-tabs">
        <div className="bv-shelf-scroll" role="group" aria-label="Shelf">{[...shelves, ...(activeMore ? [activeMore] : [])].map(shelfButton)}</div>
        {desktop && moreShelves.length > 0 && <details className="bv-library-more"><summary>More filters<ChevronDown aria-hidden="true" /></summary>
          <div className="bv-more-menu">{moreShelves.filter(([shelf]) => shelf !== state.shelf).map(shelfButton)}</div></details>}
      </div>
      <button type="button" role="switch" aria-checked={state.owned} className="bv-owned-switch" onClick={() => flag("owned")}>Owned only<span className="bv-switch" aria-hidden="true" /></button>
    </div>
    {["reading", "paused", "finished", "dnf"].includes(state.shelf) && <p className="bv-help">Earlier readings are kept in each book’s Reading history.</p>}
    {chips.length > 0 && <div className="bv-chips" role="group" aria-label="Active filters" ref={chipsNode}>
      {chips.map(([id, text, remove], index) => <button key={id} type="button" className="bv-chip" aria-label={`Remove filter: ${text}`} onClick={() => { focusChip.current = index; remove(); }}>{text}<X aria-hidden="true" /></button>)}
      <button type="button" className="bv-link-button" onClick={clearAll}>Clear all</button>
    </div>}
    {library.readOnly && <p className="bv-notice" role="status">Your library is available to read. Changes are temporarily paused.</p>}
    <div className={`bv-library-body${desktop ? " has-panel" : ""}`}>
      {desktop && <aside className="bv-facet-panel" aria-label="Filters">{facets}</aside>}
      <div className="bv-library-results" aria-busy={refreshing}>
        <h2 className="bv-sr-only" tabIndex={-1} ref={resultsHeading}>Your books</h2>
        {!page && request.loading ? <BookSkeletons /> : !page ? <EmptyState error icon={BookOpen} title="Your library couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Your saved books haven’t changed.</EmptyState>
          : items.length ? <>
            {view === "list" ? <div className="bv-list-wrap">
              {page.index && <nav className="bv-az" aria-label="Jump to a letter">{LETTERS.map(letter => {
                const count = page.index[letter] ?? 0;
                return <button key={letter} type="button" disabled={!count} aria-label={count ? `Jump to ${letter === "#" ? "other" : letter}, ${books(count)}` : `${letter === "#" ? "Other" : letter}, no books`}
                  onClick={() => { jumpTo.current = letter; setJumpTick(tick => tick + 1); }}>{letter}</button>;
              })}</nav>}
              <div className="bv-library-list">{groups.map((group, groupIndex) => <section key={groupIndex} className="bv-letter-group" aria-label={group.letter ? `${group.letter === "#" ? "Other" : group.letter}` : undefined}>
                {group.letter && <h3 className="bv-letter" tabIndex={-1} {...(groups.findIndex(other => other.letter === group.letter) === groupIndex ? { id: letterId(group.letter) } : {})}>{group.letter === "#" ? "Other" : group.letter}</h3>}
                <ul>{group.items.map(entry => <LibraryEntryRow key={entry.id} entry={entry} readingActions={library.readingActions} navigationState={{ libraryReturn: location.key }} onOpen={rememberView} />)}</ul></section>)}</div>
            </div> : <div className="bv-book-grid">{items.map((entry, index) => <LibraryEntryCard key={entry.id} entry={entry} priority={index < 5} readingActions={library.readingActions} navigationState={{ libraryReturn: location.key }} onOpen={rememberView}
              buyUrl={state.shelf === "want" && entry.book ? bookshopAffiliateUrl(entry.book) : undefined} />)}</div>}
            {affiliateLinks && <p className="bv-help">Bookshop links are affiliate links. Bookvane may earn a commission if you purchase through them.</p>}
            <div className="bv-show-more">
              {current.next && <Button variant="secondary" disabled={current.loading} onClick={showMore}>{current.loading ? "Loading…" : "Show more"}</Button>}
              {current.failed && <p className="bv-notice bv-notice--error" role="alert">More books couldn’t load. Try again.</p>}
              <p className="bv-muted" role="status">Showing {items.length} of {total}</p>
            </div>
          </> : filtered || state.shelf !== "all"
            ? <div className="bv-library-empty"><p>No books match these filters</p>{filtered ? <Button variant="secondary" onClick={clearAll}>Clear all</Button> : <Button variant="secondary" onClick={() => apply({ ...state, shelf: "all" })}>Show all books</Button>}</div>
            : <EmptyState icon={BookOpen} title="No books here yet." action={<ActionLink to="/browse">Discover books</ActionLink>}>Mark a book Want to read or Owned to keep it here.</EmptyState>}
      </div>
    </div>
    {library.readingActions && !library.readOnly && <p className="bv-library-tools"><TextLink to="/my-books/private">Add a book</TextLink></p>}
    {!desktop && <NativeDialog open={sheet} onClose={() => setSheet(false)} title="Filters" className="bv-sheet">
      <div className="bv-sheet-body">
        {moreShelves.length > 0 && <fieldset className="bv-facet-group"><legend>Other shelves</legend>
          <div className="bv-sheet-shelves">{moreShelves.map(([shelf, text]) => <button key={shelf} type="button" className="bv-shelf-pill" aria-pressed={state.shelf === shelf} onClick={() => apply({ ...state, shelf: state.shelf === shelf ? "all" : shelf })}>{text}<small>{counts?.[shelf] ?? "…"}</small></button>)}</div></fieldset>}
        {facets}
      </div>
      <div className="bv-sheet-foot"><Button onClick={() => setSheet(false)}>{`Show ${books(total)}`}</Button><Button variant="quiet" onClick={clearAll} disabled={!filtered}>Clear all</Button></div>
    </NativeDialog>}
  </section>;
}
