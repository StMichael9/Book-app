import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronLeft, Globe, Lock, Plus } from "lucide-react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { coverSrc } from "../../api/coverUrl.js";
import { createList, deleteList, getList, getLists, getPublicList, getPublicProfile, getStats, orderList, removeListBook, updateList } from "../../api/profile.js";
import { useReader } from "../ui-v2/readerState.js";
import { ActionLink, BookCover, Button, NativeDialog, TextLink } from "../ui-v2/primitives.jsx";
import { useProfile } from "./profileState.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HANDLE = /^[a-z0-9-]{3,30}$/;
const books = count => `${count} ${count === 1 ? "book" : "books"}`;

function saveMessage(error) {
  const code = error?.detail?.code;
  if (code === "handle_taken") return "That username is taken.";
  if (code === "handle_reserved") return "That username isn’t available.";
  if (code?.startsWith("handle_")) return "Use 3–30 lowercase letters, numbers or hyphens.";
  return "We couldn’t save that. Please try again.";
}

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

function Avatar({ initials }) { return <span className="bv-avatar" aria-hidden="true">{initials || "?"}</span>; }

export function CoverStack({ covers = [], name = "", large = false }) {
  const size = large ? " bv-stack--large" : "";
  if (!covers.length) return <span className={`bv-stack bv-stack--empty${size}`} aria-hidden="true"><b>{name.trim()[0]?.toUpperCase() || "·"}</b></span>;
  return <span className={`bv-stack${size}`} aria-hidden="true">{covers.slice(0, 3).map(url => <img key={url} src={coverSrc(url)} alt="" loading="lazy" decoding="async" />)}</span>;
}

// A small cover; a book with no artwork shows its initial on a tile, like the list stack does.
function ListCover({ book }) {
  return <span className="bv-list-cover">{book.cover_image_url ? <BookCover book={{ ...book, authors: [] }} /> : <span className="bv-list-initial" aria-hidden="true">{book.title?.trim()[0]?.toUpperCase() || "·"}</span>}</span>;
}

function HandleField({ value, onChange, error, id }) {
  return <div className="bv-field"><label htmlFor={id}>Username</label>
    <input id={id} value={value} maxLength={30} autoCapitalize="none" autoCorrect="off" spellCheck="false" autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={`${id}-help`} onChange={event => onChange(event.target.value.toLowerCase())} />
    <small id={`${id}-help`}>3–30 lowercase letters, numbers or hyphens.</small>
    {error && <p className="bv-field-error" role="alert">{error}</p>}</div>;
}

// ---- the year in books (own and public) ------------------------------------------------------------------------

export function YearInBooks({ stats, own = true, chips = true }) {
  if (!Array.isArray(stats?.by_month)) return null;
  const empty = !stats.books_finished;
  if (empty && !own) return null;
  const top = Math.max(...stats.by_month, 1);
  const finished = <><strong>{books(stats.books_finished)}</strong> and <strong>{stats.pages_read.toLocaleString("en-US")} {stats.pages_read === 1 ? "page" : "pages"}</strong></>;
  return <section className="bv-profile-year" aria-labelledby="bv-year-heading"><h2 id="bv-year-heading">{own ? `Your ${stats.year} in books` : `${stats.year} in books`}</h2>
    {empty ? <p className="bv-muted">Finish a book this year and it’ll show up here.</p> : <>
      <p>{own ? "You’ve finished " : "Finished "}{finished} this year.{stats.biggest_month ? ` ${MONTHS[stats.biggest_month - 1]} was ${own ? "your" : "their"} biggest month.` : ""}</p>
      <div className="bv-year-bars" aria-hidden="true">{stats.by_month.map((count, index) => <div key={index} className={`bv-year-bar${index + 1 === stats.biggest_month ? " is-top" : ""}`}>
        <i style={{ height: count ? `${Math.max(12, Math.round(count / top * 100))}%` : "3px" }} /><small>{"JFMAMJJASOND"[index]}</small></div>)}</div>
      <ul className="bv-sr-only">{stats.by_month.map((count, index) => <li key={index}>{MONTHS[index]}: {count}</li>)}</ul>
      {chips && stats.top_genres?.length > 0 && <ul className="bv-year-chips">{stats.top_genres.map(genre => <li key={genre.name}>{genre.name} · {genre.count}</li>)}</ul>}</>}
  </section>;
}

