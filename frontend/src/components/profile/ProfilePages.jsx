import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Globe, Lock, Plus, X } from "lucide-react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { addListBook, createList, deleteList, getList, getLists, getPublicList, getPublicProfile, getStats, orderList, removeListBook, updateList } from "../../api/profile.js";
import { useReader } from "../ui-v2/readerState.js";
import { ActionLink, BookCover, Button, NativeDialog, TextLink } from "../ui-v2/primitives.jsx";
import Avatar from "./Avatar.jsx";
import ListArt, { SpineBlock } from "./ListArt.jsx";
import { EditProfileSheet, HandleField, MakePublicSheet, SheetFacts } from "./ProfileSheets.jsx";
import { HANDLE, HANDLE_ERROR, saveMessage } from "./profileForm.js";
import { collapse, expand, slideFrom } from "./motion.js";
import { useProfile } from "./profileState.js";
import { MONTHS } from "./shelfData.js";
import { TabBar, TabPanel } from "./ProfileTabs.jsx";
import { useProfileTab } from "./profileTab.js";
import { YearFigures, YearInBooks } from "./YearShelf.jsx";

const books = count => `${count} ${count === 1 ? "book" : "books"}`;
const wait = ms => new Promise(done => setTimeout(done, ms));

// A plain request with a retry; nothing is cached across readers, so one account's pages never show in another's.
function useLoad(load) {
  const run = useEffectEvent(load);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ attempt: -1, data: null, error: null });
  useEffect(() => {
    let active = true;
    run().then(data => { if (active) setState({ attempt, data, error: null }); }, error => { if (active) setState({ attempt, data: null, error }); });
    return () => { active = false; };
  }, [attempt]);
  const done = state.attempt === attempt;
  return { data: state.data, error: done ? state.error : null, loading: !done && !state.data, retry: () => setAttempt(value => value + 1),
    set: update => setState(previous => ({ ...previous, data: typeof update === "function" ? update(previous.data) : update })) };
}

function Failed({ children = "We couldn’t load this just now.", retry }) {
  return <div className="bv-notice bv-notice--error"><p role="alert">{children}</p>{retry && <Button variant="secondary" onClick={retry}>Try again</Button>}</div>;
}

function NotFound({ page }) {
  useEffect(() => { document.title = "Page not found · Bookvane"; }, []);
  return page;
}

// A small cover for a list row in the 2:3 frame. A book with no artwork wears its bookcloth spine; with artwork, the
// cover shows the typographic jacket while it loads. Wide enough that the jacket keeps its title.
function ListCover({ book }) {
  return <span className="bv-list-cover">{book.cover_image_url ? <BookCover book={{ ...book, authors: [] }} /> : <SpineBlock bookId={book.id} />}</span>;
}

// ---- the year, lists and account: shared by the hub and the public page ---------------------------------------

function Identity({ person, handle, size, children }) {
  return <header className="bv-profile-head"><Avatar person={person} size={size} />
    <div className="bv-profile-id">{person.display_name ? <h1>{person.display_name}</h1> : handle ? <h1>@{handle}</h1> : <h1 className="bv-sr-only">Your profile</h1>}
      <p className="bv-muted">{person.display_name && handle ? `@${handle} · ` : ""}reading since {person.reading_since}</p>
      {person.bio && <p className="bv-profile-bio">{person.bio}</p>}</div>{children}</header>;
}

// The cards, the overview rows and the hub all read a list's artwork the same way.
function listItems(item) {
  // `previews` are [{ id, cover_image_url }] for up to four books, so a book wears its own cloth everywhere. Without
  // them (an older payload) the covers stand in, and the slots up to the book count are spine blocks.
  const covers = (item.covers || []).slice(0, 4).map((url, index) => ({ key: `${item.id}-${index}`, url }));
  const fallback = [...covers, ...Array.from({ length: Math.max(0, Math.min(4, item.book_count) - covers.length) }, (_, index) => ({ key: `${item.id}-s${index}`, url: null }))];
  return Array.isArray(item.previews) ? item.previews.slice(0, 4).map(book => ({ key: book.id, url: book.cover_image_url })) : fallback;
}

