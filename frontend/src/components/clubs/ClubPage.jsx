import { useState } from "react";
import { Link as LinkIcon } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getClub, getMembers, leaveClub, removeMember, setMemberRole, setSharing } from "../../api/clubs.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { BookCover, Button, EmptyState, TextLink } from "../ui-v2/primitives.jsx";
import { useDocumentTitle, useRequest, validBookId } from "../ui-v2/data.js";
import ClubMenu from "./ClubMenu.jsx";
import { Discussion, NowReading, Schedule } from "./ClubSections.jsx";
import { AddBookSheet, ClubFormSheet, InviteSheet, ScheduleSheet } from "./ClubSheets.jsx";
import { clubColor, initialOf, named, members as memberCount, nextCheckpoint, pageOf, shareOf, shortDate } from "./clubFormat.js";
import "../../styles/ui-v2/clubs.css";

const SEE_FIRST = 5, CAP_NOTICE_FROM = 20;

function MemberRow({ member, club, pageCount, mod, owner, onChanged }) {
  const [busy, setBusy] = useState(false);
  const share = member.shares_progress ? shareOf(member.progress, pageCount) : null;
  async function act(work) {
    if (busy) return;
    setBusy(true);
    try { await work(); onChanged(); } catch { /* the list keeps what it had */ }
    setBusy(false);
  }
  const items = member.me || member.role === "owner" ? [] : [
    ...(owner && member.role === "member" ? [{ label: "Make admin", onSelect: () => act(() => setMemberRole(club.id, member.user_id, "admin")) }] : []),
    ...(owner || (mod && member.role === "member") ? [{ label: "Remove from club", danger: true, onSelect: () => act(() => removeMember(club.id, member.user_id)) }] : []),
  ];
  return <li className="bv-club-member">
    <span className="bv-club-avatar" aria-hidden="true">{initialOf(member.name)}</span>
    <div className="bv-club-member-text"><p><strong>{member.name}</strong>{member.role !== "member" && <span className="bv-club-role"> {member.role}</span>}</p>
      {share != null && <span className="bv-club-bar is-thin" aria-hidden="true"><span className="bv-club-bar-fill" style={{ width: `${Math.round(share * 100)}%` }} /></span>}</div>
    <ClubMenu label={`More actions for ${member.name}`} items={items} />
  </li>;
}

