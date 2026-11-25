import { useState } from "react";
import { Plus, Users } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { getClub, getMembers, listClubs } from "../../api/clubs.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { BookCover, Button, EmptyState } from "../ui-v2/primitives.jsx";
import { useRequest } from "../ui-v2/data.js";
import { ClubFormSheet } from "./ClubSheets.jsx";
import { cardPlace, readTo } from "./clubCopy.js";
import { clubColor, dayDate, members as memberCount, nextCheckpoint, pageOf, positionLabel } from "./clubFormat.js";
import "../../styles/ui-v2/clubs.css";

// One club: a colour rule, the current book's cover, the name, who and what, and what is next. The club's own answers are the ones the
// club page asks for, so opening it afterwards is instant.
function ClubCard({ club, generation }) {
  const detail = useRequest(() => getClub(club.id), `club:${club.id}:${generation}`);
  const people = useRequest(() => getMembers(club.id), `club-members:${club.id}:${generation}`);
  const book = detail.data?.books.find(item => item.status === "current");
  const myPage = pageOf(people.data?.items.find(member => member.me)?.progress, book?.page_count);
  const next = book ? nextCheckpoint(book, myPage) : null;
  return <li><Link className="bv-club-card" to={`/clubs/${club.id}`} style={{ "--club": clubColor(club) }}>
    {book && <span className="bv-club-cover is-small"><BookCover book={{ title: book.title, cover_image_url: book.cover_image_url, authors: [] }} size="small" decorative /></span>}
    <span className="bv-club-card-text"><strong className="bv-club-card-name">{club.name}</strong>
      <span className="bv-club-card-line">{memberCount(club.member_count)}{club.current_book ? ` · Now reading ${club.current_book.title}` : ""}</span>
      {(next || myPage != null) && <span className="bv-club-card-line">{next && <b>{readTo(positionLabel(next.unit, next.value), dayDate(next.due_on))}</b>}{next && myPage != null ? " · " : ""}{myPage != null ? cardPlace(myPage, !next) : ""}</span>}
    </span></Link></li>;
}

export default function ClubsListPage() {
  const auth = useAuth(), navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const request = useRequest(() => listClubs(), `clubs:${auth.sessionGeneration}`);
  const clubs = request.data?.items || [];
  const start = <Button className="bv-club-start" onClick={() => setStarting(true)}><Plus aria-hidden="true" />Start a club</Button>;
  return <section className="bv-container bv-clubs">
    <div className="bv-club-pagehead"><h1>Your clubs</h1>{clubs.length > 0 && start}</div>
    {request.loading ? <p className="bv-muted" role="status">Opening your clubs…</p>
      : request.error ? <EmptyState error icon={Users} title="Your clubs couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Nothing has changed.</EmptyState>
        : clubs.length ? <ul className="bv-club-cards">{clubs.map(club => <ClubCard key={club.id} club={club} generation={auth.sessionGeneration} />)}</ul>
          : <EmptyState icon={Users} title="Read together with friends." action={start}>Clubs are private and invite-only.</EmptyState>}
    {starting && <ClubFormSheet open onClose={() => setStarting(false)} onSaved={saved => { setStarting(false); request.retry(); navigate(`/clubs/${saved.id}`, { state: { highlightInvite: true } }); }} />}
  </section>;
}
