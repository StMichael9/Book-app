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
                                                                  "owner_name": "A reader", "current_book": None}
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