export default function ClubPage({ notFound }) {
  const id = validBookId(useParams().clubId);
  const auth = useAuth(), navigate = useNavigate(), location = useLocation();
  const club = useRequest(() => getClub(id), `club:${id}:${auth.sessionGeneration}`, Boolean(id));
  const people = useRequest(() => getMembers(id), `club-members:${id}:${auth.sessionGeneration}`, Boolean(id));
  const data = club.data;
  const current = data?.books.find(book => book.status === "current"), upcoming = data?.books.find(book => book.status === "upcoming");
  useDocumentTitle(data?.name);
  const [sheet, setSheet] = useState(null), [all, setAll] = useState(false), [leaveError, setLeaveError] = useState(""), [sharingError, setSharingError] = useState(""), [sharing, setSharing_] = useState(null);
  if (!id || club.error?.status === 404) return notFound;
  if (club.error) return <section className="bv-container"><EmptyState error title="This club couldn’t load." action={<Button onClick={club.retry}>Try again</Button>}>Nothing has changed.</EmptyState></section>;
  if (!data) return <section className="bv-container bv-club-page" aria-busy="true"><p className="bv-muted" role="status">Opening club…</p></section>;
  const mod = data.me.role !== "member", owner = data.me.role === "owner";
  const list = people.data?.items || [], me = list.find(member => member.me);
  const myPage = pageOf(me?.progress, current?.page_count), next = current ? nextCheckpoint(current, myPage) : null;
  const shared = sharing ?? data.me.share_progress;
  const book = current ? { ...current, authors: named(current.authors) } : null;
  const full = data.cap.full, nearCap = !data.club_plus && data.member_count >= CAP_NOTICE_FROM;
  const refresh = () => { club.retry(); people.retry(); };
  const close = () => setSheet(null);
  async function toggleSharing() {
    const value = !shared;
    setSharing_(value); setSharingError("");
    try { await setSharing(id, value); people.retry(); club.retry(); } catch { setSharingError("That couldn’t be saved. Please try again."); }
    setSharing_(null);
  }
  async function leave() {
    setLeaveError("");
    try { await leaveClub(id); navigate("/my-books/clubs", { replace: true }); } catch { setLeaveError("You couldn’t leave the club. Please try again."); }
  }
  return <section className="bv-container bv-club-page" style={{ "--club": clubColor(data) }}>
    <TextLink to="/my-books/clubs">Clubs</TextLink>
    <header className="bv-club-head">
      <div className="bv-club-head-text"><h1>{data.name}</h1><p>{memberCount(data.member_count)} · private, invite-only</p></div>
      <div className="bv-club-head-actions">
        {mod && <Button variant="secondary" className={`bv-club-invite-button${location.state?.highlightInvite ? " is-highlight" : ""}`} onClick={() => setSheet("invite")}><LinkIcon aria-hidden="true" />Invite</Button>}
        {mod && <ClubMenu label="More actions for this club" items={[{ label: "Edit club", onSelect: () => setSheet("edit") }, { label: "Add a book", onSelect: () => setSheet("book") }, ...(current ? [{ label: "Edit schedule", onSelect: () => setSheet("schedule") }] : [])]} />}
      </div>
    </header>
    <div className="bv-club-layout">
      <div className="bv-club-main">
        {book && <NowReading book={book}><Schedule book={current} next={next} myPage={myPage} mine={me?.progress} /></NowReading>}
        {current && <Discussion clubId={id} book={current} myPage={myPage} isMod={mod} />}
      </div>
      <aside className="bv-club-aside" aria-label="Club members">
        <section aria-labelledby="bv-club-members-h"><h2 id="bv-club-members-h" className="bv-club-label">Members</h2>
          {owner && nearCap && <p className="bv-club-cap">{full ? "Your club is full. Club Plus removes the limit." : `${data.member_count} of ${data.cap.free_limit} members`}</p>}
          <ul className="bv-club-members">{(all ? list : list.slice(0, SEE_FIRST)).map(member => <MemberRow key={member.user_id} member={member} club={data} pageCount={current?.page_count} mod={mod} owner={owner} onChanged={refresh} />)}</ul>
          {!all && list.length > SEE_FIRST && <button type="button" className="bv-club-link-button" onClick={() => setAll(true)}>See all {list.length}</button>}
        </section>
        <button type="button" role="switch" aria-checked={shared} className="bv-club-switch" onClick={toggleSharing}><span className="bv-club-track" aria-hidden="true" /><span>Share my progress with this club</span></button>
        {sharingError && <p className="bv-field-error" role="alert">{sharingError}</p>}
        {upcoming && <section aria-labelledby="bv-club-up-h"><h2 id="bv-club-up-h" className="bv-club-label">Up next</h2>
          <div className="bv-club-up"><div className="bv-club-cover is-small"><BookCover book={{ title: upcoming.title, cover_image_url: upcoming.cover_image_url, authors: [] }} size="small" decorative /></div>
            <div><p className="bv-club-title">{upcoming.title}</p>{upcoming.starts_on && <p className="bv-club-author">from {shortDate(upcoming.starts_on)}</p>}</div></div></section>}
        {!owner && <div><Button variant="quiet" className="bv-club-leave" onClick={leave}>Leave club</Button>{leaveError && <p className="bv-field-error" role="alert">{leaveError}</p>}</div>}
      </aside>
    </div>
    {sheet === "invite" && <InviteSheet open onClose={close} clubId={id} />}
    {sheet === "edit" && <ClubFormSheet open club={data} onClose={close} onSaved={() => { close(); refresh(); }} />}
    {sheet === "book" && <AddBookSheet open onClose={close} clubId={id} hasCurrent={Boolean(current)} onSaved={() => { close(); refresh(); }} />}
    {sheet === "schedule" && <ScheduleSheet open onClose={close} clubId={id} books={data.books} onChanged={refresh} />}
  </section>;
}
