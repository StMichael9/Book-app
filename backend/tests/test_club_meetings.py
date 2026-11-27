"""Club meetings, RSVPs, book suggestions and votes: permissions by role, one upcoming meeting, the .ics file, RSVP counts, vote toggling,
closing a vote, the suggestion cap, leaving, and constant statement counts."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from test_clubs import counting, world  # noqa: F401  (the clubs fixture and the statement counter)

NOW = datetime.now(timezone.utc)


def when(**delta):
    return (NOW + timedelta(**delta)).isoformat()


@pytest.fixture()
def team(world):
    """A club with an owner, an admin, two members and an outsider."""
    world.owner, world.admin, world.m1, world.m2, world.outsider = (world.person(n) for n in ("Olga", "Adam", "Mia", "Max", "Out"))
    world.cid = world.club(world.owner)
    world.add_member(world.cid, world.admin, "admin")
    world.add_member(world.cid, world.m1)
    world.add_member(world.cid, world.m2)
    return world


def meet(w, who, club_id=None, **body):
    w.as_(who)
    return w.client.post(f"/clubs/{club_id or w.cid}/meetings", json={"starts_at": when(days=3), **body})


def suggest(w, who, book, club_id=None, **body):
    w.as_(who)
    return w.client.post(f"/clubs/{club_id or w.cid}/suggestions", json={"book_id": book.id, **body})


def vote(w, who, sid, method="put", club_id=None):
    w.as_(who)
    return getattr(w.client, method)(f"/clubs/{club_id or w.cid}/suggestions/{sid}/vote")


# --- meetings ----------------------------------------------------------------------------------------------------------------

def test_only_moderators_write_meetings_and_outsiders_see_nothing(team):
    for who in (team.m1,):
        assert meet(team, who).status_code == 403
    assert meet(team, team.outsider).status_code == 404
    created = meet(team, team.admin, place="The Pub", link="https://meet.example.com/x", questions=["Who did it?", " Why? "])
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["place"] == "The Pub" and body["link"] == "https://meet.example.com/x" and body["questions"] == ["Who did it?", "Why?"]
    assert body["counts"] == {"going": 0, "maybe": 0, "no": 0} and body["my_rsvp"] is None and body["id"] and body["starts_at"]
    mid = body["id"]
    team.as_(team.m1)
    assert team.client.patch(f"/clubs/{team.cid}/meetings/{mid}", json={"place": "Home"}).status_code == 403
    assert team.client.delete(f"/clubs/{team.cid}/meetings/{mid}").status_code == 403
    team.as_(team.outsider)
    assert team.client.patch(f"/clubs/{team.cid}/meetings/{mid}", json={"place": "Home"}).status_code == 404
    assert team.client.put(f"/clubs/{team.cid}/meetings/{mid}/rsvp", json={"status": "going"}).status_code == 404
    assert team.client.get(f"/clubs/{team.cid}/meetings/{mid}.ics").status_code == 404
    team.as_(team.owner)
    changed = team.client.patch(f"/clubs/{team.cid}/meetings/{mid}", json={"place": "Home", "link": None, "questions": []})
    assert changed.status_code == 200 and changed.json()["place"] == "Home" and changed.json()["link"] is None and changed.json()["questions"] == []
    assert team.client.delete(f"/clubs/{team.cid}/meetings/{mid}").status_code == 204
    assert team.client.get(f"/clubs/{team.cid}").json()["next_meeting"] is None


def test_meeting_input_is_validated(team):
    for bad in ({"starts_at": when(days=-1)}, {"starts_at": when(days=400)}, {"starts_at": "2030-01-01T10:00:00"}, {"starts_at": "soon"},
                {"link": "http://insecure.example.com"}, {"link": "https://" + "x" * 500}, {"place": "p" * 201}, {"questions": ["q"] * 6},
                {"questions": ["x" * 201]}, {"questions": ["   "]}, {"questions": [""]}, {"extra": 1}):
        assert meet(team, team.owner, **bad).status_code == 422, bad
    assert meet(team, team.owner, place="p" * 200, questions=["q" * 200] * 5).status_code == 201


def test_a_club_has_one_upcoming_meeting_at_a_time(team):
    first = meet(team, team.owner).json()
    again = meet(team, team.admin)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "meeting_exists"
    team.as_(team.owner)
    team.client.delete(f"/clubs/{team.cid}/meetings/{first['id']}")
    assert meet(team, team.admin).status_code == 201
    other = team.club(team.owner, "Second")
    assert meet(team, team.owner, club_id=other).status_code == 201                          # one per club, not one per owner


def test_a_meeting_stays_next_for_three_hours_after_it_starts(team):
    now = datetime.now(timezone.utc)
    for offset, shown in ((-2, True), (-4, False)):
        team.db.execute(text("DELETE FROM club_meetings WHERE club_id = :c"), {"c": team.cid})
        team.db.execute(text("INSERT INTO club_meetings (club_id, starts_at, questions) VALUES (:c, :s, '{}')"), {"c": team.cid, "s": now + timedelta(hours=offset)})
        team.db.commit()
        team.as_(team.m1)
        assert (team.client.get(f"/clubs/{team.cid}").json()["next_meeting"] is not None) is shown, offset
    assert meet(team, team.owner).status_code == 201                                            # a long-gone meeting no longer blocks a new one


def test_the_earliest_upcoming_meeting_is_the_next_one(team):
    team.db.execute(text("INSERT INTO club_meetings (club_id, starts_at, questions) VALUES (:c, now() + interval '10 days', '{}'), (:c, now() + interval '2 days', '{}'), "
                         "(:c, now() - interval '9 days', '{}')"), {"c": team.cid})
    team.db.commit()
    team.as_(team.m1)
    shown = team.client.get(f"/clubs/{team.cid}").json()["next_meeting"]
    assert abs(datetime.fromisoformat(shown["starts_at"]) - (NOW + timedelta(days=2))).total_seconds() < 60


def test_rsvps_count_per_status_and_change(team):
    mid = meet(team, team.owner).json()["id"]

    def rsvp(who, status):
        team.as_(who)
        return team.client.put(f"/clubs/{team.cid}/meetings/{mid}/rsvp", json={"status": status})

    assert rsvp(team.m1, "going").json() == {"counts": {"going": 1, "maybe": 0, "no": 0}, "my_rsvp": "going"}
    assert rsvp(team.m2, "maybe").json()["counts"] == {"going": 1, "maybe": 1, "no": 0}
    assert rsvp(team.owner, "no").json()["counts"] == {"going": 1, "maybe": 1, "no": 1}
    changed = rsvp(team.m1, "no").json()                                                        # an update, never a second row
    assert changed == {"counts": {"going": 0, "maybe": 1, "no": 2}, "my_rsvp": "no"}
    assert rsvp(team.m1, "perhaps").status_code == 422
    assert rsvp(team.outsider, "going").status_code == 404
    team.as_(team.m2)
    nxt = team.client.get(f"/clubs/{team.cid}").json()["next_meeting"]
    assert nxt["counts"] == {"going": 0, "maybe": 1, "no": 2} and nxt["my_rsvp"] == "maybe"
    members = {m["name"]: m["rsvp"] for m in team.client.get(f"/clubs/{team.cid}/members").json()["items"]}
    assert members == {"Olga": "no", "Adam": None, "Mia": "no", "Max": "maybe"}


def test_a_meeting_of_another_club_is_not_reachable_through_this_one(team):
    mid = meet(team, team.owner).json()["id"]
    other = team.club(team.m1, "Elsewhere")
    team.as_(team.m1)
    assert team.client.put(f"/clubs/{other}/meetings/{mid}/rsvp", json={"status": "going"}).status_code == 404
    assert team.client.get(f"/clubs/{other}/meetings/{mid}.ics").status_code == 404
    assert team.client.patch(f"/clubs/{other}/meetings/{mid}", json={"place": "x"}).status_code == 404
    assert team.client.delete(f"/clubs/{other}/meetings/{mid}").status_code == 404


def test_the_ics_file_has_one_stable_event(team):
    book = team.book("Moby")
    team.current_book(team.owner, team.cid, book)
    meeting = meet(team, team.owner, place="The Pub, Main St", questions=["Who; why?", "Second"]).json()
    team.as_(team.m1)
    first = team.client.get(f"/clubs/{team.cid}/meetings/{meeting['id']}.ics")
    assert first.status_code == 200 and first.headers["content-type"].startswith("text/calendar")
    assert first.headers["cache-control"] == "private, no-store"
    raw = first.text
    assert raw.count("BEGIN:VEVENT") == 1 and raw.startswith("BEGIN:VCALENDAR") and raw.rstrip().endswith("END:VCALENDAR") and "\r\n" in raw
    unfolded = raw.replace("\r\n ", "")
    start = datetime.fromisoformat(meeting["starts_at"]).astimezone(timezone.utc)
    assert f"DTSTART:{start:%Y%m%dT%H%M%SZ}" in unfolded and f"DTEND:{start + timedelta(hours=2):%Y%m%dT%H%M%SZ}" in unfolded
    assert "SUMMARY:Friday Readers" in unfolded and "LOCATION:The Pub\\, Main St" in unfolded
    assert book.title in unfolded and "Who\\; why?" in unfolded and "Second" in unfolded
    uid = next(line for line in unfolded.split("\r\n") if line.startswith("UID:"))
    team.as_(team.m2)
    assert next(line for line in team.client.get(f"/clubs/{team.cid}/meetings/{meeting['id']}.ics").text.replace("\r\n ", "").split("\r\n") if line.startswith("UID:")) == uid
    team.as_(team.owner)                                                                         # editing the meeting keeps the UID, so a re-download updates it
    team.client.patch(f"/clubs/{team.cid}/meetings/{meeting['id']}", json={"place": None, "link": "https://meet.example.com/r"})
    again = team.client.get(f"/clubs/{team.cid}/meetings/{meeting['id']}.ics").text.replace("\r\n ", "")
    assert uid in again and "LOCATION:https://meet.example.com/r" in again


def test_my_clubs_lists_the_next_meeting_time(team):
    team.as_(team.m1)
    assert team.client.get("/me/clubs").json()["items"][0]["next_meeting_at"] is None
    meet(team, team.owner)
    team.as_(team.m1)
    value = team.client.get("/me/clubs").json()["items"][0]["next_meeting_at"]
    assert abs(datetime.fromisoformat(value) - (NOW + timedelta(days=3))).total_seconds() < 60


def test_leaving_or_being_removed_clears_that_members_rsvp_and_votes(team):
    mid = meet(team, team.owner).json()["id"]
    sid = suggest(team, team.owner, team.book("A")).json()["id"]
    for who in (team.m1, team.m2):
        team.as_(who)
        team.client.put(f"/clubs/{team.cid}/meetings/{mid}/rsvp", json={"status": "going"})
        vote(team, who, sid)
    team.as_(team.m1)
    assert team.client.post(f"/clubs/{team.cid}/leave").status_code == 204
    team.as_(team.owner)
    assert team.client.delete(f"/clubs/{team.cid}/members/{team.m2.id}").status_code == 204
    team.db.rollback()
    assert team.db.scalar(text("SELECT count(*) FROM club_meeting_rsvps WHERE meeting_id = :m"), {"m": mid}) == 0
    assert team.db.scalar(text("SELECT count(*) FROM club_votes WHERE suggestion_id = :s"), {"s": sid}) == 0


def test_deleting_a_club_removes_its_meetings_and_votes_and_a_deleted_account_keeps_the_meeting(team):
    mid = meet(team, team.admin).json()["id"]
    sid = suggest(team, team.m1, team.book("Gone")).json()["id"]
    vote(team, team.m2, sid)
    team.as_(team.m2)
    team.client.put(f"/clubs/{team.cid}/meetings/{mid}/rsvp", json={"status": "maybe"})
    team.db.execute(text("DELETE FROM users WHERE id = :u"), {"u": team.admin.id})        # the creator goes: the meeting stays for the club
    team.db.commit()
    assert team.db.scalar(text("SELECT created_by FROM club_meetings WHERE id = :m"), {"m": mid}) is None
    team.db.execute(text("DELETE FROM users WHERE id = :u"), {"u": team.m1.id})            # the suggester goes: the suggestion and its votes go
    team.db.commit()
    assert team.db.scalar(text("SELECT count(*) FROM club_suggestions WHERE id = :s"), {"s": sid}) == 0
    assert team.db.scalar(text("SELECT count(*) FROM club_votes WHERE suggestion_id = :s"), {"s": sid}) == 0
    team.db.execute(text("DELETE FROM clubs WHERE id = :c"), {"c": team.cid})
    team.db.commit()
    assert team.db.scalar(text("SELECT count(*) FROM club_meetings WHERE club_id = :c"), {"c": team.cid}) == 0
    assert team.db.scalar(text("SELECT count(*) FROM club_meeting_rsvps WHERE meeting_id = :m"), {"m": mid}) == 0


# --- suggestions and votes -----------------------------------------------------------------------------------------------------

def test_members_suggest_and_everyone_sees_the_ranked_list(team):
    a, b, c = team.book("Alpha"), team.book("Beta"), team.book("Gamma")
    assert suggest(team, team.outsider, a).status_code == 404
    sa = suggest(team, team.m1, a, note="Short and sweet").json()
    sb = suggest(team, team.m2, b).json()
    sc = suggest(team, team.admin, c).json()
    assert sa["note"] == "Short and sweet" and sa["votes"] == 0 and sa["my_vote"] is False and sa["mine"] is True and sa["suggested_by"] == {"name": "Mia"}
    assert sa["book"] == {"id": a.id, "title": a.title, "authors": ["Club Author"], "cover_image_url": a.cover_image_url, "page_count": 300}
    vote(team, team.owner, sc["id"])
    vote(team, team.m1, sc["id"])
    vote(team, team.owner, sb["id"])
    team.as_(team.owner)
    listed = team.client.get(f"/clubs/{team.cid}/suggestions").json()["items"]
    assert [i["id"] for i in listed] == [sc["id"], sb["id"], sa["id"]]                          # votes descending, then oldest first
    assert [(i["votes"], i["my_vote"], i["mine"]) for i in listed] == [(2, True, False), (1, True, False), (0, False, False)]
    team.as_(team.outsider)
    assert team.client.get(f"/clubs/{team.cid}/suggestions").status_code == 404
    for bad in ({"book_id": 0}, {"book_id": a.id, "note": "n" * 201}, {"book_id": a.id, "extra": 1}):
        team.as_(team.m1)
        assert team.client.post(f"/clubs/{team.cid}/suggestions", json=bad).status_code == 422
    team.as_(team.m1)
    assert team.client.post(f"/clubs/{team.cid}/suggestions", json={"book_id": 99999999}).status_code == 404


def test_a_book_is_suggested_once_and_not_if_it_is_already_on_the_shelf(team):
    a, b, c = team.book("A"), team.book("B"), team.book("C")
    assert suggest(team, team.m1, a).status_code == 201
    dup = suggest(team, team.m2, a)
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "already_suggested"
    team.current_book(team.owner, team.cid, b)
    on = suggest(team, team.m2, b)
    assert on.status_code == 409 and on.json()["detail"]["code"] == "on_club_shelf"
    team.as_(team.owner)
    team.client.post(f"/clubs/{team.cid}/books", json={"book_id": c.id, "status": "upcoming"})
    assert suggest(team, team.m2, c).json()["detail"]["code"] == "on_club_shelf"
    past = team.book("Past")
    team.client.post(f"/clubs/{team.cid}/books", json={"book_id": past.id, "status": "past"})
    assert suggest(team, team.m2, past).status_code == 201                                      # a book already read may be suggested again


def test_at_most_twenty_open_suggestions(team):
    for n in range(20):
        assert suggest(team, team.m1, team.book(f"S{n}")).status_code == 201
        if n % 5 == 4:
            from rate_limit import limiter
            limiter.reset()
    over = suggest(team, team.m2, team.book("S21"))
    assert over.status_code == 409 and over.json()["detail"]["code"] == "too_many_suggestions"


def test_who_may_remove_a_suggestion(team):
    sid = suggest(team, team.m1, team.book("Mine")).json()["id"]
    team.as_(team.m2)
    assert team.client.delete(f"/clubs/{team.cid}/suggestions/{sid}").status_code == 403
    team.as_(team.outsider)
    assert team.client.delete(f"/clubs/{team.cid}/suggestions/{sid}").status_code == 404
    team.as_(team.m1)
    assert team.client.delete(f"/clubs/{team.cid}/suggestions/{sid}").status_code == 204
    other = suggest(team, team.m2, team.book("Other")).json()["id"]
    team.as_(team.admin)
    assert team.client.delete(f"/clubs/{team.cid}/suggestions/{other}").status_code == 204
    third = suggest(team, team.m2, team.book("Third")).json()["id"]
    team.as_(team.owner)
    assert team.client.delete(f"/clubs/{team.cid}/suggestions/{third}").status_code == 204
    assert team.client.delete(f"/clubs/{team.cid}/suggestions/{third}").status_code == 404


def test_voting_toggles_and_is_idempotent(team):
    sid = suggest(team, team.m1, team.book("V")).json()["id"]
    assert vote(team, team.m2, sid).json() == {"votes": 1, "my_vote": True}
    assert vote(team, team.m2, sid).json() == {"votes": 1, "my_vote": True}                     # a second PUT changes nothing
    assert vote(team, team.owner, sid).json() == {"votes": 2, "my_vote": True}
    assert vote(team, team.m2, sid, "delete").json() == {"votes": 1, "my_vote": False}
    again = vote(team, team.m2, sid, "delete")
    assert again.status_code == 200 and again.json() == {"votes": 1, "my_vote": False}          # DELETE with no vote is fine
    assert vote(team, team.outsider, sid).status_code == 404
    assert vote(team, team.m2, 99999999).status_code == 404
    other = team.club(team.m1, "Elsewhere")
    assert vote(team, team.m1, sid, club_id=other).status_code == 404                           # a suggestion of another club


def test_closing_picks_the_top_suggestion_clears_every_vote_and_keeps_the_rest(team):
    a, b, c = team.book("First"), team.book("Second"), team.book("Third")
    sa, sb, sc = (suggest(team, team.m1, x).json()["id"] for x in (a, b, c))
    for who in (team.m1, team.m2):
        vote(team, who, sb)
    vote(team, team.owner, sc)
    vote(team, team.owner, sa)
    team.as_(team.m1)
    assert team.client.post(f"/clubs/{team.cid}/suggestions/close").status_code == 403
    team.as_(team.outsider)
    assert team.client.post(f"/clubs/{team.cid}/suggestions/close").status_code == 404
    team.as_(team.admin)
    closed = team.client.post(f"/clubs/{team.cid}/suggestions/close")
    assert closed.status_code == 200, closed.text
    body = closed.json()
    assert body["title"] == b.title and body["votes"] == 2 and body["club_book"]["book_id"] == b.id and body["club_book"]["status"] == "current"
    rest = team.client.get(f"/clubs/{team.cid}/suggestions").json()["items"]
    assert [i["id"] for i in rest] == [sa, sc] and all(i["votes"] == 0 and i["my_vote"] is False for i in rest)
    assert team.db.scalar(text("SELECT count(*) FROM club_votes WHERE suggestion_id = ANY(:s)"), {"s": [sa, sb, sc]}) == 0
    assert suggest(team, team.m2, b).json()["detail"]["code"] == "on_club_shelf"
    team.as_(team.admin)
    second = team.client.post(f"/clubs/{team.cid}/suggestions/close").json()                     # a current book exists now: the winner is upcoming
    assert second["club_book"]["status"] == "upcoming" and second["title"] == a.title           # a tie (0 votes) goes to the oldest


def test_a_tie_goes_to_the_oldest_suggestion(team):
    a, b = team.book("Old"), team.book("New")
    sa, sb = (suggest(team, team.m1, x).json()["id"] for x in (a, b))
    vote(team, team.m1, sb)
    vote(team, team.m2, sa)
    team.as_(team.owner)
    assert team.client.post(f"/clubs/{team.cid}/suggestions/close").json()["title"] == a.title


def test_closing_with_nothing_to_close_or_a_full_shelf_is_a_409(team):
    team.as_(team.owner)
    empty = team.client.post(f"/clubs/{team.cid}/suggestions/close")
    assert empty.status_code == 409 and empty.json()["detail"]["code"] == "no_suggestions"
    sid = suggest(team, team.m1, team.book("Late")).json()["id"]
    from services import clubs
    rows = [team.models.ClubBook(club_id=team.cid, book_id=team.book(f"Shelf{n}").id, status="past") for n in range(clubs.MAX_BOOKS)]
    team.db.add_all(rows)
    team.db.commit()
    team.as_(team.owner)
    full = team.client.post(f"/clubs/{team.cid}/suggestions/close")
    assert full.status_code == 409 and full.json()["detail"]["code"] == "club_shelf_full"
    assert team.db.scalar(text("SELECT count(*) FROM club_suggestions WHERE id = :s"), {"s": sid}) == 1      # nothing was lost


# --- statements ------------------------------------------------------------------------------------------------------------------

def test_statements_do_not_grow_with_clubs_or_meetings(team, app_modules):
    reader = team.m1

    def add(n):
        cid = team.club(team.owner, f"Count {n:02d}")
        team.add_member(cid, reader)
        meet(team, team.owner, club_id=cid)
        suggest(team, team.owner, team.book(f"C{n}"), club_id=cid)

    add(0)
    one_list, response = counting(team, app_modules, reader, "/me/clubs")
    ours = next(i for i in response.json()["items"] if i["name"] == "Count 00")
    assert ours["next_meeting_at"]
    club_id = ours["id"]
    counting(team, app_modules, reader, f"/clubs/{club_id}")                                       # the first open also records "last seen"; measure the next one
    one_detail, _ = counting(team, app_modules, reader, f"/clubs/{club_id}")
    one_members, _ = counting(team, app_modules, reader, f"/clubs/{club_id}/members")
    one_sugg, _ = counting(team, app_modules, reader, f"/clubs/{club_id}/suggestions")
    for n in range(1, 9):                                                                          # nine owned clubs plus the fixture's: the owner's limit is ten
        add(n)
        from rate_limit import limiter
        limiter.reset()
    many_list, response = counting(team, app_modules, reader, "/me/clubs")
    assert len(response.json()["items"]) == 10 and many_list == one_list
    assert counting(team, app_modules, reader, f"/clubs/{club_id}")[0] == one_detail
    assert counting(team, app_modules, reader, f"/clubs/{club_id}/members")[0] == one_members
    assert counting(team, app_modules, reader, f"/clubs/{club_id}/suggestions")[0] == one_sugg
    assert one_sugg <= 3                                                                          # one list statement plus the sign-in lookup