// ---- hub -------------------------------------------------------------------------------------------------------

function EditProfile({ profile, onDone }) {
  const { save } = useProfile();
  const [form, setForm] = useState({ display_name: profile.display_name || "", handle: profile.handle || "", bio: profile.bio || "" });
  const [error, setError] = useState(""), [pending, setPending] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const changes = {};
    for (const field of ["display_name", "handle", "bio"]) if (form[field].trim() !== (profile[field] || "")) changes[field] = form[field].trim();
    if (changes.handle && !HANDLE.test(changes.handle)) { setError("Use 3–30 lowercase letters, numbers or hyphens."); return; }
    if (!Object.keys(changes).length) { onDone(); return; }
    setPending(true); setError("");
    try { await save(changes); onDone(); } catch (requestError) { setError(saveMessage(requestError)); setPending(false); }
  }
  const handleError = error && /username|lowercase/.test(error) ? error : "";
  return <form className="bv-profile-edit" onSubmit={submit} aria-busy={pending}>
    <div className="bv-field"><label htmlFor="bv-profile-name">Name</label><input id="bv-profile-name" value={form.display_name} maxLength={40} placeholder="Add your name" autoComplete="name" onChange={event => setForm({ ...form, display_name: event.target.value })} /></div>
    <HandleField id="bv-profile-handle" value={form.handle} error={handleError} onChange={handle => setForm({ ...form, handle })} />
    <div className="bv-field"><label htmlFor="bv-profile-bio">Bio</label><textarea id="bv-profile-bio" rows={3} value={form.bio} maxLength={160} aria-describedby="bv-profile-bio-count" onChange={event => setForm({ ...form, bio: event.target.value })} /><small id="bv-profile-bio-count">{form.bio.length}/160</small></div>
    {error && !handleError && <p className="bv-field-error" role="alert">{error}</p>}
    <div className="bv-form-actions"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button><Button variant="quiet" disabled={pending} onClick={onDone}>Cancel</Button></div>
  </form>;
}

