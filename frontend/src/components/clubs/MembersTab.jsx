import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "../ui-v2/primitives.jsx";
import ClubSwitch from "./ClubSwitch.jsx";
import { MemberSheet } from "./ClubModeration.jsx";
import { ClubSizeSheet } from "./ClubSheets.jsx";
import { initialOf, progressText } from "./clubFormat.js";
import { ADD_PLACES, CHANGE, CLUB_FULL, CLUB_FULL_TEXT, SIZE_MAX, INVITE_PEOPLE, LEAVE_CLUB, SHARE_HELP, SHARE_MY_PROGRESS, SHARING_OFF, SHARING_ON, YOU, placesUsed, rsvpWord, seeAll } from "./clubCopy.js";

const SHOWN = 6;

// What this reader may do to this member (the rules the server enforces): owners change roles and remove anyone but themselves; admins remove members.
const canAct = (member, mod, owner) => mod && !member.me && member.role !== "owner" && (owner || member.role === "member");

function Row({ member, pageCount, onOpen, children }) {
  const right = [member.role !== "member" ? member.role : "", progressText(member, pageCount)].filter(Boolean).join(" · ");
  const body = <>
    <span className="bv-club-avatar" aria-hidden="true">{initialOf(member.me ? YOU : member.name)}</span>
    <span className="bv-club-member-text"><strong>{member.me ? YOU : member.name}</strong>{member.rsvp && <span className="bv-club-rsvp">{rsvpWord(member.rsvp)}</span>}{children}</span>
    <span className="bv-club-member-right">{right}</span>
    {onOpen && <ChevronRight className="bv-club-chevron" aria-hidden="true" />}
  </>;
  return <li>{onOpen ? <button type="button" className="bv-club-member is-tappable" onClick={onOpen}>{body}</button> : <div className="bv-club-member">{body}</div>}</li>;
}

// Members: your own row first, with the switch for sharing your progress; everyone's place as text; Invite people and the places count for owners and
// admins (tap a member for their options); and Leave club at the bottom.
export default function MembersTab({ club, list, pageCount, mod, owner, sharing, onToggleSharing, onInvite, onLeave, onChanged }) {
  const [sizing, setSizing] = useState(false), [open, setOpen] = useState(null), [all, setAll] = useState(false), [note, setNote] = useState("");
  const me = list.find(member => member.me), ordered = me ? [me, ...list.filter(member => !member.me)] : list;
  const limited = !club.club_plus && club.effective_cap !== null, adjustable = club.member_limit != null, cap = club.effective_cap ?? club.cap.free_limit, full = club.effective_cap != null ? club.member_count >= club.effective_cap : club.cap.full;
  const shown = all ? ordered : ordered.slice(0, SHOWN);
  async function toggle(value) {
    setNote("");
    const ok = await onToggleSharing(value);
    setNote(ok ? (value ? SHARING_ON : SHARING_OFF) : "That couldn’t be saved. Please try again.");
  }
  return <section className="bv-club-members-tab" aria-label="Members">
    {owner && limited && full && (adjustable && club.member_limit < SIZE_MAX
      ? <div className="bv-club-full-card"><strong>{CLUB_FULL}</strong><Button variant="secondary" onClick={() => setSizing(true)}>{ADD_PLACES}</Button></div>
      : <div className="bv-club-full-card"><strong>{CLUB_FULL}</strong><span>{CLUB_FULL_TEXT}</span></div>)}
    {mod && <Button className="bv-club-invite-people" onClick={onInvite}>{INVITE_PEOPLE}</Button>}
    {mod && limited && <p className="bv-club-places">{placesUsed(club.member_count, cap)}{owner && adjustable && <> <button type="button" className="bv-club-link-button" onClick={() => setSizing(true)}>{CHANGE}</button></>}</p>}
    <ul className="bv-club-members">{shown.map(member => <Row key={member.user_id} member={member} pageCount={pageCount} onOpen={canAct(member, mod, owner) ? () => setOpen(member) : undefined}>
      {member.me && <ClubSwitch checked={sharing} onChange={toggle}>{SHARE_MY_PROGRESS}</ClubSwitch>}</Row>)}</ul>
    {!all && ordered.length > SHOWN && <Button variant="quiet" onClick={() => setAll(true)}>{seeAll(ordered.length)}</Button>}
    <p className="bv-club-note" role="status">{note}</p>
    <p className="bv-club-help">{SHARE_HELP}</p>
    {(!owner || club.member_count > 1) && <Button variant="quiet" className="bv-club-leave" onClick={onLeave}>{LEAVE_CLUB}</Button>}
    {sizing && <ClubSizeSheet club={club} onClose={() => setSizing(false)} onSaved={() => { setSizing(false); onChanged(); }} />}
    {open && <MemberSheet club={club} member={open} pageCount={pageCount} owner={owner} onClose={() => setOpen(null)} onChanged={onChanged} />}
  </section>;
}