function ListMeta({ item, own }) {
  const Icon = item.is_public ? Globe : Lock;
  return <>{books(item.book_count)}{own && <><span aria-hidden="true"> · </span><Icon aria-hidden="true" />{item.is_public ? "shared" : "private"}</>}</>;
}

function ListCard({ item, to, own }) {
  return <li><Link className="bv-list-card" to={to}><ListArt items={listItems(item)} />
    <strong>{item.name}</strong>
    <small><ListMeta item={item} own={own} /></small></Link></li>;
}

// Overview: up to three lists as rows (spine art, name, count and privacy), then a way to the Lists tab for the rest.
function OverviewLists({ lists, own, linkFor, onSeeAll }) {
  if (!Array.isArray(lists)) return null;
  if (!lists.length) return own ? <section className="bv-profile-lists" aria-labelledby="bv-overview-lists"><h2 id="bv-overview-lists">Lists</h2><p className="bv-muted">Make a list for a series, a theme, or what to read on holiday.</p></section> : null;
  return <section className="bv-profile-lists" aria-labelledby="bv-overview-lists"><h2 id="bv-overview-lists">Lists</h2>
    <ul className="bv-list-rows">{lists.slice(0, 3).map(item => <li key={item.id}><Link className="bv-list-row" to={linkFor(item)}><ListArt compact items={listItems(item)} />
      <span><strong>{item.name}</strong><small><ListMeta item={item} own={own} /></small></span></Link></li>)}</ul>
    {lists.length > 3 && <Button variant="quiet" className="bv-link-button" onClick={onSeeAll}>See all lists</Button>}</section>;
}

function NewList() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [error, setError] = useState(""), [pending, setPending] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setPending(true); setError("");
    try { const created = await createList(name.trim()); navigate(`/profile/lists/${created.id}`); } catch (requestError) {
      setError(requestError?.detail?.code === "list_limit" ? "You’ve reached 50 lists." : "We couldn’t make that list. Please try again."); setPending(false);
    }
  }
  if (!open) return <Button variant="quiet" className="bv-link-button" onClick={() => setOpen(true)}><Plus aria-hidden="true" />New list</Button>;
  return <form className="bv-new-list" onSubmit={submit} aria-busy={pending}>
    <div className="bv-field"><label htmlFor="bv-new-list-name">List name</label><input id="bv-new-list-name" value={name} maxLength={80} autoFocus onChange={event => setName(event.target.value)} /></div>
    {error && <p className="bv-field-error" role="alert">{error}</p>}
    <div className="bv-form-actions"><Button type="submit" disabled={pending || !name.trim()}>Create list</Button><Button variant="quiet" disabled={pending} onClick={() => { setOpen(false); setError(""); }}>Cancel</Button></div>
  </form>;
}

// ---- hub -------------------------------------------------------------------------------------------------------

function Visibility({ profile, announce }) {
  const { save } = useProfile();
  const [asking, setAsking] = useState(false), [error, setError] = useState(""), [pending, setPending] = useState(false);
  async function makePrivate() {
    setPending(true); setError("");
    try { await save({ profile_public: false }); announce("Your profile is now private."); } catch (requestError) { setError(saveMessage(requestError)); }
    setPending(false);
  }
  const Icon = profile.profile_public ? Globe : Lock;
  return <div className="bv-visibility-block"><div className="bv-visibility"><Icon aria-hidden="true" />
    <span>{profile.profile_public ? "Anyone with your link can see your profile" : "Only you can see your profile"}</span>
    <Button variant="quiet" className="bv-link-button bv-visibility-action" disabled={pending} onClick={profile.profile_public ? makePrivate : () => setAsking(true)}>{profile.profile_public ? "Make private" : "Make public"}</Button></div>
    {profile.profile_public && profile.handle && <p className="bv-help">bookvane.me/u/{profile.handle}</p>}
    {error && <p className="bv-field-error" role="alert">{error}</p>}
    <MakePublicSheet profile={profile} open={asking} onClose={() => setAsking(false)} onPublic={() => announce("Your profile is now public.")} />
  </div>;
}