function Visibility({ profile }) {
  const { save } = useProfile();
  const [asking, setAsking] = useState(false), [handle, setHandle] = useState(profile.handle || "");
  const [error, setError] = useState(""), [pending, setPending] = useState(false);
  const input = useRef(null);
  useEffect(() => { if (asking) input.current?.querySelector("input")?.focus(); }, [asking]);
  async function change(changes) {
    setPending(true); setError("");
    try { await save(changes); setAsking(false); } catch (requestError) {
      if (requestError?.detail?.code === "handle_required") setAsking(true);
      else setError(saveMessage(requestError));
    }
    setPending(false);
  }
  function makePublic(event) {
    event?.preventDefault();
    if (!profile.handle && !asking) { setAsking(true); return; }
    if (asking && !HANDLE.test(handle)) { setError("Use 3–30 lowercase letters, numbers or hyphens."); return; }
    change({ ...(asking ? { handle } : {}), profile_public: true });
  }
  const Icon = profile.profile_public ? Globe : Lock;
  return <div className="bv-visibility-block"><div className="bv-visibility"><Icon aria-hidden="true" />
    <span>{profile.profile_public ? "Anyone with your link can see your profile" : "Only you can see your profile"}</span>
    <Button variant="quiet" className="bv-visibility-action" disabled={pending} onClick={profile.profile_public ? () => change({ profile_public: false }) : makePublic}>{profile.profile_public ? "Make private" : "Make public"}</Button></div>
    {profile.profile_public && profile.handle && <p className="bv-help">bookvane.me/u/{profile.handle}</p>}
    {asking && !profile.profile_public && <form ref={input} className="bv-visibility-form" onSubmit={makePublic}>
      <HandleField id="bv-visibility-handle" value={handle} error={error && /username|lowercase/.test(error) ? error : ""} onChange={setHandle} />
      <div className="bv-form-actions"><Button type="submit" disabled={pending}>Make public</Button><Button variant="quiet" disabled={pending} onClick={() => { setAsking(false); setError(""); }}>Cancel</Button></div></form>}
    {error && !/username|lowercase/.test(error) && <p className="bv-field-error" role="alert">{error}</p>}
  </div>;
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
  if (!open) return <Button variant="quiet" className="bv-profile-link" onClick={() => setOpen(true)}><Plus aria-hidden="true" />New list</Button>;
  return <form className="bv-new-list" onSubmit={submit} aria-busy={pending}>
    <div className="bv-field"><label htmlFor="bv-new-list-name">List name</label><input id="bv-new-list-name" value={name} maxLength={80} autoFocus onChange={event => setName(event.target.value)} /></div>
    {error && <p className="bv-field-error" role="alert">{error}</p>}
    <div className="bv-form-actions"><Button type="submit" disabled={pending || !name.trim()}>Create list</Button><Button variant="quiet" disabled={pending} onClick={() => { setOpen(false); setError(""); }}>Cancel</Button></div>
  </form>;
}

function ListRow({ item, to, own }) {
  const Icon = item.is_public ? Globe : Lock;
  return <li><Link className="bv-list-row" to={to}><CoverStack covers={item.covers} name={item.name} />
    <span className="bv-list-row-text"><strong>{item.name}</strong><small>{books(item.book_count)}{own && item.is_public ? " · shared" : ""}</small></span>
    {own && <Icon role="img" aria-label={item.is_public ? "Shared on your profile" : "Private list"} />}</Link></li>;
}

export function ProfileHubPage() {
  const { profile, loading, failed, reload } = useProfile();
  const stats = useLoad(getStats), lists = useLoad(getLists);
  const [editing, setEditing] = useState(false);
  if (failed) return <section className="bv-container"><div className="bv-profile"><Failed retry={reload}>We couldn’t load your profile.</Failed><p className="bv-profile-account"><TextLink to="/account">Account settings</TextLink></p></div></section>;
  if (loading || !profile?.reading_since) return <section className="bv-container" aria-busy="true"><div className="bv-profile"><p role="status" className="bv-muted">Opening your profile…</p><p className="bv-profile-account"><TextLink to="/account">Account settings</TextLink></p></div></section>;
  return <section className="bv-container"><div className="bv-profile">
    <header className="bv-profile-head"><Avatar initials={profile.initials} />
      <div className="bv-profile-id">{profile.display_name ? <h1>{profile.display_name}</h1> : <h1 className="bv-sr-only">Your profile</h1>}
        <p className="bv-muted">{profile.handle ? `@${profile.handle} · ` : ""}reading since {profile.reading_since}</p></div>
      {!editing && <Button variant="quiet" className="bv-profile-edit-button" onClick={() => setEditing(true)}>Edit profile</Button>}</header>
    {editing ? <EditProfile profile={profile} onDone={() => setEditing(false)} /> : profile.bio && <p className="bv-profile-bio">{profile.bio}</p>}
    <Visibility key={profile.profile_public ? "public" : "private"} profile={profile} />
    {stats.error ? <Failed retry={stats.retry}>We couldn’t load your year.</Failed> : <YearInBooks stats={stats.data} />}
    <section className="bv-profile-lists" aria-labelledby="bv-lists-heading"><div className="bv-profile-lists-head"><h2 id="bv-lists-heading">Your lists</h2><NewList /></div>
      {lists.error ? <Failed retry={lists.retry}>We couldn’t load your lists.</Failed> : Array.isArray(lists.data) && (lists.data.length
        ? <ul className="bv-list-rows">{lists.data.map(item => <ListRow key={item.id} item={item} to={`/profile/lists/${item.id}`} own />)}</ul>
        : <p className="bv-muted">Make a list for a series, a theme, or what to read on holiday.</p>)}</section>
    <p className="bv-profile-account"><TextLink to="/account">Account settings</TextLink></p>
  </div></section>;
}

