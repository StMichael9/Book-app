import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { deleteClub, getClub, getMembers, getReports, leaveClub, setSharing } from "../../api/clubs.js";
import { lookupLibraryBooks } from "../../api/reading.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { Button, EmptyState, TextLink } from "../ui-v2/primitives.jsx";
import { useDocumentTitle, useRequest, validBookId } from "../ui-v2/data.js";
import { TabBar, TabPanel } from "../profile/ProfileTabs.jsx";
import BooksTab from "./BooksTab.jsx";
import ClubMenu from "./ClubMenu.jsx";
import { ReportedSheet } from "./ClubModeration.jsx";
import { AddBookSheet, ClubFormSheet, ConfirmSheet, InviteSheet } from "./ClubSheets.jsx";
import ReadingPlanSheet from "./ReadingPlanSheet.jsx";
import DiscussionTab from "./DiscussionTab.jsx";
import MembersTab from "./MembersTab.jsx";
import SetupCard from "./SetupCard.jsx";
import ThisWeek from "./ThisWeek.jsx";
import { useUpdatePage } from "./useUpdatePage.jsx";
import { clubColor, members as memberCount, named, nextCheckpoint, pageOf } from "./clubFormat.js";
import { CANCEL, CLUB_TABS, CLUB_TABS_LABEL, DELETE_CLUB, DELETE_CLUB_TEXT, EDIT_CLUB, JUST_YOU, LEAVE_CLUB, LEAVE_TEXT, POSTS_OPEN_WHEN_BOOK, READING_PLAN, deleteClubTitle, leaveTitle, reportedPosts } from "./clubCopy.js";
import "../../styles/ui-v2/clubs.css";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";