function AccountSection() {
  const auth = useAuth();
  const [leaving, setLeaving] = useState(false), [error, setError] = useState("");
  async function logout() {
    setLeaving(true); setError("");
    try { await auth.logout(); } catch { setError("You couldn’t be signed out. Please try again."); setLeaving(false); }
  }
  return <section className="bv-profile-account" aria-label="Account">
    <Link className="bv-account-link" to="/account">Account settings<ChevronRight aria-hidden="true" /></Link>
    <Button variant="quiet" className="bv-signout" disabled={leaving} onClick={logout}>{leaving ? "Signing out…" : "Sign out"}</Button>
    {error && <p className="bv-field-error" role="alert">{error}</p>}</section>;
}

export function ProfileHubPage() {
  const { profile, loading, failed, reload } = useProfile();
  const stats = useLoad(getStats), lists = useLoad(getLists);
  const [tab, setTab, switched] = useProfileTab();
  const [editing, setEditing] = useState(false), [announcement, setAnnouncement] = useState("");
  if (failed) return <section className="bv-container"><div className="bv-profile"><Failed retry={reload}>We couldn’t load your profile.</Failed><AccountSection /></div></section>;
  if (loading || !profile?.reading_since) return <section className="bv-container" aria-busy="true"><div className="bv-profile"><p role="status" className="bv-muted">Opening your profile…</p><AccountSection /></div></section>;
  const listLink = item => `/profile/lists/${item.id}`;
  return <section className="bv-container"><div className="bv-profile bv-profile--tabs">
    <div className="bv-profile-top">
      <Identity person={profile} handle={profile.handle} size={96}>
        <Visibility profile={profile} announce={setAnnouncement} />
        <Button variant="quiet" className="bv-link-button bv-profile-edit-button" onClick={() => setEditing(true)}>Edit profile</Button>
      </Identity>
      <EditProfileSheet profile={profile} open={editing} onClose={() => setEditing(false)} />
      <p className="bv-sr-only" role="status" aria-live="polite">{announcement}</p>
      <TabBar value={tab} onChange={setTab} />
    </div>
    <TabPanel key={tab} value={tab} settle={switched}>
      {tab === "overview" && <>
        {stats.error ? <Failed retry={stats.retry}>We couldn’t load your year.</Failed> : <><YearFigures stats={stats.data} />{Array.isArray(stats.data?.by_month) && <p className="bv-profile-life-link"><TextLink to="/reading-life">Your reading life</TextLink></p>}</>}
        {lists.error ? <Failed retry={lists.retry}>We couldn’t load your lists.</Failed> : <OverviewLists lists={lists.data} own linkFor={listLink} onSeeAll={() => setTab("lists")} />}</>}
      {tab === "lists" && <section className="bv-profile-lists" aria-labelledby="bv-lists-heading"><div className="bv-profile-lists-head"><h2 id="bv-lists-heading">Your lists</h2><NewList /></div>
        {lists.error ? <Failed retry={lists.retry}>We couldn’t load your lists.</Failed> : Array.isArray(lists.data) && (lists.data.length
          ? <ul className="bv-list-cards">{lists.data.map(item => <ListCard key={item.id} item={item} to={listLink(item)} own />)}</ul>
          : <p className="bv-muted">Make a list for a series, a theme, or what to read on holiday.</p>)}</section>}
      {tab === "year" && (stats.error ? <Failed retry={stats.retry}>We couldn’t load your year.</Failed> : <YearInBooks stats={stats.data} />)}
    </TabPanel>
    <AccountSection />
  </div></section>;
}

// ---- one list --------------------------------------------------------------------------------------------------

function bookStatus(book) {
  if (book.finished_month) return `Finished · ${MONTHS[Number(book.finished_month.slice(5, 7)) - 1] || ""}`.replace(/ · $/, "");
  return { owned: "Owned", want: "Want to read" }[book.status] || "";
}