// ---- one list --------------------------------------------------------------------------------------------------

function bookStatus(book) {
  if (book.finished_month) return `Finished · ${MONTHS[Number(book.finished_month.slice(5, 7)) - 1] || ""}`.replace(/ · $/, "");
  return { owned: "Owned", want: "Want to read" }[book.status] || "";
}

export function ProfileListPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const load = useLoad(() => getList(id));
  const [editing, setEditing] = useState(false), [error, setError] = useState(""), [announce, setAnnounce] = useState("");
  const [form, setForm] = useState({ name: "", description: "" }), [confirming, setConfirming] = useState(false), [pending, setPending] = useState(false);
  const [focus, setFocus] = useState(null);
  const queue = useRef(Promise.resolve());
  const list = load.data;
  useEffect(() => {
    if (!focus) return;
    const buttons = [...document.querySelectorAll(`[data-move^="${focus.id}:"]`)];
    (buttons.find(button => button.dataset.move === `${focus.id}:${focus.dir}` && !button.disabled) || buttons.find(button => !button.disabled))?.focus();
  }, [focus, list?.books]);
  if (load.error) return <section className="bv-container"><div className="bv-profile">{load.error.status === 404 ? <p role="alert">This list isn’t here.</p> : <Failed retry={load.retry}>We couldn’t load this list.</Failed>}<p><TextLink to="/profile"><ChevronLeft aria-hidden="true" />Your lists</TextLink></p></div></section>;
  if (!list) return <section className="bv-container" aria-busy="true"><div className="bv-profile"><p role="status" className="bv-muted">Opening your list…</p></div></section>;
  const name = profile?.display_name;
  function startEditing() { setForm({ name: list.name, description: list.description || "" }); setError(""); setEditing(true); }
  async function change(changes) {
    setError("");
    try { await updateList(id, changes); load.set(current => ({ ...current, ...changes })); return true; } catch { setError("We couldn’t save that. Please try again."); return false; }
  }
  async function saveDetails(event) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setPending(true);
    await change({ name: form.name.trim(), description: form.description.trim() || null });
    setPending(false);
  }
  function move(index, delta) {
    const target = index + delta, next = [...list.books];
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    load.set(current => ({ ...current, books: next }));
    setFocus({ id: next[target].id, dir: delta < 0 ? "up" : "down" });
    setAnnounce(`${next[target].title} moved to position ${target + 1} of ${next.length}.`); setError("");
    queue.current = queue.current.then(() => orderList(id, next.map(book => book.id))).catch(() => {
      setError("We couldn’t save the new order. It has been put back."); setAnnounce(""); load.retry();
    });
  }
  async function remove(book) {
    setError(""); setFocus(null);
    try { await removeListBook(id, book.id); load.set(current => ({ ...current, books: current.books.filter(item => item.id !== book.id) })); setAnnounce(`${book.title} removed from this list.`); }
    catch { setError("We couldn’t remove that book. Please try again."); }
  }
  async function destroy() {
    setPending(true);
    try { await deleteList(id); navigate("/profile"); } catch { setConfirming(false); setPending(false); setError("We couldn’t delete this list. Please try again."); }
  }
  return <section className="bv-container"><div className="bv-profile bv-profile-list">
    <p className="bv-profile-back"><TextLink to="/profile"><ChevronLeft aria-hidden="true" />Your lists</TextLink>
      <Button variant="quiet" className="bv-profile-edit-button" onClick={() => editing ? setEditing(false) : startEditing()}>{editing ? "Done" : "Edit"}</Button></p>
    <CoverStack large name={list.name} covers={list.books.map(book => book.cover_image_url).filter(Boolean)} />
    <h1>{list.name}</h1>
    {editing ? <form className="bv-profile-edit" onSubmit={saveDetails} aria-busy={pending}>
      <div className="bv-field"><label htmlFor="bv-list-name">List name</label><input id="bv-list-name" value={form.name} maxLength={80} onChange={event => setForm({ ...form, name: event.target.value })} /></div>
      <div className="bv-field"><label htmlFor="bv-list-description">Description</label><textarea id="bv-list-description" rows={3} value={form.description} maxLength={280} aria-describedby="bv-list-description-count" onChange={event => setForm({ ...form, description: event.target.value })} /><small id="bv-list-description-count">{form.description.length}/280</small></div>
      <div className="bv-form-actions"><Button type="submit" disabled={pending || !form.name.trim()}>Save details</Button></div></form>
      : list.description && <p className="bv-profile-bio">{list.description}</p>}
    <p className="bv-muted">{books(list.books.length)}{name ? ` · by ${name}` : ""}</p>
    <div className="bv-visibility-block"><div className="bv-visibility">{list.is_public ? <Globe aria-hidden="true" /> : <Lock aria-hidden="true" />}
      <span>{list.is_public ? "Shared on your profile" : "Only you can see this list"}</span>
      <Button variant="quiet" className="bv-visibility-action" onClick={() => change({ is_public: !list.is_public })}>{list.is_public ? "Make private" : "Share on your profile"}</Button></div>
      {list.is_public && profile && !profile.profile_public && <p className="bv-help">Your profile is private, so no one can see it yet.</p>}</div>
    {error && <p className="bv-field-error" role="alert">{error}</p>}
    <p className="bv-sr-only" role="status" aria-live="polite">{announce}</p>
    {list.books.length > 0 && <ol className="bv-list-books">{list.books.map((book, index) => <li key={book.id}>
      <span className="bv-list-number" aria-hidden="true">{index + 1}</span>
      <ListCover book={book} />
      <span className="bv-list-book-text"><Link to={`/book/${book.id}`}>{book.title}</Link>{bookStatus(book) && <small>{bookStatus(book)}</small>}</span>
      {editing && <span className="bv-list-controls">
        <Button variant="quiet" className="bv-icon-button" data-move={`${book.id}:up`} disabled={index === 0} aria-label={`Move ${book.title} up`} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></Button>
        <Button variant="quiet" className="bv-icon-button" data-move={`${book.id}:down`} disabled={index === list.books.length - 1} aria-label={`Move ${book.title} down`} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></Button>
        <Button variant="quiet" aria-label={`Remove ${book.title} from this list`} onClick={() => remove(book)}>Remove</Button></span>}
    </li>)}</ol>}
    <p className="bv-list-add"><TextLink to="/my-books"><Plus aria-hidden="true" />Add a book</TextLink></p>
    <p className="bv-help">Open a book and choose Add to list.</p>
    {editing && <div className="bv-list-delete"><Button variant="quiet" className="bv-danger-action" onClick={() => setConfirming(true)}>Delete list</Button></div>}
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
  const load = useLoad(() => getPublicProfile(handle));
  if (load.error) return load.error.status === 404 ? notFound : <section className="bv-container"><div className="bv-profile"><Failed retry={load.retry}>We couldn’t load this profile.</Failed></div></section>;
  if (!load.data) return <section className="bv-container" aria-busy="true"><div className="bv-profile"><p role="status" className="bv-muted">Opening profile…</p></div></section>;
  const page = load.data, own = profile?.handle === handle;
  return <section className="bv-container"><div className="bv-profile">
    <header className="bv-profile-head"><Avatar initials={page.initials} />
      <div className="bv-profile-id"><h1>{page.display_name || `@${handle}`}</h1><p className="bv-muted">{page.display_name ? `@${handle} · ` : ""}reading since {page.reading_since}</p></div></header>
    {own && <p className="bv-help">This is how others see your profile.</p>}
    {page.bio && <p className="bv-profile-bio">{page.bio}</p>}
    <YearInBooks stats={page.stats} own={false} chips={false} />
    {page.lists.length > 0 && <section className="bv-profile-lists" aria-labelledby="bv-lists-heading"><div className="bv-profile-lists-head"><h2 id="bv-lists-heading">Lists</h2></div>
      <ul className="bv-list-rows">{page.lists.map(item => <ListRow key={item.id} item={item} to={`/u/${handle}/lists/${item.id}`} />)}</ul></section>}
    <GuestLine />
  </div></section>;
}

