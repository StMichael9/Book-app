import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getInvitePreview, joinClub } from "../../api/clubs.js";
import { ensureLibraryBook } from "../../api/reading.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { BookCover, Button } from "../ui-v2/primitives.jsx";
import { authorLabel, useDocumentTitle, useRequest } from "../ui-v2/data.js";
import { clubColor, codeOf, members as memberCount, named } from "./clubFormat.js";
import "../../styles/ui-v2/clubs.css";

// The invite page keeps out of search results for as long as it is open.
function useNoIndex() {
  useEffect(() => {
    const tag = document.createElement("meta");
    tag.name = "robots"; tag.content = "noindex";
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);
}

// /c/:token. Public: someone with the link sees the club's name, size and (when the server sends it) who invited them and what it is reading.
// Signed in they can join; signed out they are sent to sign up and come back here.
export default function JoinClubPage({ notFound }) {
  useNoIndex();
  const { token } = useParams();
  const auth = useAuth(), navigate = useNavigate();
  const preview = useRequest(() => getInvitePreview(token), `club-invite:${token}`);
  const [addBook, setAddBook] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState(""), [full, setFull] = useState(false);
  useDocumentTitle(preview.data ? `Join ${preview.data.name}` : "Join a club");
  if (preview.error) return preview.error.status === 404 ? notFound : <section className="bv-container bv-club-join"><p className="bv-field-error" role="alert">This invitation couldn’t load. <button type="button" className="bv-club-link-button" onClick={preview.retry}>Try again</button></p></section>;
  if (!preview.data) return <section className="bv-container bv-club-join" aria-busy="true"><p className="bv-muted" role="status">Opening invitation…</p></section>;
  const club = preview.data, book = club.current_book, owner = club.owner_name;
  const here = `/c/${token}`, returnTo = encodeURIComponent(here);
  const isFull = club.full || full;
  async function join() {
    if (pending) return;
    setPending(true); setError("");
    try {
      const joined = await joinClub(token);
      if (addBook && book?.book_id && joined.joined) { try { await ensureLibraryBook(book.book_id, { is_wanted: true }); } catch { /* joining worked; the shelf can be filled later */ } }
      navigate(`/clubs/${joined.id}`, { replace: true });
    } catch (failure) {
      if (codeOf(failure) === "club_full") setFull(true); else setError("You couldn’t join the club. Please try again.");
      setPending(false);
    }
  }
  return <section className="bv-container bv-club-join" style={{ "--club": clubColor(club) }}>
    <header className="bv-club-head">
      <div className="bv-club-head-text">{owner && <p className="bv-club-invited">{owner} invited you to join</p>}<h1>{club.name}</h1><p>{memberCount(club.member_count)} · private, invite-only</p></div>
    </header>
    {book && <div className="bv-club-now-card">
      <div className="bv-club-cover"><BookCover book={{ title: book.title, cover_image_url: book.cover_image_url, authors: named(book.authors) }} size="small" decorative /></div>
      <div><p className="bv-club-label">Now reading</p><p className="bv-club-title">{book.title}</p>{book.authors?.length > 0 && <p className="bv-club-author">{authorLabel({ authors: named(book.authors) })}</p>}</div>
    </div>}
    {isFull ? <div className="bv-club-full"><p><strong>This club is full right now.</strong></p>{owner && <p>Ask {owner} to make room.</p>}</div>
      : auth.isLoading ? <div className="bv-club-join-actions" aria-busy="true" />
        : auth.isAuthenticated ? <div className="bv-club-join-actions">
          <Button className="bv-full-width" disabled={pending} onClick={join}>{pending ? "Joining…" : "Join the club"}</Button>
          {book && <label className="bv-club-check"><input type="checkbox" checked={addBook} onChange={event => setAddBook(event.target.checked)} /><span className="bv-club-box" aria-hidden="true"><Check /></span><span>Add {book.title} to my shelf</span></label>}
          {error && <p className="bv-field-error" role="alert">{error}</p>}
        </div> : <div className="bv-club-join-actions">
          <Link className="bv-button bv-button--primary bv-full-width" to={`/register?ref=club&returnTo=${returnTo}`}>Sign up to join</Link>
          <p className="bv-club-signin">Already have an account? <Link className="bv-text-link" to={`/login?returnTo=${returnTo}`}>Sign in</Link></p>
        </div>}
    <p className="bv-club-foot">Clubs are private. Only members can see the discussion.</p>
  </section>;
}
