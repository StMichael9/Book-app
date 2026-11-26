import { useState } from "react";
import { createPost, editPost, reportPost } from "../../api/clubs.js";
import { Button, NativeDialog } from "../ui-v2/primitives.jsx";
import ClubSwitch from "./ClubSwitch.jsx";
import { codeOf, positionLabel } from "./clubFormat.js";
import { CANCEL, EDIT_POST, NO_SPOILERS, POST, POST_PLACEHOLDER, REACHED_A_PAGE, REPORT, REPORT_PRIVACY, REPORT_THIS_POST, SAVE, SPOILERS_HELP, SPOILERS_UP_TO_PAGE, WHY_OPTIONAL, WRITE_A_POST, YOUR_POST, reachedAPageAt, spoilersFixed } from "./clubCopy.js";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";

// Write a post. "Spoilers up to page" starts at your own page: members who haven't read that far see the post locked. "No spoilers" shows it to everyone
// (the page field greys out). The server reads page 0 as no anchor; leaving the page empty lets it use your own page.
export function WritePostSheet({ clubId, book, myPage, onClose, onPosted }) {
  const [text, setText] = useState(""), [page, setPage] = useState(myPage != null ? String(myPage) : ""), [free, setFree] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    const body = text.trim(), value = Number(page);
    if (!body || pending) return;
    const anchor = free ? { anchor_unit: "pages", anchor_value: 0 } : Number.isInteger(value) && value > 0 ? { anchor_unit: "pages", anchor_value: value } : {};
    setPending(true); setError("");
    try { await createPost(clubId, book.id, { body, ...anchor }); onPosted(); }
    catch (failure) { setError(codeOf(failure) === "anchor_ahead_of_progress" ? (myPage != null ? reachedAPageAt(myPage) : REACHED_A_PAGE) : "Your post couldn’t be saved. Please try again."); setPending(false); }
  }
  return <NativeDialog open onClose={() => { if (!pending) onClose(); }} title={WRITE_A_POST} className="bv-club-sheet">
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <div className="bv-field"><label htmlFor="bv-club-post-text">{YOUR_POST}</label><textarea id="bv-club-post-text" rows={4} maxLength={2000} placeholder={POST_PLACEHOLDER} value={text} onChange={event => { setText(event.target.value); setError(""); }} /></div>
      <div className="bv-field"><label htmlFor="bv-club-post-page">{SPOILERS_UP_TO_PAGE}</label>
        <input id="bv-club-post-page" inputMode="numeric" autoComplete="off" disabled={free} aria-describedby="bv-club-post-help" aria-invalid={error ? "true" : undefined} value={free ? "" : page} onChange={event => { setPage(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }} />
        <small id="bv-club-post-help" className="bv-club-help">{SPOILERS_HELP}</small></div>
      <ClubSwitch checked={free} onChange={setFree}>{NO_SPOILERS}</ClubSwitch>
      {error && <p className="bv-field-error" role="alert">{error}</p>}
      <div className="bv-form-actions"><Button type="submit" disabled={pending || !text.trim()}>{POST}</Button></div>
    </form>
  </NativeDialog>;
}

// Edit post: the text only. The spoiler page stays as it was, shown as a fixed line.
export function EditPostSheet({ clubId, post, onClose, onSaved }) {
  const [text, setText] = useState(post.body), [pending, setPending] = useState(false), [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    const body = text.trim();
    if (!body || pending) return;
    setPending(true); setError("");
    try { await editPost(clubId, post.id, body); onSaved(); } catch { setError(SAVE_FAILED); setPending(false); }
  }
  return <NativeDialog open onClose={() => { if (!pending) onClose(); }} title={EDIT_POST} className="bv-club-sheet">
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <div className="bv-field"><label htmlFor="bv-club-edit-text">{YOUR_POST}</label><textarea id="bv-club-edit-text" rows={4} maxLength={2000} value={text} onChange={event => { setText(event.target.value); setError(""); }} /></div>
      {post.anchor && <p className="bv-club-fixed">{spoilersFixed(positionLabel(post.anchor.unit, post.anchor.value))}</p>}
      {error && <p className="bv-field-error" role="alert">{error}</p>}
      <div className="bv-form-actions"><Button type="submit" disabled={pending || !text.trim()}>{SAVE}</Button><Button variant="quiet" disabled={pending} onClick={onClose}>{CANCEL}</Button></div>
    </form>
  </NativeDialog>;
}

// Report this post: who sees reports, and an optional reason.
export function ReportSheet({ clubId, post, onClose, onReported }) {
  const [reason, setReason] = useState(""), [pending, setPending] = useState(false), [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError("");
    try { await reportPost(clubId, post.id, reason.trim()); onReported(); } catch { setError(SAVE_FAILED); setPending(false); }
  }
  return <NativeDialog open onClose={() => { if (!pending) onClose(); }} title={REPORT_THIS_POST} className="bv-club-sheet">
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <p className="bv-club-confirm">{REPORT_PRIVACY}</p>
      <div className="bv-field"><label htmlFor="bv-club-report-why">{WHY_OPTIONAL}</label><input id="bv-club-report-why" maxLength={200} autoComplete="off" value={reason} onChange={event => setReason(event.target.value)} /></div>
      {error && <p className="bv-field-error" role="alert">{error}</p>}
      <div className="bv-form-actions"><Button type="submit" disabled={pending}>{REPORT}</Button><Button variant="quiet" disabled={pending} onClick={onClose}>{CANCEL}</Button></div>
    </form>
  </NativeDialog>;
}