export function PublicListPage({ notFound }) {
  const { handle, id } = useParams();
  const load = useLoad(() => getPublicList(handle, id));
  if (load.error) return load.error.status === 404 ? notFound : <section className="bv-container"><div className="bv-profile"><Failed retry={load.retry}>We couldn’t load this list.</Failed></div></section>;
  if (!load.data) return <section className="bv-container" aria-busy="true"><div className="bv-profile"><p role="status" className="bv-muted">Opening list…</p></div></section>;
  const list = load.data;
  return <section className="bv-container"><div className="bv-profile bv-profile-list">
    <p className="bv-profile-back"><TextLink to={`/u/${handle}`}><ChevronLeft aria-hidden="true" />{list.owner.display_name || `@${handle}`}</TextLink></p>
    <CoverStack large name={list.name} covers={list.books.map(book => book.cover_image_url).filter(Boolean)} />
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

export function ProfilePrompt() {
  const { profile, save } = useProfile();
  const reader = useReader();
  const location = useLocation();
  const [asking, setAsking] = useState(false), [handle, setHandle] = useState(""), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const quiet = ["/login", "/register", "/forgot-password", "/reset-password"].includes(location.pathname) || location.pathname.startsWith("/my-books/import") || Boolean(reader.gate);
  const open = Boolean(profile?.show_prompt) && !dismissed && !quiet;
  async function finish(changes) {
    setPending(true); setError("");
    try { await save({ ...changes, prompted: true }); setDismissed(true); } catch (requestError) {
      if (changes.profile_public) { setError(saveMessage(requestError)); setPending(false); return; }
      setDismissed(true);
    }
    setPending(false);
  }
  function makePublic(event) {
    event.preventDefault();
    if (profile.handle) { finish({ profile_public: true }); return; }
    if (!asking) { setAsking(true); return; }
    if (!HANDLE.test(handle)) { setError("Use 3–30 lowercase letters, numbers or hyphens."); return; }
    finish({ handle, profile_public: true });
  }
  return <NativeDialog open={open} onClose={() => !pending && finish({})} title="Let friends find you?" className="bv-profile-sheet" focusTitle>
    <p>A public profile lets people see your reading year and the lists you choose to share.</p>
    <ul className="bv-sheet-facts"><li><span aria-hidden="true">✓</span>Shown: your name, bio, yearly stats, and shared lists</li><li><Lock aria-hidden="true" />Always private: notes, ratings, reading history, and private lists</li></ul>
    {asking && <form onSubmit={makePublic}><HandleField id="bv-sheet-handle" value={handle} error={error} onChange={setHandle} /></form>}
    {error && !asking && <p className="bv-field-error" role="alert">{error}</p>}
    <div className="bv-sheet-actions"><Button disabled={pending} className="bv-full-width" onClick={() => finish({})}>Keep my profile private</Button>
      <Button variant="secondary" disabled={pending} className="bv-full-width" onClick={makePublic}>Make it public</Button></div>
    <p className="bv-help">You can change this any time from your profile.</p>
  </NativeDialog>;
}