// A club: its name, (for owners and admins, the setup card until it's done), This week (where the club should be and where you are), and three tabs:
// Discussion, Books and Members. Members have no "…" menu at all; owners and admins have one for the rarely used things. One primary action per screen.
export default function ClubPage({ notFound }) {
  const id = validBookId(useParams().clubId);
  const auth = useAuth(), navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [version, setVersion] = useState(0), [sheet, setSheet] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [shared, setShared] = useState(null), [newPlan, setNewPlan] = useState(null);
  const club = useRequest(() => getClub(id), `club:${id}:${auth.sessionGeneration}`, Boolean(id));
  const people = useRequest(() => getMembers(id), `club-members:${id}:${auth.sessionGeneration}`, Boolean(id));
  const data = club.data;
  const mod = Boolean(data) && data.me.role !== "member", owner = data?.me.role === "owner";
  const current = data?.books.find(book => book.status === "current");
  const reports = useRequest(() => getReports(id), `club-reports:${id}:${auth.sessionGeneration}:${version}`, Boolean(id) && mod);
  const shelf = useRequest(() => lookupLibraryBooks([current.book_id]), `club-shelf:${id}:${current?.book_id}:${auth.sessionGeneration}:${version}`, Boolean(id) && Boolean(current));
  const refresh = () => { setVersion(value => value + 1); club.retry(); people.retry(); };
  const book = current ? { ...current, authors: named(current.authors) } : null;
  const update = useUpdatePage({ book, onChanged: refresh });
  useDocumentTitle(data?.name);
  if (!id || club.error?.status === 404) return notFound;
  if (club.error) return <section className="bv-container"><EmptyState error title="This club couldn’t load." action={<Button onClick={club.retry}>Try again</Button>}>Nothing has changed.</EmptyState></section>;
  if (!data) return <section className="bv-container bv-club-page" aria-busy="true"><p className="bv-muted" role="status">Opening club…</p></section>;
  const list = people.data?.items || [], me = list.find(member => member.me);
  const myPage = pageOf(me?.progress, current?.page_count), next = current ? nextCheckpoint(current, myPage) : null;
  const onShelf = shelf.data ? Boolean(shelf.data.items?.some(item => item.book_id === current.book_id && item.entry_id != null)) : undefined;
  const sharing = shared ?? data.me.share_progress;
  const left = data.club_plus || data.effective_cap === null ? null : Math.max(0, (data.effective_cap ?? data.cap.free_limit) - data.member_count);
  const tab = CLUB_TABS.some(([key]) => key === params.get("tab")) ? params.get("tab") : "discussion";
  const close = () => { setSheet(null); setError(""); };
  const changeTab = key => setParams(before => { const after = new URLSearchParams(before); after.set("tab", key); return after; }, { replace: true });
  async function toggleSharing(value) {
    setShared(value);
    try { await setSharing(id, value); people.retry(); club.retry(); setShared(null); return true; } catch { setShared(null); return false; }
  }
  async function leave() {
    setBusy(true); setError("");
    try { await leaveClub(id); navigate("/clubs", { replace: true }); } catch { setError("You couldn’t leave the club. Please try again."); setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError("");
    try { await deleteClub(id); navigate("/clubs", { replace: true }); } catch { setError(SAVE_FAILED); setBusy(false); }
  }
  const items = mod ? [
    { label: EDIT_CLUB, onSelect: () => setSheet("edit") },
    ...(current ? [{ label: READING_PLAN, onSelect: () => setSheet("plan") }] : []),
    { label: reportedPosts(reports.data?.items?.length ?? 0), onSelect: () => setSheet("reports") },
    ...(owner ? [{ label: DELETE_CLUB, danger: true, onSelect: () => setSheet("delete") }] : []),
  ] : [];
  return <section className="bv-container bv-club-page" style={{ "--club": clubColor(data) }}>
    <TextLink to="/clubs">Clubs</TextLink>
    <header className="bv-club-head">
      <div className="bv-club-head-text"><h1>{data.name}</h1><p>{data.member_count === 1 ? JUST_YOU : memberCount(data.member_count)}</p></div>
      {mod && <div className="bv-club-head-actions"><ClubMenu label="More actions for this club" items={items} /></div>}
    </header>
    {mod && <SetupCard club={data} current={current} onChooseBook={() => setSheet("book")} onMakePlan={() => setSheet("plan")} onInvite={() => setSheet("invite")} />}
    {(book || !mod) && <ThisWeek book={book} people={list} next={next} myPage={myPage} mine={me?.progress} onShelf={onShelf} update={update} onShelfChanged={shelf.retry} />}
    <TabBar value={tab} onChange={changeTab} tabs={CLUB_TABS} idPrefix="bv-club-tab" label={CLUB_TABS_LABEL} />
    <TabPanel value={tab} idPrefix="bv-club-tab">
      {tab === "discussion" && (current ? <DiscussionTab clubId={id} book={current} myPage={myPage} isMod={mod} refreshKey={version} onChanged={refresh} onUpdatePage={update.open} /> : <p className="bv-club-empty">{POSTS_OPEN_WHEN_BOOK}</p>)}
      {tab === "books" && <BooksTab clubId={id} books={data.books} current={book} next={next} mod={mod} onAddBook={() => setSheet("book")} onEditPlan={() => setSheet("plan")} onChanged={refresh} />}
      {tab === "members" && <MembersTab club={data} list={list} pageCount={current?.page_count} mod={mod} owner={owner} sharing={sharing} onToggleSharing={toggleSharing} onInvite={() => setSheet("invite")} onLeave={() => setSheet("leave")} onChanged={refresh} />}
    </TabPanel>
    {sheet === "invite" && <InviteSheet open onClose={() => { close(); refresh(); }} clubId={id} left={left} />}
    {sheet === "edit" && <ClubFormSheet open club={data} onClose={close} onSaved={() => { close(); refresh(); }} />}
    {sheet === "book" && <AddBookSheet open onClose={close} clubId={id} hasCurrent={Boolean(current)} onAdded={added => { setNewPlan(added.now ? added.id : null); setSheet(added.now ? "plan-new" : null); refresh(); }} />}
    {sheet === "plan" && current && <ReadingPlanSheet clubId={id} book={current} onClose={close} onChanged={refresh} />}
    {sheet === "plan-new" && data.books.some(item => item.id === newPlan) && <ReadingPlanSheet clubId={id} book={data.books.find(item => item.id === newPlan)} fresh onClose={close} onChanged={refresh} />}
    {sheet === "reports" && <ReportedSheet clubId={id} items={reports.data?.items || []} onClose={close} onChanged={() => { reports.retry(); refresh(); }} />}
    {sheet === "leave" && <ConfirmSheet title={leaveTitle(data.name)} text={LEAVE_TEXT} confirmLabel={LEAVE_CLUB} cancelLabel={CANCEL} pending={busy} error={error} onClose={close} onConfirm={leave} />}
    {sheet === "delete" && <ConfirmSheet title={deleteClubTitle(data.name)} text={DELETE_CLUB_TEXT} confirmLabel={DELETE_CLUB} cancelLabel={CANCEL} danger pending={busy} error={error} onClose={close} onConfirm={remove} />}
  </section>;
}
