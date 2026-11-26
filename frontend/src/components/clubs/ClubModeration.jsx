import { useState } from "react";
import { removeMember, reviewPost, setMemberRole } from "../../api/clubs.js";
import { Button, NativeDialog } from "../ui-v2/primitives.jsx";
import { ConfirmSheet } from "./ClubSheets.jsx";
import { progressText, shortDate } from "./clubFormat.js";
import { CANCEL, KEEP_IT, MAKE_ADMIN, MAKE_MEMBER, NOTHING_TO_REVIEW, REMOVE, REMOVE_FROM_CLUB, REMOVE_IT, REMOVE_MEMBER_TEXT, REPORTED_HELP, REPORTED_POSTS, ROLE_ADMIN, ROLE_MEMBER, joined, removeMemberTitle, reportedTimes } from "./clubCopy.js";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";

// Reported posts: each with who wrote it, how many times it was reported, its text and the reasons given, and the two answers: Keep it or Remove it.
export function ReportedSheet({ clubId, items, onClose, onChanged }) {
  const [busy, setBusy] = useState(0), [error, setError] = useState("");
  async function review(post, action) {
    if (busy) return;
    setBusy(post.id); setError("");
    try { await reviewPost(clubId, post.id, action); onChanged(); } catch { setError(SAVE_FAILED); }
    setBusy(0);
  }
  return <NativeDialog open onClose={onClose} title={REPORTED_POSTS} className="bv-club-sheet">
    {items.length === 0 ? <p className="bv-club-confirm">{NOTHING_TO_REVIEW}</p> : <>
      <ul className="bv-club-reports">{items.map(post => <li key={post.id}>
        <p><strong>{post.author}</strong> <span className="bv-muted">{reportedTimes(post.report_count)}</span></p>
        <p className="bv-club-post-body">{post.body}</p>
        {(post.reasons || []).map((reason, index) => <p key={index} className="bv-club-reason">“{reason}”</p>)}
        <div className="bv-club-report-actions"><Button variant="secondary" disabled={busy === post.id} onClick={() => review(post, "restore")}>{KEEP_IT}</Button><Button variant="secondary" disabled={busy === post.id} onClick={() => review(post, "delete")}>{REMOVE_IT}</Button></div>
      </li>)}</ul>
      <p className="bv-club-help">{REPORTED_HELP}</p></>}
    {error && <p className="bv-field-error" role="alert">{error}</p>}
  </NativeDialog>;
}

// A member's options for owners and admins: who they are and how far they are, then Make admin / Make member (owners only) and Remove from club (which asks first).
export function MemberSheet({ club, member, pageCount, owner, onClose, onChanged }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirming, setConfirming] = useState(false);
  async function act(work) {
    if (busy) return false;
    setBusy(true); setError("");
    try { await work(); setBusy(false); return true; } catch { setError(SAVE_FAILED); setBusy(false); return false; }
  }
  const role = to => async () => { if (await act(() => setMemberRole(club.id, member.user_id, to))) { onChanged(); onClose(); } };
  return <>
    <NativeDialog open={!confirming} onClose={onClose} title={member.name} className="bv-club-sheet">
      <p className="bv-club-confirm">{[member.role === "admin" ? ROLE_ADMIN : ROLE_MEMBER, progressText(member, pageCount)].filter(Boolean).join(" · ")}</p>
      {member.joined_at && <p className="bv-club-confirm">{joined(shortDate(member.joined_at.slice(0, 10)))}</p>}
      <div className="bv-club-actions">
        {owner && member.role === "member" && <Button variant="secondary" disabled={busy} onClick={role("admin")}>{MAKE_ADMIN}</Button>}
        {owner && member.role === "admin" && <Button variant="secondary" disabled={busy} onClick={role("member")}>{MAKE_MEMBER}</Button>}
        <Button variant="quiet" className="bv-club-danger" disabled={busy} onClick={() => setConfirming(true)}>{REMOVE_FROM_CLUB}</Button>
      </div>
      {error && <p className="bv-field-error" role="alert">{error}</p>}
    </NativeDialog>
    {confirming && <ConfirmSheet title={removeMemberTitle(member.name)} text={REMOVE_MEMBER_TEXT} confirmLabel={REMOVE} cancelLabel={CANCEL} danger pending={busy} error={error} onClose={() => setConfirming(false)}
      onConfirm={async () => { if (await act(() => removeMember(club.id, member.user_id))) { onChanged(); onClose(); } }} />}
  </>;
}
