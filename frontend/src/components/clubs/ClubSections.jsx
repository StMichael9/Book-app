import { useState } from "react";
import { Lock } from "lucide-react";
import { createPost, deletePost, getPosts, reportPost } from "../../api/clubs.js";
import { authorLabel, useRequest } from "../ui-v2/data.js";
import { BookCover, Button } from "../ui-v2/primitives.jsx";
import ClubMenu from "./ClubMenu.jsx";
import { ago, checkpointShare, codeOf, positionLabel, shareOf, shortDate } from "./clubFormat.js";

// Now reading: the cover (on the page, no panel behind it), the title and the author.
export function NowReading({ book, children }) {
  return <section className="bv-club-now" aria-labelledby="bv-club-now-h">
    <h2 id="bv-club-now-h" className="bv-club-label">Now reading</h2>
    <div className="bv-club-now-body">
      <div className="bv-club-cover"><BookCover book={{ title: book.title, cover_image_url: book.cover_image_url, authors: book.authors || [] }} size="small" /></div>
      <div className="bv-club-now-text"><p className="bv-club-title">{book.title}</p>{book.authors?.length > 0 && <p className="bv-club-author">{authorLabel(book)}</p>}{children}</div>
    </div>
  </section>;
}

// Schedule: one bar, a tick for each checkpoint (and the end), the reader's own place filled in, the next checkpoint in bold.
export function Schedule({ book, next, myPage, mine }) {
  const points = book.checkpoints || [];
  const marks = [...points.map(point => ({ key: `c${point.id}`, share: checkpointShare(point, book.page_count), label: positionLabel(point.unit, point.value), date: point.due_on, next: next?.id === point.id })),
    ...(book.ends_on ? [{ key: "end", share: 1, label: "End", date: book.ends_on }] : [])];
  if (!marks.length) return myPage != null ? <p className="bv-club-place">You’re on p. {myPage}.</p> : null;
  const placed = marks.map((mark, index) => ({ ...mark, at: mark.share ?? (marks.length === 1 ? 1 : (index + 1) / marks.length) }));
  const fill = shareOf(mine, book.page_count);
  return <div className="bv-club-schedule"><h3 className="bv-club-sub">Schedule</h3>
    <div className="bv-club-bar" aria-hidden="true"><span className="bv-club-bar-fill" style={{ width: `${Math.round((fill ?? 0) * 100)}%` }} />{placed.map(mark => <i key={mark.key} className="bv-club-tick" style={{ left: `${Math.round(mark.at * 100)}%` }} />)}</div>
    <ol className="bv-club-marks">{placed.map(mark => <li key={mark.key} className={mark.next ? "is-next" : undefined}>{mark.label}{mark.date ? ` · ${shortDate(mark.date)}` : ""}</li>)}</ol>
    {myPage != null && <p className="bv-club-place">You’re on p. {myPage}.</p>}
  </div>;
}

function Post({ post, clubId, isMod, onChanged }) {
  const [busy, setBusy] = useState(false), [reported, setReported] = useState(false), [failed, setFailed] = useState(false);
  if (post.hidden) return null;
  if (post.locked) {
    const at = post.unlocks_at;
    return <li className="bv-club-post is-locked"><Lock aria-hidden="true" /><p><strong>Unlocks at {positionLabel(at.unit, at.value)}</strong>{post.author?.name ? ` · a post by ${post.author.name}` : ""}</p></li>;
  }
  async function act(work) {
    if (busy) return;
    setBusy(true); setFailed(false);
    try { await work(); } catch { setFailed(true); }
    setBusy(false);
  }
  const items = [
    ...(!post.mine && !reported ? [{ label: "Report", onSelect: () => act(async () => { await reportPost(clubId, post.id); setReported(true); }) }] : []),
    ...(post.mine || isMod ? [{ label: "Delete", danger: true, onSelect: () => act(async () => { await deletePost(clubId, post.id); onChanged(); }) }] : []),
  ];
  const when = ago(post.created_at);
  return <li className="bv-club-post">
    <div className="bv-club-post-head"><strong>{post.author.name}</strong><span>{[post.anchor ? `about ${positionLabel(post.anchor.unit, post.anchor.value)}` : "", when].filter(Boolean).join(" · ")}</span>
      <ClubMenu label={`More actions for the post by ${post.author.name}`} items={items} /></div>
    <p className="bv-club-post-body">{post.body}</p>
    {failed && <p className="bv-field-error" role="alert">That didn’t go through. Please try again.</p>}
  </li>;
}

// Discussion: the composer, then the posts. A post about pages the reader hasn't reached comes without its text, as a locked row.
export function Discussion({ clubId, book, myPage, isMod }) {
  const request = useRequest(() => getPosts(clubId, book.id), `club-posts:${clubId}:${book.id}`);
  const [more, setMore] = useState(null), [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState(""), [page, setPage] = useState(null), [pending, setPending] = useState(false), [error, setError] = useState("");
  const shownPage = page ?? (myPage ?? "");
  const items = [...(request.data?.items || []), ...(more?.items || [])];
  const next = more ? more.next_before : request.data?.next_before;
  const refresh = () => { setMore(null); request.retry(); };
  async function submit(event) {
    event.preventDefault();
    const body = text.trim();
    if (!body || pending) return;
    const value = Number(shownPage);
    setPending(true); setError("");
    try {
      await createPost(clubId, book.id, { body, ...(Number.isInteger(value) && value > 0 ? { anchor_unit: "pages", anchor_value: value } : {}) });
      setText(""); refresh();
    } catch (failure) { setError(codeOf(failure) === "anchor_ahead_of_progress" ? "Choose a page you’ve reached." : "Your post couldn’t be saved. Please try again."); }
    setPending(false);
  }
  async function showMore() {
    setLoadingMore(true);
    try { const older = await getPosts(clubId, book.id, next); setMore(current => ({ items: [...(current?.items || []), ...older.items], next_before: older.next_before })); } catch { setError("More posts couldn’t load. Try again."); }
    setLoadingMore(false);
  }
  return <section className="bv-club-discussion" aria-labelledby="bv-club-disc-h"><h2 id="bv-club-disc-h">Discussion</h2>
    <form className="bv-club-composer" onSubmit={submit} noValidate aria-busy={pending}>
      <textarea aria-label="Write about this book" placeholder="Write about this book" rows={3} maxLength={2000} value={text} onChange={event => { setText(event.target.value); setError(""); }} />
      <div className="bv-club-composer-foot"><label htmlFor="bv-club-anchor">About page</label>
        <input id="bv-club-anchor" inputMode="numeric" value={shownPage} onChange={event => setPage(event.target.value.replace(/\D/g, "").slice(0, 6))} />
        <Button type="submit" disabled={pending || !text.trim()}>Post</Button></div>
      {error && <p className="bv-field-error" role="alert">{error}</p>}
    </form>
    {request.error ? <p className="bv-field-error" role="alert">The discussion couldn’t load. <button type="button" className="bv-club-link-button" onClick={request.retry}>Try again</button></p>
      : <ul className="bv-club-posts" aria-busy={request.loading}>{items.map(post => <Post key={post.id} post={post} clubId={clubId} isMod={isMod} onChanged={refresh} />)}</ul>}
    {next && <Button variant="secondary" disabled={loadingMore} onClick={showMore}>{loadingMore ? "Loading…" : "Show more"}</Button>}
  </section>;
}