const artOf = list => list.books.map(book => ({ key: book.id, url: book.cover_image_url }));

function RenameSheet({ list, open, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({ name: list.name, description: list.description || "" }), [pending, setPending] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setPending(true);
    const saved = await onSave({ name: form.name.trim(), description: form.description.trim() || null });
    setPending(false);
    if (saved) onClose();
  }
  return <NativeDialog open={open} onClose={() => !pending && onClose()} title="Rename or delete" className="bv-profile-sheet">
    {open && <form className="bv-profile-edit" onSubmit={submit} aria-busy={pending}>
      <div className="bv-field"><label htmlFor="bv-list-name">List name</label><input id="bv-list-name" value={form.name} maxLength={80} onChange={event => setForm({ ...form, name: event.target.value })} /></div>
      <div className="bv-field"><label htmlFor="bv-list-description">Description</label><textarea id="bv-list-description" rows={3} value={form.description} maxLength={280} aria-describedby="bv-list-description-count" onChange={event => setForm({ ...form, description: event.target.value })} /><small id="bv-list-description-count">{form.description.length}/280</small></div>
      <div className="bv-sheet-actions bv-sheet-actions--pinned"><Button type="submit" disabled={pending || !form.name.trim()}>Save</Button>
        <Button variant="quiet" className="bv-danger-action" disabled={pending} onClick={onDelete}>Delete list</Button></div></form>}
  </NativeDialog>;
}

