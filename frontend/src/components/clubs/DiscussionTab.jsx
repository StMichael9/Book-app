import { useState } from "react";
import { deletePost, getPosts } from "../../api/clubs.js";
import { useRequest } from "../ui-v2/data.js";
import { Button } from "../ui-v2/primitives.jsx";
import ClubMenu from "./ClubMenu.jsx";
import { ConfirmSheet } from "./ClubSheets.jsx";
import { EditPostSheet, ReportSheet, WritePostSheet } from "./PostSheets.jsx";
import { ago, positionLabel } from "./clubFormat.js";
import { CANCEL, CANT_UNDO, DELETE_POST, DELETE_POST_TITLE, EDIT_POST, NO_POSTS, NO_SPOILERS_META, OLDER_POSTS, REMOVE_POST, REPORTED, REPORT_POST, UPDATE_MY_PAGE, WRITE_A_POST, YOU, removePostTitle, unlockAt, upTo } from "./clubCopy.js";

// One post: who, how far it is up to (or "no spoilers"), when, and its own "…": your posts can be edited or deleted; other people's reported, and
// removed too by owners and admins.
function Post({ post, clubId, isMod, onChanged, onReported }) {
  const [sheet, setSheet] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function remove() {
    setBusy(true); setError("");
    try { await deletePost(clubId, post.id); setBusy(false); setSheet(null); onChanged(); } catch { setError("That couldn’t be saved. Please try again."); setBusy(false); }
  }
  const items = post.mine
    ? [{ label: EDIT_POST, onSelect: () => setSheet("edit") }, { label: DELETE_POST, danger: true, onSelect: () => setSheet("delete") }]
    : [{ label: REPORT_POST, onSelect: () => setSheet("report") }, ...(isMod ? [{ label: REMOVE_POST, danger: true, onSelect: () => setSheet("remove") }] : [])];
  const name = post.mine ? YOU : post.author.name, when = ago(post.created_at);
  return <li className="bv-club-post">
    <div className="bv-club-post-head"><strong>{name}</strong><span>{[post.anchor ? upTo(positionLabel(post.anchor.unit, post.anchor.value)) : NO_SPOILERS_META, when].filter(Boolean).join(" · ")}</span>
      <ClubMenu label={`More actions for the post by ${name}`} items={items} /></div>
    <p className="bv-club-post-body">{post.body}</p>
    {sheet === "edit" && <EditPostSheet clubId={clubId} post={post} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); onChanged(); }} />}
    {sheet === "report" && <ReportSheet clubId={clubId} post={post} onClose={() => setSheet(null)} onReported={() => { setSheet(null); onReported(); }} />}
    {sheet === "delete" && <ConfirmSheet title={DELETE_POST_TITLE} text={CANT_UNDO} confirmLabel={DELETE_POST} cancelLabel={CANCEL} danger pending={busy} error={error} onClose={() => { setSheet(null); setError(""); }} onConfirm={remove} />}
    {sheet === "remove" && <ConfirmSheet title={removePostTitle(post.author.name)} text={CANT_UNDO} confirmLabel={REMOVE_POST} cancelLabel={CANCEL} danger pending={busy} error={error} onClose={() => { setSheet(null); setError(""); }} onConfirm={remove} />}
  </li>;
}

// The lowest point at which the posts further on open.
const lowestUnlock = locked => {
  const pages = locked.filter(post => post.unlocks_at?.unit === "pages").map(post => post.unlocks_at.value), percents = locked.filter(post => post.unlocks_at?.unit === "percent").map(post => post.unlocks_at.value);
  return pages.length ? positionLabel("pages", Math.min(...pages)) : percents.length ? positionLabel("percent", Math.min(...percents)) : "";
};

// Discussion: Write a post, then the posts on pages you have reached, and the ones further on as a single line with a way to unlock them.
export default function DiscussionTab({ clubId, book, myPage, isMod, refreshKey, onChanged, onUpdatePage }) {
  const request = useRequest(() => getPosts(clubId, book.id), `club-posts:${clubId}:${book.id}:${refreshKey}`);
  const [more, setMore] = useState(null), [loadingMore, setLoadingMore] = useState(false), [writing, setWriting] = useState(false), [note, setNote] = useState(""), [error, setError] = useState("");
  const items = [...(request.data?.items || []), ...(more?.items || [])];
  const next = more ? more.next_before : request.data?.next_before;
  const posts = items.filter(post => !post.locked && !post.hidden), locked = items.filter(post => post.locked);
  async function showOlder() {
    setLoadingMore(true);
    try { const older = await getPosts(clubId, book.id, next); setMore(current => ({ items: [...(current?.items || []), ...older.items], next_before: older.next_before })); } catch { setError("More posts couldn’t load. Try again."); }
    setLoadingMore(false);
  }
  const refresh = () => { setMore(null); onChanged(); };
  return <section className="bv-club-discussion" aria-label="Discussion">
    <Button variant="secondary" className="bv-club-write" onClick={() => { setNote(""); setWriting(true); }}>{WRITE_A_POST}</Button>
    <p className="bv-club-note" role="status">{note}</p>
    {request.error ? <p className="bv-field-error" role="alert">The discussion couldn’t load. <button type="button" className="bv-club-link-button" onClick={request.retry}>Try again</button></p> : <>
      {locked.length > 0 && <p className="bv-club-locked">{unlockAt(locked.length, lowestUnlock(locked))} <button type="button" className="bv-club-link-button" onClick={onUpdatePage}>{UPDATE_MY_PAGE}</button></p>}
      {posts.length > 0 ? <ul className="bv-club-posts" aria-busy={request.loading}>{posts.map(post => <Post key={post.id} post={post} clubId={clubId} isMod={isMod} onChanged={refresh} onReported={() => setNote(REPORTED)} />)}</ul>
        : !request.loading && locked.length === 0 && <p className="bv-club-empty">{NO_POSTS}</p>}
    </>}
    {error && <p className="bv-field-error" role="alert">{error}</p>}
    {next && <Button variant="quiet" disabled={loadingMore} onClick={showOlder}>{loadingMore ? "Loading…" : OLDER_POSTS}</Button>}
    {writing && <WritePostSheet clubId={clubId} book={book} myPage={myPage} onClose={() => setWriting(false)} onPosted={() => { setWriting(false); refresh(); }} />}
  </section>;
}
