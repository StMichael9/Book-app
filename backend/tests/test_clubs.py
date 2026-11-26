"""T78A: free book clubs. Privacy (members only), invites, the 25-member cap and Club Plus, roles and moderation, spoiler-safe posts from
each member's own progress, reports, opt-in progress sharing, events and constant statement counts."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, event, text

NOW = datetime.now(timezone.utc)


@pytest.fixture()
def world(client, db_session, app_modules):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    from services import event_counts
    models = app_modules["models"]
    limiter.reset()
    for table in ("event_counts",):
        db_session.execute(text(f"DELETE FROM {table}"))
    db_session.commit()
    event_counts.window.reset()
    made = {"users": [], "books": []}

    class W:
        pass

    w = W()
    w.client, w.db, w.models, w.made = client, db_session, models, made

    def person(name=None):
        item = models.User(email=f"club-{uuid.uuid4().hex[:8]}@club-fixture.org", hashed_password="x", display_name=name)
        db_session.add(item)
        db_session.commit()
        made["users"].append(item.id)
        return item

    def as_(item):
        app_modules["main"].app.dependency_overrides[get_current_user] = lambda: item

    def book(title="Club Read", pages=300):
        item = models.Book(title=f"{title} {uuid.uuid4().hex[:5]}", description="d", published_year=2000, page_count=pages,
                           cover_image_url="https://covers.openlibrary.org/b/id/1-L.jpg", source_id=f"/works/OLC{uuid.uuid4().hex[:6]}W")
        item.authors = [models.Author(name="Club Author")]
        db_session.add(item)
        db_session.commit()
        made["books"].append(item.id)
        return item

    def read(user, book, *, pages=None, percent=None, state="reading"):
        """A reading of the book by the user, with their own progress."""
        entry = db_session.scalar(text("SELECT id FROM user_books WHERE user_id = :u AND book_id = :b"), {"u": user.id, "b": book.id})
        if entry is None:
            row = models.UserBook(user_id=user.id, book_id=book.id, is_owned=True)
            db_session.add(row)
            db_session.commit()
            entry = row.id
        unit, value = ("pages", pages) if pages is not None else (("percent", percent) if percent is not None else (None, None))
        if state in ("reading", "paused") and db_session.scalar(text("SELECT 1 FROM reading_attempts WHERE user_book_id = :e AND state IN ('reading', 'paused')"), {"e": entry}):
            db_session.execute(text("UPDATE reading_attempts SET progress_unit = :u, progress_value = :v WHERE user_book_id = :e AND state IN ('reading', 'paused')"),
                               {"u": unit, "v": value, "e": entry})
            db_session.commit()
            return
        db_session.add(models.ReadingAttempt(id=uuid.uuid4(), user_book_id=entry, state=state, creation_fingerprint=uuid.uuid4().hex * 2,
                                             progress_unit=unit, progress_value=value, total_pages=book.page_count,
                                             ended_on=NOW.date() if state == "finished" else None, started_on=NOW.date() - timedelta(days=2)))
        db_session.commit()

    def club(owner, name="Friday Readers"):
        as_(owner)
        response = client.post("/me/clubs", json={"name": name})
        assert response.status_code == 201, response.text
        return response.json()["id"]

    def invite(owner, club_id, **body):
        as_(owner)
        response = client.post(f"/clubs/{club_id}/invites", json=body)
        assert response.status_code == 201, response.text
        return response.json()["url"].split("/c/")[1].split("?")[0]

    def join(member, token):
        as_(member)
        return client.post("/me/clubs/join", json={"token": token})

    def add_member(club_id, member, role="member"):
        db_session.add(models.ClubMember(club_id=club_id, user_id=member.id, role=role))
        db_session.commit()

    def current_book(owner, club_id, book_row):
        as_(owner)
        response = client.post(f"/clubs/{club_id}/books", json={"book_id": book_row.id, "status": "current"})
        assert response.status_code == 201, response.text
        return response.json()["id"]

    w.person, w.as_, w.book, w.read, w.club, w.invite, w.join, w.add_member, w.current_book = person, as_, book, read, club, invite, join, add_member, current_book
    yield w
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    limiter.reset()
    db_session.rollback()
    db_session.execute(text("DELETE FROM entitlements"))
    db_session.execute(text("DELETE FROM clubs WHERE owner_id = ANY(:u)"), {"u": made["users"]})
    db_session.execute(text("DELETE FROM event_counts"))
    db_session.execute(delete(models.UserBook).where(models.UserBook.user_id.in_(made["users"])))
    db_session.commit()
    for book_id in made["books"]:
        obj = db_session.get(models.Book, book_id)
        if obj is not None:
            db_session.delete(obj)
    db_session.commit()
    db_session.execute(delete(models.User).where(models.User.id.in_(made["users"])))
    db_session.commit()


def counted(w):
    w.db.expire_all()
    return {name: int(n) for name, n in w.db.execute(text("SELECT name, sum(count) FROM event_counts GROUP BY name"))}


# --- clubs, privacy ----------------------------------------------------------------------------------------------------------

def test_create_list_and_detail_and_only_members_can_see_a_club(world):
    owner, outsider = world.person("Olga Owner"), world.person()
    club_id = world.club(owner)
    world.as_(owner)
    listed = world.client.get("/me/clubs").json()["items"]
    assert [(c["id"], c["role"], c["member_count"], c["current_book"]) for c in listed] == [(club_id, "owner", 1, None)]
    detail = world.client.get(f"/clubs/{club_id}").json()
    assert detail["me"] == {"role": "owner", "share_progress": False} and detail["cap"] == {"free_limit": 25, "full": False} and detail["club_plus"] is False
    world.as_(outsider)
    for method, path in (("get", f"/clubs/{club_id}"), ("get", f"/clubs/{club_id}/members"), ("get", f"/clubs/{club_id}/invites"), ("get", f"/clubs/{club_id}/reports"),
                         ("patch", f"/clubs/{club_id}"), ("delete", f"/clubs/{club_id}"), ("post", f"/clubs/{club_id}/leave")):
        response = getattr(world.client, method)(path, **({"json": {"name": "x"}} if method == "patch" else {}))
        assert response.status_code == 404, (method, path)
    assert world.client.get("/me/clubs").json()["items"] == []
    assert world.client.get("/clubs/999999").status_code == 404                              # an unknown club looks the same as a private one
    assert counted(world) == {"club_created": 1}


def test_club_input_is_validated_and_the_number_of_owned_clubs_is_limited(world):
    owner = world.person()
    world.as_(owner)
    for bad in ({"name": ""}, {"name": "   "}, {"name": "x" * 81}, {"name": "ok", "description": "d" * 501}, {"name": "ok", "color": "not a colour!"}, {"name": "ok", "visibility": "public"}):
        assert world.client.post("/me/clubs", json=bad).status_code == 422, bad
    for n in range(10):
        assert world.client.post("/me/clubs", json={"name": f"Club {n}"}).status_code == 201
        world.client.app.dependency_overrides  # keep the same reader
    from rate_limit import limiter
    limiter.reset()
    assert world.client.post("/me/clubs", json={"name": "One too many"}).json()["detail"]["code"] == "too_many_clubs"


def test_the_owner_edits_and_deletes_the_club_and_nobody_else_can(world):
    owner, member = world.person(), world.person()
    club_id = world.club(owner)
    world.add_member(club_id, member)
    world.as_(member)
    assert world.client.patch(f"/clubs/{club_id}", json={"name": "Mine now"}).status_code == 403
    assert world.client.delete(f"/clubs/{club_id}").status_code == 403
    world.as_(owner)
    assert world.client.patch(f"/clubs/{club_id}", json={"name": "Renamed", "description": "Fridays", "color": "#aabbcc"}).json()["name"] == "Renamed"
    assert world.client.patch(f"/clubs/{club_id}", json={"name": None}).status_code == 422
    assert world.client.delete(f"/clubs/{club_id}").status_code == 204
    assert world.db.scalar(text("SELECT count(*) FROM club_members WHERE club_id = :c"), {"c": club_id}) == 0


# --- invites ----------------------------------------------------------------------------------------------------------------------

def test_an_invite_link_is_a_32_byte_token_with_the_club_ref_and_previews_without_sign_in(world):
    from auth.dependencies import get_current_user
    owner = world.person()
    club_id = world.club(owner, "Secret Society")
    world.as_(owner)
    created = world.client.post(f"/clubs/{club_id}/invites", json={"expires_in_days": 7, "max_uses": 5}).json()
    assert created["url"].startswith("https://") and "/c/" in created["url"] and created["url"].endswith("?ref=club") and created["max_uses"] == 5
    token = created["url"].split("/c/")[1].split("?")[0]
    assert len(token) == 43
    world.client.app.dependency_overrides.pop(get_current_user, None)
    preview = world.client.get(f"/club-invites/{token}")
    assert preview.status_code == 200 and preview.json() == {"name": "Secret Society", "description": None, "color": None, "member_count": 1, "full": False,
                                                                  "member_limit": 25, "effective_cap": 25, "owner_name": "A reader", "current_book": None}
    assert preview.headers["cache-control"] == "private, no-store" and "noindex" in preview.headers["x-robots-tag"]
    for bad in ("nope", "a" * 43, token + "x", "..", "a" * 200):
        assert world.client.get(f"/club-invites/{bad}").status_code == 404, bad


def test_joining_by_invite_is_idempotent_counts_uses_and_respects_expiry_revocation_and_limits(world):
    owner, ann, ben, cat = world.person(), world.person(), world.person(), world.person()
    club_id = world.club(owner)
    token = world.invite(owner, club_id, max_uses=2)
    first = world.join(ann, token)
    assert first.status_code == 200 and first.json() == {"id": club_id, "name": "Friday Readers", "joined": True}
    again = world.join(ann, token)
    assert again.json()["joined"] is False                                                  # already a member: no second use is spent
    assert world.db.scalar(text("SELECT uses FROM club_invites")) == 1
    assert world.join(ben, token).status_code == 200
    assert world.join(cat, token).status_code == 404                                         # used up: looks like any bad link
    assert counted(world)["club_joined"] == 2
    expiring = world.invite(owner, club_id)
    world.db.execute(text("UPDATE club_invites SET expires_at = now() - interval '1 minute' WHERE token = :t"), {"t": expiring})
    world.db.commit()
    assert world.join(cat, expiring).status_code == 404
    revoked = world.invite(owner, club_id)
    world.as_(owner)
    listed = world.client.get(f"/clubs/{club_id}/invites").json()["items"]
    assert sorted(item["state"] for item in listed) == ["active", "expired", "used_up"] and all("token" not in item for item in listed)
    invite_id = [item["id"] for item in listed if item["state"] == "active"][0]
    assert world.client.delete(f"/clubs/{club_id}/invites/{invite_id}").status_code == 204
    assert world.join(cat, revoked).status_code == 404
    assert world.client.get(f"/club-invites/{revoked}").status_code == 404
    world.as_(ann)
    assert world.client.post(f"/clubs/{club_id}/invites", json={}).status_code == 403          # members cannot make invites
    assert world.client.get(f"/clubs/{club_id}/invites").status_code == 403


def test_invite_options_are_validated(world):
    owner = world.person()
    club_id = world.club(owner)
    world.as_(owner)
    for bad in ({"expires_in_days": 0}, {"expires_in_days": 61}, {"max_uses": 0}, {"max_uses": 1001}, {"extra": 1}):
        assert world.client.post(f"/clubs/{club_id}/invites", json=bad).status_code == 422, bad


# --- the cap and Club Plus ------------------------------------------------------------------------------------------------------------

def test_the_free_cap_is_25_and_club_plus_lifts_it_and_a_lapse_removes_nobody(world):
    owner, latecomer = world.person(), world.person()
    club_id = world.club(owner)
    for _ in range(24):
        world.add_member(club_id, world.person())
    token = world.invite(owner, club_id)
    world.as_(owner)
    assert world.client.get(f"/clubs/{club_id}").json()["cap"] == {"free_limit": 25, "full": True}
    assert world.client.get(f"/club-invites/{token}").json()["full"] is True
    refused = world.join(latecomer, token)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "club_full"
    assert world.db.scalar(text("SELECT count(*) FROM club_members WHERE club_id = :c"), {"c": club_id}) == 25
    # Club Plus is live: the cap is gone
    world.db.add(world.models.Entitlement(user_id=owner.id, kind="club_plus", club_id=club_id, stripe_subscription_id="sub_cp", status="active"))
    world.db.commit()
    assert world.join(latecomer, token).status_code == 200
    world.as_(owner)
    detail = world.client.get(f"/clubs/{club_id}").json()
    assert detail["club_plus"] is True and detail["member_count"] == 26 and detail["cap"]["full"] is False
    # Plus lapses (payment failed more than 7 days ago): nobody is removed, new joins pause
    world.db.execute(text("UPDATE entitlements SET status = 'past_due', payment_failed_at = now() - interval '9 days'"))
    world.db.commit()
    world.as_(owner)
    lapsed = world.client.get(f"/clubs/{club_id}").json()
    assert lapsed["club_plus"] is False and lapsed["member_count"] == 26 and lapsed["cap"]["full"] is True
    assert world.join(world.person(), token).json()["detail"]["code"] == "club_full"
    world.as_(owner)
    assert len(world.client.get(f"/clubs/{club_id}/members").json()["items"]) == 26             # all 26 are still there
    # members may still leave, and the club is open to joins again under the cap
    leaver = world.person()
    world.add_member(club_id, leaver)
    world.as_(leaver)
    assert world.client.post(f"/clubs/{club_id}/leave").status_code == 204
    assert world.client.get(f"/clubs/{club_id}").status_code == 404


def test_a_club_with_billing_history_cannot_be_deleted_while_plus_is_live(world):
    owner = world.person()
    club_id = world.club(owner)
    world.db.add(world.models.Entitlement(user_id=owner.id, kind="club_plus", club_id=club_id, stripe_subscription_id="sub_del", status="active"))
    world.db.commit()
    world.as_(owner)
    assert world.client.delete(f"/clubs/{club_id}").json()["detail"]["code"] == "cancel_club_plus_first"
    world.db.execute(text("UPDATE entitlements SET status = 'canceled'"))
    world.db.commit()
    assert world.client.delete(f"/clubs/{club_id}").json()["detail"]["code"] == "club_has_billing_history"       # the paid record is kept


# --- roles and moderation ---------------------------------------------------------------------------------------------------------------

def test_roles_removal_and_leaving(world):
    owner, admin, ann, ben = world.person("Owner"), world.person("Admin"), world.person("Ann"), world.person("Ben")
    club_id = world.club(owner)
    for member in (admin, ann, ben):
        world.add_member(club_id, member)
    world.as_(ann)
    assert world.client.patch(f"/clubs/{club_id}/members/{ben.id}", json={"role": "admin"}).status_code == 403
    assert world.client.delete(f"/clubs/{club_id}/members/{ben.id}").status_code == 403
    world.as_(owner)
    assert world.client.patch(f"/clubs/{club_id}/members/{admin.id}", json={"role": "admin"}).json() == {"role": "admin"}
    assert world.client.patch(f"/clubs/{club_id}/members/{owner.id}", json={"role": "member"}).status_code == 409
    assert world.client.patch(f"/clubs/{club_id}/members/{ann.id}", json={"role": "owner"}).status_code == 422
    world.as_(admin)
    assert world.client.delete(f"/clubs/{club_id}/members/{owner.id}").status_code == 403           # an admin cannot remove the owner
    world.as_(owner)
    world.client.patch(f"/clubs/{club_id}/members/{ann.id}", json={"role": "admin"})
    world.as_(admin)
    assert world.client.delete(f"/clubs/{club_id}/members/{ann.id}").status_code == 403             # ... or another admin
    assert world.client.delete(f"/clubs/{club_id}/members/{ben.id}").status_code == 204             # but can remove a member
    assert world.client.delete(f"/clubs/{club_id}/members/{admin.id}").json()["detail"]["code"] == "use_leave"
    world.as_(ben)
    assert world.client.get(f"/clubs/{club_id}").status_code == 404                                    # removed: the club is gone for them
    world.as_(owner)
    assert world.client.post(f"/clubs/{club_id}/leave").json()["detail"]["code"] == "owner_cannot_leave"
    assert world.client.delete(f"/clubs/{club_id}/members/{ann.id}").status_code == 204
    names = [m["name"] for m in world.client.get(f"/clubs/{club_id}/members").json()["items"]]
    assert names == ["Owner", "Admin"]


# --- books and checkpoints ----------------------------------------------------------------------------------------------------------------

def test_one_current_book_checkpoints_and_who_may_change_them(world):
    owner, member = world.person(), world.person()
    club_id = world.club(owner)
    world.add_member(club_id, member)
    first, second, third = world.book("One"), world.book("Two"), world.book("Three")
    first_id = world.current_book(owner, club_id, first)
    second_id = world.current_book(owner, club_id, second)                                              # a new current book retires the old one
    world.as_(owner)
    books = {b["id"]: b for b in world.client.get(f"/clubs/{club_id}").json()["books"]}
    assert books[first_id]["status"] == "past" and books[second_id]["status"] == "current"
    upcoming = world.client.post(f"/clubs/{club_id}/books", json={"book_id": third.id, "starts_on": "2026-12-01", "ends_on": "2026-12-31"}).json()
    assert upcoming["status"] == "upcoming"
    assert world.client.patch(f"/clubs/{club_id}/books/{upcoming['id']}", json={"status": "current"}).json()["status"] == "current"
    assert {b["id"]: b["status"] for b in world.client.get(f"/clubs/{club_id}").json()["books"]}[second_id] == "past"
    assert world.client.post(f"/clubs/{club_id}/books", json={"book_id": third.id, "starts_on": "2026-12-31", "ends_on": "2026-12-01"}).status_code == 422
    assert world.client.post(f"/clubs/{club_id}/books", json={"book_id": 99999999}).status_code == 404
    cp = world.client.post(f"/clubs/{club_id}/books/{upcoming['id']}/checkpoints", json={"unit": "pages", "value": 120, "due_on": "2026-12-10", "label": "Part one"})
    assert cp.status_code == 201
    for bad in ({"unit": "percent", "value": 101}, {"unit": "pages", "value": -1}, {"unit": "chapters", "value": 3}, {"unit": "pages", "value": 1, "label": "x" * 81}):
        assert world.client.post(f"/clubs/{club_id}/books/{upcoming['id']}/checkpoints", json=bad).status_code == 422, bad
    detail = world.client.get(f"/clubs/{club_id}").json()["books"][0]
    assert detail["status"] == "current" and detail["checkpoints"] == [{"id": cp.json()["id"], "unit": "pages", "value": 120, "due_on": "2026-12-10", "label": "Part one"}]
    world.as_(member)
    assert world.client.post(f"/clubs/{club_id}/books", json={"book_id": first.id}).status_code == 403
    assert world.client.delete(f"/clubs/{club_id}/books/{upcoming['id']}/checkpoints/{cp.json()['id']}").status_code == 403
    world.as_(owner)
    assert world.client.delete(f"/clubs/{club_id}/books/{upcoming['id']}/checkpoints/{cp.json()['id']}").status_code == 204
    assert world.client.delete(f"/clubs/{club_id}/books/{upcoming['id']}").status_code == 204


# --- spoiler-safe discussion ---------------------------------------------------------------------------------------------------------------

def scene(world):
    owner, ann, ben, cat = world.person("Olga"), world.person("Ann"), world.person("Ben"), world.person("Cat")
    club_id = world.club(owner)
    for member in (ann, ben, cat):
        world.add_member(club_id, member)
    book = world.book("Spoilers", pages=300)
    club_book = world.current_book(owner, club_id, book)
    return owner, ann, ben, cat, club_id, book, club_book


def post(world, who, club_id, club_book, body, **anchor):
    world.as_(who)
    return world.client.post(f"/clubs/{club_id}/books/{club_book}/posts", json={"body": body, **anchor})


def feed(world, who, club_id, club_book):
    world.as_(who)
    return world.client.get(f"/clubs/{club_id}/books/{club_book}/posts").json()["items"]


def test_a_post_is_hidden_from_members_who_have_not_reached_it(world):
    owner, ann, ben, cat, club_id, book, club_book = scene(world)
    world.read(ann, book, pages=150)
    world.read(cat, book, percent=10)
    # Ann, at page 150, posts with no anchor: it is anchored at her own page
    mine = post(world, ann, club_id, club_book, "The twist on page 150 is wild").json()
    assert mine["anchor"] == {"unit": "pages", "value": 150} and mine["mine"] is True and mine["author"]["name"] == "Ann"
    post(world, owner, club_id, club_book, "Welcome everyone", anchor_unit="pages", anchor_value=0)            # the start: open to all
    items = {item["id"]: item for item in feed(world, ben, club_id, club_book)}            # Ben has no progress at all
    assert items[mine["id"]] == {"id": mine["id"], "locked": True, "unlocks_at": {"unit": "pages", "value": 150}, "created_at": items[mine["id"]]["created_at"],
                                  "author": {"name": "Ann"}}
    assert "body" not in items[mine["id"]] and "twist" not in str(items[mine["id"]])
    welcome = [item for item in items.values() if item.get("body") == "Welcome everyone"]
    assert len(welcome) == 1                                                                   # members with no progress see only what is anchored at the start
    assert [i["locked"] for i in feed(world, cat, club_id, club_book) if i["id"] == mine["id"]] == [True]     # 10% of 300 pages is page 30: still locked
    assert [i["body"] for i in feed(world, ann, club_id, club_book) if i["id"] == mine["id"]] == ["The twist on page 150 is wild"]   # the author sees their own
    world.read(cat, book, pages=200)                                                             # Cat gets ahead: the post opens
    assert [i.get("body") for i in feed(world, cat, club_id, club_book) if i["id"] == mine["id"]] == ["The twist on page 150 is wild"]


def test_percent_and_pages_are_compared_through_the_books_length_and_finishing_opens_everything(world):
    owner, ann, ben, cat, club_id, book, club_book = scene(world)
    world.read(ann, book, percent=60)
    pages_post = post(world, ann, club_id, club_book, "Page 150 is half way", anchor_unit="pages", anchor_value=150)      # 150 of 300 pages = 50%
    percent_post = post(world, ann, club_id, club_book, "At 55 percent", anchor_unit="percent", anchor_value=55)
    assert pages_post.status_code == 201 and percent_post.status_code == 201
    ahead = post(world, ann, club_id, club_book, "At 70 percent", anchor_unit="percent", anchor_value=70)
    assert ahead.status_code == 422 and ahead.json()["detail"]["code"] == "anchor_ahead_of_progress"       # no claiming pages she has not reached
    assert post(world, ben, club_id, club_book, "No progress, no spoilers", anchor_unit="pages", anchor_value=10).status_code == 422
    world.read(ben, book, state="finished")                                                                # a finished reader sees all of it
    bodies = [item.get("body") for item in feed(world, ben, club_id, club_book)]
    assert "Page 150 is half way" in bodies and "At 55 percent" in bodies
    world.read(cat, book, pages=100)                                                                         # 100 pages = 33%: both are ahead of Cat
    assert all(item.get("locked") for item in feed(world, cat, club_id, club_book))


def test_moderators_see_every_post_and_a_post_can_be_edited_only_by_its_author(world):
    owner, ann, ben, cat, club_id, book, club_book = scene(world)
    world.read(ann, book, pages=250)
    made = post(world, ann, club_id, club_book, "Ending thoughts").json()
    assert [i.get("body") for i in feed(world, owner, club_id, club_book)] == ["Ending thoughts"]
    world.as_(ann)
    assert world.client.patch(f"/clubs/{club_id}/posts/{made['id']}", json={"body": "Edited"}).json()["body"] == "Edited"
    world.as_(owner)
    assert world.client.patch(f"/clubs/{club_id}/posts/{made['id']}", json={"body": "Hijack"}).status_code == 403
    world.as_(ben)
    assert world.client.patch(f"/clubs/{club_id}/posts/{made['id']}", json={"body": "Hijack"}).status_code == 403
    assert world.client.delete(f"/clubs/{club_id}/posts/{made['id']}").status_code == 403
    world.as_(ann)
    assert feed(world, ann, club_id, club_book)[0]["edited_at"]
    for bad in ({"body": ""}, {"body": "   "}, {"body": "x" * 2001}, {"body": "ok", "anchor_unit": "pages"}, {"body": "ok", "anchor_unit": "percent", "anchor_value": 101}):
        assert world.client.post(f"/clubs/{club_id}/books/{club_book}/posts", json=bad).status_code == 422, bad
    assert world.client.post(f"/clubs/{club_id}/books/999999/posts", json={"body": "x"}).status_code == 404


def test_deleting_a_post_by_its_author_or_a_moderator_removes_it_and_its_text(world):
    owner, ann, ben, cat, club_id, book, club_book = scene(world)
    first = post(world, ann, club_id, club_book, "Delete me", anchor_unit="pages", anchor_value=0).json()
    second = post(world, ben, club_id, club_book, "Mod will delete me", anchor_unit="pages", anchor_value=0).json()
    world.as_(ann)
    assert world.client.delete(f"/clubs/{club_id}/posts/{first['id']}").status_code == 204
    world.as_(owner)
    assert world.client.delete(f"/clubs/{club_id}/posts/{second['id']}").status_code == 204
    assert feed(world, owner, club_id, club_book) == []
    assert world.db.scalar(text("SELECT count(*) FROM club_posts WHERE body <> ''")) == 0 and world.db.scalar(text("SELECT count(*) FROM club_posts")) == 2
    assert world.client.delete(f"/clubs/{club_id}/posts/{first['id']}").status_code == 404


# --- reports ----------------------------------------------------------------------------------------------------------------------------------

def test_three_reports_hide_a_post_until_a_moderator_reviews_it(world):
    owner, ann, ben, cat, club_id, book, club_book = scene(world)
    dan, eve = world.person("Dan"), world.person("Eve")
    for member in (dan, eve):
        world.add_member(club_id, member)
    bad = post(world, ann, club_id, club_book, "Something rude", anchor_unit="pages", anchor_value=0).json()
    world.as_(ann)
    assert world.client.post(f"/clubs/{club_id}/posts/{bad['id']}/report", json={}).json()["detail"]["code"] == "cannot_report_own_post"
    for reporter, reason in ((ben, "rude"), (ben, "again"), (cat, None)):                                  # Ben twice still counts once
        world.as_(reporter)
        assert world.client.post(f"/clubs/{club_id}/posts/{bad['id']}/report", json={"reason": reason}).json() == {"reported": True}
    assert [i.get("body") for i in feed(world, dan, club_id, club_book)] == ["Something rude"]               # two reports: still visible
    world.as_(dan)
    world.client.post(f"/clubs/{club_id}/posts/{bad['id']}/report", json={"reason": "spam"})
    assert feed(world, eve, club_id, club_book) == [{"id": bad["id"], "hidden": True}]                       # the third distinct report hides it
    assert feed(world, ann, club_id, club_book) == [{"id": bad["id"], "hidden": True}]                       # even from its author, until reviewed
    mod_view = feed(world, owner, club_id, club_book)[0]
    assert mod_view["hidden"] is True and mod_view["report_count"] == 3 and mod_view["body"] == "Something rude"
    world.as_(owner)
    queue = world.client.get(f"/clubs/{club_id}/reports").json()["items"]
    assert len(queue) == 1 and queue[0]["report_count"] == 3 and sorted(queue[0]["reasons"]) == ["rude", "spam"] and queue[0]["hidden"] is True
    world.as_(ben)
    assert world.client.get(f"/clubs/{club_id}/reports").status_code == 403
    assert world.client.post(f"/clubs/{club_id}/posts/{bad['id']}/review", json={"action": "restore"}).status_code == 403
    world.as_(owner)
    assert world.client.post(f"/clubs/{club_id}/posts/{bad['id']}/review", json={"action": "restore"}).json() == {"action": "restore"}
    assert [i.get("body") for i in feed(world, eve, club_id, club_book)] == ["Something rude"]
    world.as_(owner)
    assert world.client.get(f"/clubs/{club_id}/reports").json()["items"] == []                                   # a restored post starts clean
    for reporter in (ben, cat, dan):
        world.as_(reporter)
        world.client.post(f"/clubs/{club_id}/posts/{bad['id']}/report", json={})
    world.as_(owner)
    assert world.client.post(f"/clubs/{club_id}/posts/{bad['id']}/review", json={"action": "delete"}).status_code == 200
    assert feed(world, owner, club_id, club_book) == [] and world.client.post(f"/clubs/{club_id}/posts/{bad['id']}/review", json={"action": "bogus"}).status_code == 422


def test_only_members_can_report_and_reports_are_not_visible_to_members(world):
    owner, ann, ben, cat, club_id, book, club_book = scene(world)
    stranger = world.person()
    made = post(world, ann, club_id, club_book, "Hello", anchor_unit="pages", anchor_value=0).json()
    world.as_(stranger)
    assert world.client.post(f"/clubs/{club_id}/posts/{made['id']}/report", json={}).status_code == 404
    world.as_(ben)
    world.client.post(f"/clubs/{club_id}/posts/{made['id']}/report", json={"reason": "secret reason"})
    assert "report" not in str(feed(world, cat, club_id, club_book)) and "secret reason" not in str(feed(world, ann, club_id, club_book))


# --- opt-in progress sharing ----------------------------------------------------------------------------------------------------------------------

def test_progress_is_shown_to_the_club_only_for_members_who_opted_in(world):
    owner, ann, ben, cat, club_id, book, club_book = scene(world)
    world.read(ann, book, pages=120)
    world.read(ben, book, percent=40)
    world.as_(owner)
    members = {m["name"]: m for m in world.client.get(f"/clubs/{club_id}/members").json()["items"]}
    assert all(m["progress"] is None for name, m in members.items() if name != "Olga") and members["Ann"]["shares_progress"] is False
    world.as_(ann)
    assert world.client.patch(f"/clubs/{club_id}/me", json={"share_progress": True}).json() == {"share_progress": True}
    assert world.client.patch(f"/clubs/{club_id}/me", json={"share_progress": "yes"}).status_code == 422
    world.as_(cat)
    members = {m["name"]: m for m in world.client.get(f"/clubs/{club_id}/members").json()["items"]}
    assert members["Ann"]["progress"] == {"state": "reading", "unit": "pages", "value": 120}
    assert members["Ben"]["progress"] is None                                                   # Ben did not opt in
    world.as_(ben)
    own = {m["name"]: m for m in world.client.get(f"/clubs/{club_id}/members").json()["items"]}
    assert own["Ben"]["progress"] == {"state": "reading", "unit": "percent", "value": 40} and own["Ben"]["me"] is True       # you always see your own
    world.as_(ann)
    world.client.patch(f"/clubs/{club_id}/me", json={"share_progress": False})
    world.as_(cat)
    assert {m["name"]: m for m in world.client.get(f"/clubs/{club_id}/members").json()["items"]}["Ann"]["progress"] is None


def test_patrons_get_a_badge_on_member_rows_and_posts(world):
    owner, ann, ben, cat, club_id, book, club_book = scene(world)
    world.db.add(world.models.Entitlement(user_id=ann.id, kind="patron", stripe_subscription_id="sub_badge", status="active"))
    world.db.commit()
    post(world, ann, club_id, club_book, "From a patron", anchor_unit="pages", anchor_value=0)
    world.as_(ben)
    members = {m["name"]: m["patron"] for m in world.client.get(f"/clubs/{club_id}/members").json()["items"]}
    assert members["Ann"] is True and members["Ben"] is False
    assert feed(world, ben, club_id, club_book)[0]["author"]["patron"] is True


def test_invite_preview_shows_the_owner_name_and_current_book_and_nothing_private(world):
    owner = world.person("Olive Owner")
    member = world.person("Secret Member")
    club_id = world.club(owner, "Open Door")
    world.add_member(club_id, member)
    book = world.book("Preview Read")
    club_book = world.current_book(owner, club_id, book)
    post(world, member, club_id, club_book, "a private thought", anchor_unit="pages", anchor_value=0)
    token = world.invite(owner, club_id)
    world.client.app.dependency_overrides.pop(__import__("auth.dependencies", fromlist=["x"]).get_current_user, None)
    response = world.client.get(f"/club-invites/{token}")
    body = response.json()
    assert response.status_code == 200 and body["owner_name"] == "Olive Owner"
    assert body["current_book"] == {"book_id": book.id, "title": book.title, "authors": ["Club Author"],
                                    "cover_image_url": "https://covers.openlibrary.org/b/id/1-L.jpg"}
    assert response.headers["cache-control"] == "private, no-store" and "noindex" in response.headers["x-robots-tag"]
    text_ = response.text
    assert "club-fixture.org" not in text_ and "Secret Member" not in text_ and "private thought" not in text_  # no email, member or post
    world.as_(owner)
    invites = world.client.get(f"/clubs/{club_id}/invites").json()["items"]
    world.client.delete(f"/clubs/{club_id}/invites/{invites[0]['id']}")
    world.client.app.dependency_overrides.pop(__import__("auth.dependencies", fromlist=["x"]).get_current_user, None)
    assert world.client.get(f"/club-invites/{token}").status_code == 404                       # a revoked link still errors


def test_club_detail_books_carry_authors_in_a_constant_number_of_statements(world, app_modules):
    owner = world.person()
    club_id = world.club(owner)
    engine = app_modules["database"].engine

    def statements():
        world.as_(owner)
        world.client.get(f"/clubs/{club_id}")               # opening the club stamps it once a minute: measure the steady state
        world.db.commit()
        world.db.expire_all()
        seen = []
        listener = lambda conn, cursor, statement, *a: seen.append(statement)
        event.listen(engine, "before_cursor_execute", listener)
        try:
            response = world.client.get(f"/clubs/{club_id}")
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len(seen), response.json()["books"]

    world.current_book(owner, club_id, world.book("First"))
    one, books = statements()
    assert [b["authors"] for b in books] == [["Club Author"]]
    for index in range(4):
        extra = world.book(f"More {index}")
        extra.authors = [world.models.Author(name="Second Author"), extra.authors[0]]
        world.db.commit()
        world.as_(owner)
        assert world.client.post(f"/clubs/{club_id}/books", json={"book_id": extra.id, "status": "upcoming"}).status_code == 201
    many, books = statements()
    assert len(books) == 5 and many == one
    assert sorted(books[-1]["authors"]) == ["Club Author", "Second Author"]


# --- statements, events, privacy ---------------------------------------------------------------------------------------------------------------------

def test_statement_counts_do_not_grow_with_members_or_posts(world, app_modules):
    owner, ann, ben, cat, club_id, book, club_book = scene(world)
    world.read(ben, book, pages=50)
    engine = app_modules["database"].engine

    def count(path, who):
        world.as_(who)
        world.client.get(f"/clubs/{club_id}")               # opening the club stamps it once a minute: measure the steady state
        world.db.commit()
        world.db.expire_all()
        seen = []
        listener = lambda conn, cursor, statement, *a: seen.append(statement)
        event.listen(engine, "before_cursor_execute", listener)
        try:
            assert world.client.get(path).status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len(seen)

    paths = ("/me/clubs", f"/clubs/{club_id}", f"/clubs/{club_id}/members", f"/clubs/{club_id}/books/{club_book}/posts", f"/clubs/{club_id}/reports")
    for n in range(2):
        post(world, ann, club_id, club_book, f"early {n}", anchor_unit="pages", anchor_value=0)
    before = [count(path, owner) for path in paths]
    before_member_view = count(paths[3], ben)
    for n in range(20):
        member = world.person(f"Member {n}")
        world.add_member(club_id, member)
        world.db.add(world.models.ClubPost(club_book_id=club_book, user_id=member.id, body=f"post {n}", anchor_unit="pages" if n % 2 else None,
                                           anchor_value=40 * n if n % 2 else None))
    world.db.commit()
    assert [count(path, owner) for path in paths] == before
    assert count(paths[3], ben) == before_member_view


def test_events_are_daily_totals_with_no_club_detail_and_club_is_a_ref(world):
    from services import event_counts
    owner, ann = world.person(), world.person()
    club_id = world.club(owner, "Counted Club")
    world.join(ann, world.invite(owner, club_id))
    assert counted(world) == {"club_created": 1, "club_joined": 1}
    rows = world.db.execute(text("SELECT name, src, placement, ref FROM event_counts")).all()
    assert all((src, placement, ref) == ("", "", "") for name, src, placement, ref in rows)
    assert event_counts.clean_ref("club") == "club"
    assert world.client.post("/events", json={"name": "club_created"}).status_code == 204
    assert counted(world)["club_created"] == 1                                                  # the browser cannot send it


def test_club_data_never_appears_in_another_readers_exports_or_the_public_pages(world):
    owner, ann, club_id, book, club_book = world.person("Olga"), world.person("Ann"), None, None, None
    club_id = world.club(owner, "Hidden Club Name")
    world.add_member(club_id, ann)
    book = world.book("Export Book")
    club_book = world.current_book(owner, club_id, book)
    world.read(ann, book, pages=10)
    post(world, ann, club_id, club_book, "Private discussion text", anchor_unit="pages", anchor_value=0)
    from auth.dependencies import get_current_user
    stranger = world.person()
    world.as_(stranger)
    for path in ("/me/reading-export", "/me/library", "/me/loans", "/me/clubs"):
        response = world.client.get(path)
        assert response.status_code in (200, 403)
        assert "Hidden Club Name" not in response.text and "Private discussion text" not in response.text, path
    world.client.app.dependency_overrides.pop(get_current_user, None)
    assert world.client.get(f"/clubs/{club_id}").status_code in (401, 403)                      # not signed in: no access at all
    assert world.client.get(f"/seo/book/{book.id}").status_code in (200, 404, 503)


def test_robots_keep_crawlers_off_the_club_pages(world):
    from pathlib import Path
    robots = (Path(__file__).resolve().parents[2] / "frontend" / "public" / "robots.txt").read_text(encoding="utf-8")
    assert robots.count("Disallow: /c/") == 2
    sitemap = (Path(__file__).resolve().parents[2] / "frontend" / "public" / "sitemap.xml").read_text(encoding="utf-8")
    assert "/c/" not in sitemap


# --- the clubs redesign: finish and start next, richer lists, what is new, owner-set size (T78C) ---------------------------------------------------------

TODAY = NOW.date()


def days(n):
    return str(TODAY + timedelta(days=n))


def counting(world, app_modules, who, path, method="get", **kwargs):
    """How many statements one request runs, and its response."""
    engine = app_modules["database"].engine
    world.as_(who)
    world.db.commit()
    world.db.expire_all()
    seen = []
    listener = lambda conn, cursor, statement, *a: seen.append(statement)
    event.listen(engine, "before_cursor_execute", listener)
    try:
        response = getattr(world.client, method)(path, **kwargs)
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    return len(seen), response


def upcoming(world, owner, club_id, book_row, **dates):
    world.as_(owner)
    response = world.client.post(f"/clubs/{club_id}/books", json={"book_id": book_row.id, "status": "upcoming", **dates})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def checkpoint(world, owner, club_id, club_book_id, value, due_on, unit="pages", label=None):
    world.as_(owner)
    response = world.client.post(f"/clubs/{club_id}/books/{club_book_id}/checkpoints", json={"unit": unit, "value": value, "due_on": due_on, "label": label})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def book_states(response):
    return {b["id"]: b for b in response.json()["books"]}


# A. finish and start next

def test_advance_finishes_the_current_book_and_starts_the_next_in_one_step(world):
    owner = world.person()
    club_id = world.club(owner)
    now_id = world.current_book(owner, club_id, world.book("Now"))
    next_id, later_id = upcoming(world, owner, club_id, world.book("Next")), upcoming(world, owner, club_id, world.book("Later"))
    world.as_(owner)
    response = world.client.post(f"/clubs/{club_id}/books/{now_id}/advance", json={"next_club_book_id": next_id})
    assert response.status_code == 200, response.text
    books = book_states(response)
    assert response.json()["id"] == club_id and response.json()["me"]["role"] == "owner"                    # the updated club detail
    assert (books[now_id]["status"], books[now_id]["ends_on"]) == ("past", days(0))
    assert (books[next_id]["status"], books[next_id]["starts_on"]) == ("current", days(0))
    assert books[later_id]["status"] == "upcoming" and books[later_id]["starts_on"] is None
    assert [b["id"] for b in response.json()["books"]][0] == next_id                                      # the current book still comes first


def test_advance_keeps_dates_that_are_already_set_and_never_breaks_the_date_rule(world):
    owner = world.person()
    club_id = world.club(owner)
    world.as_(owner)
    now_id = world.client.post(f"/clubs/{club_id}/books", json={"book_id": world.book("Dated").id, "status": "current",
                                                                "starts_on": days(-20), "ends_on": days(-2)}).json()["id"]
    next_id = upcoming(world, owner, club_id, world.book("Planned"), starts_on=days(5), ends_on=days(30))
    world.as_(owner)
    books = book_states(world.client.post(f"/clubs/{club_id}/books/{now_id}/advance", json={"next_club_book_id": next_id}))
    assert (books[now_id]["ends_on"], books[next_id]["starts_on"]) == (days(-2), days(5))                   # nothing already set is overwritten
    # a current book that has not started yet ends on its start date, and a next book whose window has passed starts on its end date
    club_two = world.club(owner, "Second club")
    world.as_(owner)
    future = world.client.post(f"/clubs/{club_two}/books", json={"book_id": world.book("Future").id, "status": "current", "starts_on": days(5)}).json()["id"]
    stale = world.client.post(f"/clubs/{club_two}/books", json={"book_id": world.book("Stale").id, "ends_on": days(-3)}).json()["id"]
    response = world.client.post(f"/clubs/{club_two}/books/{future}/advance", json={"next_club_book_id": stale})
    assert response.status_code == 200, response.text
    books = book_states(response)
    assert books[future]["ends_on"] == days(5) and books[stale]["starts_on"] == days(-3)


def test_advance_without_a_next_book_just_finishes_the_current_one(world):
    owner = world.person()
    club_id = world.club(owner)
    for body in ({}, {"next_club_book_id": None}, None):
        club_book = world.current_book(owner, club_id, world.book("Again"))
        kwargs = {} if body is None else {"json": body}
        response = world.client.post(f"/clubs/{club_id}/books/{club_book}/advance", **kwargs)
        assert response.status_code == 200, (body, response.text)
        assert book_states(response)[club_book]["status"] == "past" and not [b for b in response.json()["books"] if b["status"] == "current"]


def test_admins_may_advance_members_and_outsiders_may_not(world):
    owner, admin, member, outsider = world.person(), world.person(), world.person(), world.person()
    club_id = world.club(owner)
    world.add_member(club_id, admin, "admin")
    world.add_member(club_id, member)
    now_id = world.current_book(owner, club_id, world.book("Guarded"))
    next_id = upcoming(world, owner, club_id, world.book("After"))
    path = f"/clubs/{club_id}/books/{now_id}/advance"
    world.as_(member)
    refused = world.client.post(path, json={"next_club_book_id": next_id})
    assert refused.status_code == 403 and refused.json()["detail"]["code"] == "moderators_only"
    world.as_(outsider)
    assert world.client.post(path, json={"next_club_book_id": next_id}).status_code == 404                  # the club looks private
    world.as_(owner)
    assert book_states(world.client.get(f"/clubs/{club_id}"))[now_id]["status"] == "current"                # nothing changed so far
    world.as_(admin)
    assert world.client.post(path, json={"next_club_book_id": next_id}).status_code == 200


def test_advance_errors_leave_the_club_exactly_as_it_was(world):
    owner = world.person()
    club_id, other_club = world.club(owner), world.club(owner, "Other")
    now_id = world.current_book(owner, club_id, world.book("Stays"))
    next_id = upcoming(world, owner, club_id, world.book("Waits"))
    foreign = upcoming(world, owner, other_club, world.book("Elsewhere"))
    past_id = world.current_book(owner, other_club, world.book("Done"))
    world.as_(owner)
    assert world.client.post(f"/clubs/{other_club}/books/{past_id}/advance").status_code == 200            # now a past book in the other club
    before = [(b["id"], b["status"], b["starts_on"], b["ends_on"]) for b in world.client.get(f"/clubs/{club_id}").json()["books"]]

    def fails(path, body, status, code=None):
        response = world.client.post(path, json=body)
        assert response.status_code == status, (path, body, response.text)
        assert code is None or response.json()["detail"]["code"] == code
        assert [(b["id"], b["status"], b["starts_on"], b["ends_on"]) for b in world.client.get(f"/clubs/{club_id}").json()["books"]] == before

    fails(f"/clubs/{club_id}/books/{next_id}/advance", {}, 409, "not_current")                              # an upcoming book is not current
    fails(f"/clubs/{club_id}/books/{now_id}/advance", {"next_club_book_id": foreign}, 404)                  # another club's book
    fails(f"/clubs/{club_id}/books/{now_id}/advance", {"next_club_book_id": 99999999}, 404)
    fails(f"/clubs/{club_id}/books/{now_id}/advance", {"next_club_book_id": now_id}, 409, "next_not_upcoming")
    fails(f"/clubs/{club_id}/books/99999999/advance", {}, 404)
    fails(f"/clubs/{other_club}/books/{now_id}/advance", {}, 404)                                            # a book of another club
    fails(f"/clubs/{club_id}/books/{now_id}/advance", {"next_club_book_id": 0}, 422)
    fails(f"/clubs/{club_id}/books/{now_id}/advance", {"next_club_book_id": "x"}, 422)
    fails(f"/clubs/{club_id}/books/{now_id}/advance", {"unknown": 1}, 422)
    assert world.client.post(f"/clubs/{other_club}/books/{past_id}/advance").status_code == 409            # a finished book cannot be finished again


def test_advance_is_safe_to_repeat(world):
    owner = world.person()
    club_id = world.club(owner)
    now_id = world.current_book(owner, club_id, world.book("Once"))
    next_id, third = upcoming(world, owner, club_id, world.book("Twice")), upcoming(world, owner, club_id, world.book("Thrice"))
    path = f"/clubs/{club_id}/books/{now_id}/advance"
    world.as_(owner)
    first = world.client.post(path, json={"next_club_book_id": next_id})
    world.db.execute(text("UPDATE club_books SET ends_on = :d WHERE id = :i"), {"d": TODAY - timedelta(days=1), "i": now_id})      # the first call's date must not be redone
    world.db.commit()
    again = world.client.post(path, json={"next_club_book_id": next_id})                                     # a double click or a retry
    assert first.status_code == again.status_code == 200
    books = book_states(again)
    assert books[now_id]["ends_on"] == days(-1) and books[next_id]["status"] == "current" and books[third]["status"] == "upcoming"
    assert world.client.post(path, json={"next_club_book_id": third}).status_code == 409                    # a different advance of a past book is refused
    assert world.client.post(path).status_code == 409
    assert book_states(world.client.get(f"/clubs/{club_id}"))[next_id]["status"] == "current"


# B. richer /me/clubs items

def test_my_clubs_shows_the_current_book_the_next_checkpoint_and_my_progress(world):
    owner, ann = world.person(), world.person()
    club_id, empty_club = world.club(owner), world.club(owner, "Empty")
    world.add_member(club_id, ann)
    world.add_member(empty_club, ann)
    book = world.book("Planned", pages=300)
    club_book = world.current_book(owner, club_id, book)
    checkpoint(world, owner, club_id, club_book, 100, days(1), label="Part one")
    checkpoint(world, owner, club_id, club_book, 200, days(10), label="Part two")
    checkpoint(world, owner, club_id, club_book, 50, days(20), unit="percent")

    def mine():
        world.as_(ann)
        return {c["id"]: c for c in world.client.get("/me/clubs").json()["items"]}

    item = mine()[club_id]
    assert item["current_book"] == {"club_book_id": club_book, "book_id": book.id, "title": book.title, "page_count": 300,
                                    "cover": "https://covers.openlibrary.org/b/id/1-L.jpg"}
    assert item["next_checkpoint"] == {"unit": "pages", "value": 100, "due_on": days(1), "label": "Part one"} and item["my_progress"] is None
    world.read(ann, book, pages=120)
    item = mine()[club_id]
    assert item["next_checkpoint"] == {"unit": "pages", "value": 200, "due_on": days(10), "label": "Part two"}
    assert item["my_progress"] == {"unit": "pages", "value": 120}
    world.read(ann, book, pages=210)                                                                    # 210 of 300 is 70%: the 50% checkpoint is behind too
    item = mine()[club_id]
    assert item["next_checkpoint"] is None and item["my_progress"] == {"unit": "pages", "value": 210}
    world.read(ann, book, percent=40)
    item = mine()[club_id]
    assert item["my_progress"] == {"unit": "pages", "value": 120}                                        # a percent reading is shown as pages when the length is known
    assert item["next_checkpoint"]["value"] == 200
    assert item["role"] == "member" and item["member_count"] == 2
    assert mine()[empty_club]["current_book"] is None and mine()[empty_club]["next_checkpoint"] is None and mine()[empty_club]["my_progress"] is None
    world.read(owner, book, state="finished")
    world.as_(owner)
    assert {c["id"]: c for c in world.client.get("/me/clubs").json()["items"]}[club_id]["my_progress"] == {"unit": "percent", "value": 100}


def test_my_clubs_uses_the_same_number_of_statements_for_one_club_and_for_ten(world, app_modules):
    reader, poster = world.person("Reader"), world.person("Poster")

    def add_club(n):
        club_id = world.club(poster, f"Club {n:02d}")
        world.add_member(club_id, reader)
        book = world.book(f"Shared {n}")
        club_book = world.current_book(poster, club_id, book)
        checkpoint(world, poster, club_id, club_book, 100, days(2))
        world.read(reader, book, pages=30)
        post(world, poster, club_id, club_book, f"news {n}")                                              # unlocked and new for the reader
        return club_id

    add_club(0)
    one, response = counting(world, app_modules, reader, "/me/clubs")
    assert len(response.json()["items"]) == 1
    for n in range(1, 10):
        add_club(n)
    many, response = counting(world, app_modules, reader, "/me/clubs")
    items = response.json()["items"]
    assert len(items) == 10 and many == one
    assert all(i["new_posts"] == 1 and i["checkpoint_due_soon"] and i["next_checkpoint"]["value"] == 100 and i["my_progress"]["value"] == 30 for i in items)
    assert all(i["current_book"]["title"] for i in items)
    assert one <= 6                                                                                      # clubs, new posts, progress and checkpoints, plus the sign-in lookup


# C. what is new, worked out when the page is read

def seen_at(world, club_id, user):
    world.db.rollback()
    return world.db.scalar(text("SELECT last_seen_at FROM club_members WHERE club_id = :c AND user_id = :u"), {"c": club_id, "u": user.id})


def test_opening_a_club_records_when_you_last_looked_at_most_once_a_minute(world, app_modules):
    owner, ann, outsider = world.person(), world.person(), world.person()
    club_id = world.club(owner)
    world.add_member(club_id, ann)
    path = f"/clubs/{club_id}"
    assert seen_at(world, club_id, ann) is None
    world.as_(ann)
    world.client.get("/me/clubs")                                                                       # the list does not count as looking
    assert seen_at(world, club_id, ann) is None
    first_cost, response = counting(world, app_modules, ann, path)
    assert response.status_code == 200
    stamp = seen_at(world, club_id, ann)
    assert stamp is not None and abs((datetime.now(timezone.utc) - stamp).total_seconds()) < 30
    steady_cost, _ = counting(world, app_modules, ann, path)
    assert first_cost == steady_cost + 1 and seen_at(world, club_id, ann) == stamp                          # a repeat within the minute writes nothing
    world.db.execute(text("UPDATE club_members SET last_seen_at = :t WHERE club_id = :c AND user_id = :u"),
                     {"t": stamp - timedelta(minutes=2), "c": club_id, "u": ann.id})
    world.db.commit()
    again_cost, _ = counting(world, app_modules, ann, path)
    assert again_cost == first_cost and seen_at(world, club_id, ann) >= stamp - timedelta(seconds=1)
    assert seen_at(world, club_id, owner) is None                                                        # only the member who looked is stamped
    world.as_(outsider)
    assert world.client.get(path).status_code == 404 and seen_at(world, club_id, outsider) is None


def test_new_posts_counts_only_what_this_reader_can_read_and_did_not_write(world):
    owner, ann, ben, cat, club_id, book, club_book = scene(world)
    world.read(ben, book, pages=50)

    def add(who, body, unit=None, value=None, **flags):
        world.db.add(world.models.ClubPost(club_book_id=club_book, user_id=who.id, body=body, anchor_unit=unit, anchor_value=value, **flags))
        world.db.commit()

    add(ann, "open")
    add(ann, "p40", "pages", 40)
    add(ann, "p200 spoiler", "pages", 200)
    add(ben, "my own")
    add(cat, "reported away", hidden_at=NOW)
    add(cat, "", deleted_at=NOW)
    add(cat, "ninety percent", "percent", 90)

    def counts(who):
        world.as_(who)
        mine = {c["id"]: c for c in world.client.get("/me/clubs").json()["items"]}[club_id]
        return mine["new_posts"]

    assert counts(ben) == 2                                                                              # open and p40: not p200, not 90%, not his own, not hidden or deleted
    assert counts(owner) == 2                                                                            # moderators too: a locked post is never counted (open and Ben's)
    world.read(ben, book, pages=250)
    assert counts(ben) == 3                                                                              # p200 is now behind him; 90% of 300 is p270, still ahead
    world.read(ben, book, pages=280)
    assert counts(ben) == 4
    world.as_(ben)
    assert world.client.get(f"/clubs/{club_id}").json()["new_posts"] == 4                                    # the club page agrees with the list
    assert world.client.get(f"/clubs/{club_id}").json()["new_posts"] == 0                                    # and having looked, nothing is new
    assert counts(ben) == 0
    add(ann, "after he looked")
    assert counts(ben) == 1
    assert counts(cat) == 3                                                                              # Cat has not reached p40: open, Ben's and the late one
    world.read(cat, book, state="finished")
    assert counts(cat) == 5                                                                              # a finished reader can read everything but their own, hidden and deleted posts


def test_a_new_member_does_not_see_the_clubs_history_as_new(world):
    owner, ann = world.person(), world.person()
    club_id = world.club(owner)
    book = world.book("History")
    club_book = world.current_book(owner, club_id, book)
    for n in range(3):
        post(world, owner, club_id, club_book, f"old {n}")
    world.add_member(club_id, ann)
    world.as_(ann)
    assert {c["id"]: c for c in world.client.get("/me/clubs").json()["items"]}[club_id]["new_posts"] == 0
    post(world, owner, club_id, club_book, "fresh")
    world.as_(ann)
    assert {c["id"]: c for c in world.client.get("/me/clubs").json()["items"]}[club_id]["new_posts"] == 1


def test_checkpoint_due_soon_means_the_next_unreached_checkpoint_is_due_within_three_days_or_overdue(world):
    owner, ann = world.person(), world.person()
    club_id = world.club(owner)
    world.add_member(club_id, ann)
    book = world.book("Deadlines", pages=300)
    club_book = world.current_book(owner, club_id, book)
    near = checkpoint(world, owner, club_id, club_book, 100, days(2))
    checkpoint(world, owner, club_id, club_book, 200, days(10))

    def flags():
        world.as_(ann)
        listed = {c["id"]: c for c in world.client.get("/me/clubs").json()["items"]}[club_id]["checkpoint_due_soon"]
        shown = world.client.get(f"/clubs/{club_id}").json()["checkpoint_due_soon"]
        assert listed == shown
        return listed

    def due(value):
        world.db.execute(text("UPDATE club_checkpoints SET due_on = :d WHERE id = :i"), {"d": value, "i": near})
        world.db.commit()

    assert flags() is True                                                                               # due in 2 days
    due(TODAY + timedelta(days=3))
    assert flags() is True
    due(TODAY + timedelta(days=4))
    assert flags() is False
    due(TODAY - timedelta(days=2))
    assert flags() is True                                                                               # overdue and not reached
    due(None)
    assert flags() is False                                                                              # no date, nothing is due
    due(TODAY + timedelta(days=1))
    world.read(ann, book, pages=120)                                                                     # the early one is reached: the next is 10 days away
    assert flags() is False
    world.read(ann, book, pages=250)
    assert flags() is False                                                                              # all reached


def test_club_detail_statements_do_not_grow_with_clubs_or_new_posts(world, app_modules):
    owner, reader = world.person("Owner"), world.person("Reader")
    club_id = world.club(owner)
    world.add_member(club_id, reader)
    book = world.book("Busy", pages=300)
    club_book = world.current_book(owner, club_id, book)
    world.read(reader, book, pages=100)
    world.as_(reader)
    world.client.get(f"/clubs/{club_id}")                                                                # stamp it, so the measure is the steady state
    post(world, owner, club_id, club_book, "first")
    one, response = counting(world, app_modules, reader, f"/clubs/{club_id}")
    assert response.json()["new_posts"] == 1
    from rate_limit import limiter
    limiter.reset()                                                                                      # creating a club is limited to 10 a minute
    for n in range(9):                                                                                   # an owner may own 10 clubs; this is the other nine
        extra = world.club(owner, f"More {n}")
        world.add_member(extra, reader)
        post(world, owner, extra, world.current_book(owner, extra, world.book(f"Extra {n}")), "news")
    for n in range(15):
        world.db.add(world.models.ClubPost(club_book_id=club_book, user_id=owner.id, body=f"bulk {n}", anchor_unit="pages" if n % 2 else None,
                                           anchor_value=7 * n if n % 2 else None))
    world.db.commit()
    many, response = counting(world, app_modules, reader, f"/clubs/{club_id}")
    assert many == one and response.json()["new_posts"] == 1 + 15


# D. owner-set club size

def test_the_owner_sets_the_club_size_between_two_and_twenty_five(world):
    owner, admin, member = world.person(), world.person(), world.person()
    club_id = world.club(owner)
    world.add_member(club_id, admin, "admin")
    world.add_member(club_id, member)
    world.as_(owner)
    detail = world.client.get(f"/clubs/{club_id}").json()
    assert (detail["member_limit"], detail["effective_cap"], detail["member_count"]) == (25, 25, 3)
    for bad in (1, 26, 0, -5, None, "ten", 2.5):
        assert world.client.patch(f"/clubs/{club_id}", json={"member_limit": bad}).status_code == 422, bad
    for good in (2, 25, 12):
        response = world.client.patch(f"/clubs/{club_id}", json={"member_limit": good})
        assert response.status_code == 200 and response.json()["member_limit"] == good
    detail = world.client.get(f"/clubs/{club_id}").json()
    assert (detail["member_limit"], detail["effective_cap"]) == (12, 12) and detail["cap"] == {"free_limit": 25, "full": False}
    world.as_(admin)
    refused = world.client.patch(f"/clubs/{club_id}", json={"member_limit": 5, "name": "Hijacked"})
    assert refused.status_code == 403 and refused.json()["detail"]["code"] == "owner_only"
    assert world.client.patch(f"/clubs/{club_id}", json={"name": "Renamed by admin"}).status_code == 200      # admins keep editing the rest
    world.as_(member)
    assert world.client.patch(f"/clubs/{club_id}", json={"member_limit": 5}).status_code == 403
    world.as_(owner)
    detail = world.client.get(f"/clubs/{club_id}").json()
    assert detail["name"] == "Renamed by admin" and detail["member_limit"] == 12                              # the refused calls changed nothing


def test_joins_stop_at_the_owners_limit_and_the_invite_page_says_so(world):
    owner, ann, ben, cat = world.person(), world.person(), world.person(), world.person()
    club_id = world.club(owner)
    token = world.invite(owner, club_id)
    world.as_(owner)
    assert world.client.patch(f"/clubs/{club_id}", json={"member_limit": 3}).status_code == 200
    preview = world.client.get(f"/club-invites/{token}").json()
    assert (preview["member_limit"], preview["effective_cap"], preview["member_count"], preview["full"]) == (3, 3, 1, False)
    assert world.join(ann, token).status_code == 200
    assert world.join(ben, token).status_code == 200                                                       # the third member fits exactly
    preview = world.client.get(f"/club-invites/{token}").json()
    assert (preview["member_count"], preview["full"]) == (3, True)
    refused = world.join(cat, token)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "club_full"
    assert world.db.scalar(text("SELECT count(*) FROM club_members WHERE club_id = :c"), {"c": club_id}) == 3
    world.as_(owner)
    assert world.client.get(f"/clubs/{club_id}").json()["cap"]["full"] is True
    world.as_(owner)
    assert world.client.patch(f"/clubs/{club_id}", json={"member_limit": 4}).status_code == 200            # room again
    assert world.join(cat, token).status_code == 200


def test_lowering_the_limit_below_the_member_count_only_stops_new_joins(world):
    owner, latecomer = world.person(), world.person()
    club_id = world.club(owner)
    others = [world.person() for _ in range(4)]
    for other in others:
        world.add_member(club_id, other)
    token = world.invite(owner, club_id)
    world.as_(owner)
    assert world.client.patch(f"/clubs/{club_id}", json={"member_limit": 2}).status_code == 200
    assert len(world.client.get(f"/clubs/{club_id}/members").json()["items"]) == 5                          # nobody is removed
    detail = world.client.get(f"/clubs/{club_id}").json()
    assert (detail["member_limit"], detail["effective_cap"], detail["member_count"], detail["cap"]["full"]) == (2, 2, 5, True)
    assert world.join(latecomer, token).json()["detail"]["code"] == "club_full"
    world.as_(others[0])
    assert world.client.post(f"/clubs/{club_id}/leave").status_code == 204
    assert world.join(latecomer, token).status_code == 409                                                 # 4 is still over 2
    world.as_(owner)
    assert world.client.patch(f"/clubs/{club_id}", json={"member_limit": 25}).status_code == 200
    assert world.join(latecomer, token).status_code == 200


def test_club_plus_still_lifts_the_plan_cap_and_a_smaller_owner_limit_still_applies(world):
    owner, latecomer = world.person(), world.person()
    club_id = world.club(owner)
    world.db.add(world.models.Entitlement(user_id=owner.id, kind="club_plus", club_id=club_id, stripe_subscription_id="sub_limit", status="active"))
    world.db.commit()
    token = world.invite(owner, club_id)
    world.as_(owner)
    detail = world.client.get(f"/clubs/{club_id}").json()
    assert (detail["club_plus"], detail["member_limit"], detail["effective_cap"]) == (True, 25, None)       # 25 means "the plan's cap", and Plus has none
    assert world.client.get(f"/club-invites/{token}").json()["effective_cap"] is None
    assert world.client.patch(f"/clubs/{club_id}", json={"member_limit": 2}).status_code == 200
    world.add_member(club_id, world.person())
    assert world.client.get(f"/clubs/{club_id}").json()["effective_cap"] == 2
    assert world.join(latecomer, token).json()["detail"]["code"] == "club_full"