export function ProfileListPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const load = useLoad(() => getList(id));
  const [editing, setEditing] = useState(false), [renaming, setRenaming] = useState(false), [error, setError] = useState(""), [announce, setAnnounce] = useState("");
  const [confirming, setConfirming] = useState(false), [pending, setPending] = useState(false), [undo, setUndo] = useState(null);
  const [focus, setFocus] = useState(null);
  const queue = useRef(Promise.resolve());
  const rows = useRef(null), before = useRef(null), entering = useRef(null);
  const list = load.data;
  const rowOf = bookId => rows.current?.querySelector(`[data-row="${bookId}"]`);
  useEffect(() => {
    if (!focus) return;
    const buttons = [...document.querySelectorAll(`[data-move^="${focus.id}:"]`)];
    (buttons.find(button => button.dataset.move === `${focus.id}:${focus.dir}` && !button.disabled) || buttons.find(button => !button.disabled))?.focus();
  }, [focus, list?.books]);
  // A moved row slides from where it was; a restored row opens up in place.
  useLayoutEffect(() => {
    if (before.current && rows.current) {
      for (const item of rows.current.querySelectorAll("[data-row]")) {
        const from = before.current.get(item.dataset.row), distance = from === undefined ? 0 : from - item.getBoundingClientRect().top;
        if (distance) slideFrom(item, distance);
      }
      before.current = null;
    }
    if (entering.current !== null) { const item = rowOf(entering.current); entering.current = null; if (item) expand(item); }
  }, [list?.books]);
  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(timer);
  }, [undo]);
  if (load.error) return <section className="bv-container"><div className="bv-profile">{load.error.status === 404 ? <p role="alert">This list isn’t here.</p> : <Failed retry={load.retry}>We couldn’t load this list.</Failed>}<p><TextLink to="/profile"><ChevronLeft aria-hidden="true" />Your lists</TextLink></p></div></section>;
  if (!list) return <section className="bv-container" aria-busy="true"><div className="bv-profile"><p role="status" className="bv-muted">Opening your list…</p></div></section>;
  const name = profile?.display_name;
  async function change(changes) {
    setError("");
    try { await updateList(id, changes); load.set(current => ({ ...current, ...changes })); return true; } catch { setError("We couldn’t save that. Please try again."); return false; }
  }
  function move(index, delta) {
    const target = index + delta, next = [...list.books];
    if (target < 0 || target >= next.length) return;
    before.current = new Map([...rows.current.querySelectorAll("[data-row]")].map(item => [item.dataset.row, item.getBoundingClientRect().top]));
    [next[index], next[target]] = [next[target], next[index]];
    load.set(current => ({ ...current, books: next }));
    setFocus({ id: next[target].id, dir: delta < 0 ? "up" : "down" });
    setAnnounce(`${next[target].title} moved to position ${target + 1} of ${next.length}.`); setError("");
    queue.current = queue.current.then(() => orderList(id, next.map(book => book.id))).catch(() => {
      setError("We couldn’t save the new order. It has been put back."); setAnnounce(""); load.retry();
    });
  }
  async function remove(book, index) {
    setError(""); setFocus(null);
    const item = rowOf(book.id);
    const [removed] = await Promise.all([removeListBook(id, book.id).then(() => true, () => false), item ? collapse(item) : wait(0)]);
    if (!removed) { item?.getAnimations().forEach(animation => animation.cancel()); setError("We couldn’t remove that book. Please try again."); return; }
    load.set(current => ({ ...current, books: current.books.filter(entry => entry.id !== book.id) }));
    setAnnounce(`${book.title} removed from this list.`); setUndo({ book, index });
  }
  async function putBack() {
    const { book, index } = undo;
    setUndo(null);
    try {
      await queue.current;
      await addListBook(id, book.id);
      const next = list.books.filter(entry => entry.id !== book.id);
      next.splice(Math.min(index, next.length), 0, book);
      await orderList(id, next.map(entry => entry.id));
      entering.current = book.id;
      load.set(current => ({ ...current, books: next }));
      setAnnounce(`${book.title} put back in position ${next.indexOf(book) + 1}.`);
    } catch { setError("We couldn’t put that back. Please try again."); load.retry(); }
  }
  async function destroy() {
    setPending(true);
    try { await deleteList(id); navigate("/profile"); } catch { setConfirming(false); setPending(false); setError("We couldn’t delete this list. Please try again."); }
  }
  return <section className="bv-container"><div className={`bv-profile bv-profile-list${editing ? " is-editing" : ""}`}>
    <p className="bv-profile-back"><TextLink to="/profile"><ChevronLeft aria-hidden="true" />Your lists</TextLink>
      {editing ? <Button onClick={() => setEditing(false)}>Done</Button> : <Button variant="quiet" className="bv-link-button" onClick={() => setEditing(true)}>Edit</Button>}</p>
    <ListArt tall items={artOf(list)} />
    <h1>{list.name}</h1>
    {list.description && <p className="bv-profile-bio">{list.description}</p>}
    <p className="bv-muted">{books(list.books.length)}{name ? ` · by ${name}` : ""}</p>
    {editing && <p className="bv-list-rename"><Button variant="quiet" className="bv-link-button" onClick={() => setRenaming(true)}>Rename or delete</Button></p>}
    <div className="bv-visibility-block"><div className="bv-visibility">{list.is_public ? <Globe aria-hidden="true" /> : <Lock aria-hidden="true" />}
      <span>{list.is_public ? "Shared on your profile" : "Only you can see this list"}</span>
      <Button variant="quiet" className="bv-link-button bv-visibility-action" onClick={() => change({ is_public: !list.is_public })}>{list.is_public ? "Make private" : "Share on your profile"}</Button></div>
      {list.is_public && profile && !profile.profile_public && <p className="bv-help">Your profile is private, so no one can see it yet.</p>}</div>
    {error && <p className="bv-field-error" role="alert">{error}</p>}
    <p className="bv-sr-only" role="status" aria-live="polite">{announce}</p>
    {list.books.length > 0 && <ol className="bv-list-books" ref={rows}>{list.books.map((book, index) => <li key={book.id} data-row={book.id}>
      <span className="bv-list-number" aria-hidden="true">{index + 1}</span>
      <ListCover book={book} />
      <span className="bv-list-book-text"><Link to={`/book/${book.id}`}>{book.title}</Link>{bookStatus(book) && <small>{bookStatus(book)}</small>}</span>
      {editing && <span className="bv-list-controls">
        <Button variant="quiet" className="bv-icon-button" data-move={`${book.id}:up`} disabled={index === 0} aria-label={`Move ${book.title} up`} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></Button>
        <Button variant="quiet" className="bv-icon-button" data-move={`${book.id}:down`} disabled={index === list.books.length - 1} aria-label={`Move ${book.title} down`} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></Button>
        <Button variant="quiet" className="bv-icon-button" aria-label={`Remove ${book.title} from this list`} onClick={() => remove(book, index)}><X aria-hidden="true" /></Button></span>}
    </li>)}</ol>}
    <p className="bv-list-add"><TextLink to="/my-books"><Plus aria-hidden="true" />Add a book</TextLink></p>
    <p className="bv-help">Open a book and choose Add to list.</p>
    {undo && <div className="bv-undo-toast" role="status"><span>Removed {undo.book.title}.</span><Button variant="quiet" onClick={putBack}>Undo</Button></div>}
    <RenameSheet key={`${list.name}|${list.description}`} list={list} open={renaming} onClose={() => setRenaming(false)} onSave={change} onDelete={() => { setRenaming(false); setConfirming(true); }} />
    <NativeDialog open={confirming} onClose={() => !pending && setConfirming(false)} title="Delete this list?">
      <p>Delete this list? The books stay in your library.</p>
      <div className="bv-form-actions"><Button disabled={pending} onClick={destroy}>{pending ? "Deleting…" : "Delete list"}</Button><Button variant="quiet" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button></div>
    </NativeDialog>
  </div></section>;
}

// ---- public pages ----------------------------------------------------------------------------------------------

function GuestLine() {
  const auth = useAuth();
  if (auth.isLoading || auth.isAuthenticated) return null;
  return <aside className="bv-profile-join"><p>Keep your own reading year on Bookvane.</p><ActionLink to="/register?src=profile">Create free account</ActionLink></aside>;
}

export function PublicProfilePage({ handle: given, notFound }) {
  const params = useParams(), handle = given || params.handle;
  const { profile } = useProfile();
  const [tab, setTab, switched] = useProfileTab();
  const load = useLoad(() => getPublicProfile(handle));
  if (load.error) return load.error.status === 404 ? <NotFound page={notFound} /> : <section className="bv-container"><div className="bv-profile"><Failed retry={load.retry}>We couldn’t load this profile.</Failed></div></section>;
  if (!load.data) return <section className="bv-container" aria-busy="true"><div className="bv-profile"><p role="status" className="bv-muted">Opening profile…</p></div></section>;
  const page = load.data, own = profile?.handle === handle;
  const listLink = item => `/u/${handle}/lists/${item.id}`;
  return <section className="bv-container"><div className="bv-profile bv-profile--tabs">
    <div className="bv-profile-top">
      <Identity person={page} handle={handle} size={96}>{own && <p className="bv-help">This is how others see your profile.</p>}</Identity>
      <TabBar value={tab} onChange={setTab} />
    </div>
    <TabPanel key={tab} value={tab} settle={switched}>
      {tab === "overview" && <><YearFigures stats={page.stats} own={false} /><OverviewLists lists={page.lists} own={false} linkFor={listLink} onSeeAll={() => setTab("lists")} /></>}
      {tab === "lists" && (page.lists.length > 0
        ? <section className="bv-profile-lists" aria-labelledby="bv-lists-heading"><div className="bv-profile-lists-head"><h2 id="bv-lists-heading">Lists</h2></div>
          <ul className="bv-list-cards">{page.lists.map(item => <ListCard key={item.id} item={item} to={listLink(item)} />)}</ul></section>
        : <p className="bv-muted">No public lists yet.</p>)}
      {tab === "year" && <YearInBooks stats={page.stats} own={false} chips={false} />}
    </TabPanel>
    <GuestLine />
  </div></section>;
}

export function PublicListPage({ notFound }) {
  const { handle, id } = useParams();
  const load = useLoad(() => getPublicList(handle, id));
  if (load.error) return load.error.status === 404 ? <NotFound page={notFound} /> : <section className="bv-container"><div className="bv-profile"><Failed retry={load.retry}>We couldn’t load this list.</Failed></div></section>;
  if (!load.data) return <section className="bv-container" aria-busy="true"><div className="bv-profile"><p role="status" className="bv-muted">Opening list…</p></div></section>;
  const list = load.data;
  return <section className="bv-container"><div className="bv-profile bv-profile-list">
    <p className="bv-profile-back"><TextLink to={`/u/${handle}`}><ChevronLeft aria-hidden="true" />{list.owner.display_name || `@${handle}`}</TextLink></p>
    <ListArt tall items={artOf(list)} />
    <h1>{list.name}</h1>{list.description && <p className="bv-profile-bio">{list.description}</p>}
    <p className="bv-muted">{books(list.books.length)} · by {list.owner.display_name || `@${handle}`}</p>
    {list.books.length > 0 && <ol className="bv-list-books">{list.books.map((book, index) => <li key={book.id}>
      <span className="bv-list-number" aria-hidden="true">{index + 1}</span>
      <ListCover book={book} />
      <span className="bv-list-book-text"><Link to={`/book/${book.id}`}>{book.title}</Link>{book.authors?.length > 0 && <small>{book.authors.join(", ")}</small>}</span></li>)}</ol>}
    <GuestLine />
  </div></section>;
}

// ---- the one-time sheet ----------------------------------------------------------------------------------------

// Closing the sheet counts as "not now". The answer is also kept in this browser, so it stays closed on the next page and on
// reload even if saving it to the profile failed or is slow.
const PROMPT_KEY = "bv-profile-prompt-answered";
const promptAnswered = () => { try { return localStorage.getItem(PROMPT_KEY) === "1"; } catch { return false; } };
const rememberAnswer = () => { try { localStorage.setItem(PROMPT_KEY, "1"); } catch { /* private mode */ } };

export function ProfilePrompt() {
  const { profile, save } = useProfile();
  const reader = useReader();
  const location = useLocation();
  const [asking, setAsking] = useState(false), [handle, setHandle] = useState(""), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const [dismissed, setDismissed] = useState(promptAnswered);
  const quiet = ["/login", "/register", "/forgot-password", "/reset-password"].includes(location.pathname) || location.pathname.startsWith("/my-books/import") || Boolean(reader.gate);
  const open = Boolean(profile?.show_prompt) && !dismissed && !quiet;
  async function finish(changes) {
    setPending(true); setError("");
    try { await save({ ...changes, prompted: true }); rememberAnswer(); setDismissed(true); } catch (requestError) {
      if (changes.profile_public) { setError(saveMessage(requestError)); setPending(false); return; }
      rememberAnswer(); setDismissed(true);
    }
    setPending(false);
  }
  function makePublic(event) {
    event.preventDefault();
    if (profile.handle) { finish({ profile_public: true }); return; }
    if (!asking) { setAsking(true); return; }
    if (!HANDLE.test(handle)) { setError(HANDLE_ERROR); return; }
    finish({ handle, profile_public: true });
  }
  return <NativeDialog open={open} onClose={() => !pending && finish({})} title="Let friends find you?" className="bv-profile-sheet" focusTitle>
    <p>A public profile lets people see your reading year and the lists you choose to share.</p>
    <SheetFacts />
    {asking && <form onSubmit={makePublic}><HandleField id="bv-sheet-handle" value={handle} error={error} onChange={setHandle} /></form>}
    {error && !asking && <p className="bv-field-error" role="alert">{error}</p>}
    <div className="bv-sheet-actions"><Button disabled={pending} className="bv-full-width" onClick={() => finish({})}>Keep my profile private</Button>
      <Button variant="secondary" disabled={pending} className="bv-full-width" onClick={makePublic}>Make it public</Button></div>
    <p className="bv-help">You can change this any time from your profile.</p>
  </NativeDialog>;
}
