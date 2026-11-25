"""DELETE /me: removes everything the reader owns in one transaction, hands clubs on, cancels billing, clears the cookies."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import MetaData, text

NOW = datetime.now(timezone.utc)
GOOD = {"confirm": "delete"}


@pytest.fixture()
def world(client, db_session, app_modules):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    models = app_modules["models"]
    limiter.reset()

    class W:
        pass

    w = W()
    w.client, w.db, w.models = client, db_session, models

    def person(name="Pat"):
        item = models.User(email=f"del-{uuid.uuid4().hex[:8]}@delete-fixture.org", hashed_password="x", display_name=name)
        db_session.add(item)
        db_session.commit()
        return item

    def as_(item):
        app_modules["main"].app.dependency_overrides[get_current_user] = lambda: item

    def book():
        item = models.Book(title=f"Del {uuid.uuid4().hex[:6]}", description="d", published_year=2000, page_count=200,
                           cover_image_url="https://covers.openlibrary.org/b/id/1-L.jpg", source_id=f"/works/OLD{uuid.uuid4().hex[:6]}W")
        item.authors = [models.Author(name="Del Author")]
        db_session.add(item)
        db_session.commit()
        return item

    def club(owner, name="Del Club"):
        as_(owner)
        response = client.post("/me/clubs", json={"name": name})
        assert response.status_code == 201, response.text
        return response.json()["id"]

    def member(club_id, user, role="member", days_ago=0):
        db_session.add(models.ClubMember(club_id=club_id, user_id=user.id, role=role, joined_at=NOW - timedelta(days=days_ago)))
        db_session.commit()

    def role_of(club_id, user):
        db_session.expire_all()
        return db_session.scalar(text("SELECT role FROM club_members WHERE club_id=:c AND user_id=:u"), {"c": club_id, "u": user.id})

    w.person, w.as_, w.book, w.club, w.member, w.role_of = person, as_, book, club, member, role_of
    yield w
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    limiter.reset()
    db_session.rollback()
    db_session.execute(text("DELETE FROM clubs WHERE name LIKE 'Del Club%'"))      # club books reference the catalogue, which the next test resets
    db_session.execute(text("DELETE FROM users WHERE email LIKE '%@delete-fixture.org'"))
    db_session.commit()


def delete_me(w, user, body=GOOD):
    w.as_(user)
    return w.client.request("DELETE", "/me", json=body)


def populate(w, user):
    """A reader with a row in nearly every table that points at users."""
    m = w.models
    book = w.book()
    entry = m.UserBook(user_id=user.id, book_id=book.id, is_owned=True)
    w.db.add(entry)
    w.db.commit()
    w.db.add(m.ReadingAttempt(id=uuid.uuid4(), user_book_id=entry.id, state="reading", creation_fingerprint=uuid.uuid4().hex * 2,
                              total_pages=200, started_on=NOW.date()))
    w.db.add(m.ReadingList(user_id=user.id, name="Faves"))
    tag = m.Tag(name=f"t{uuid.uuid4().hex[:6]}", type=m.TagType.genre)
    w.db.add(tag)
    w.db.commit()
    w.db.add(m.UserPreference(user_id=user.id, tag_id=tag.id))
    w.db.add(m.RefreshToken(user_id=user.id, token_hash=uuid.uuid4().hex, expires_at=NOW + timedelta(days=1)))
    w.db.add(m.PasswordResetToken(user_id=user.id, token_hash=uuid.uuid4().hex, expires_at=NOW + timedelta(days=1)))
    w.db.add(m.BillingCustomer(user_id=user.id, stripe_customer_id=f"cus_{uuid.uuid4().hex[:8]}"))
    w.db.add(m.Entitlement(user_id=user.id, kind="patron", stripe_subscription_id=f"sub_{uuid.uuid4().hex[:8]}", status="active"))
    w.db.add(m.Loan(user_book_id=entry.id, direction="lent", person_name="Sam", request_id=uuid.uuid4(), share_token=uuid.uuid4().hex))
    w.db.commit()
    return entry


def tables_pointing_at_users(w):
    """Every table and column that holds a user id, found from the live metadata, so a table added later cannot be missed."""
    meta = MetaData()
    meta.reflect(bind=w.db.get_bind())
    found = set()
    for table in meta.tables.values():
        for column in table.columns:
            if any(fk.column.table.name == "users" for fk in column.foreign_keys) or column.name in ("user_id", "owner_id", "reporter_id", "created_by"):
                found.add((table.name, column.name))
    found.discard(("users", "id"))
    return sorted(found)


def count(w, sql, **params):
    w.db.expire_all()
    return w.db.scalar(text(sql), params)


def test_deleting_empties_every_table_that_holds_the_reader(world):
    me, other = world.person(), world.person("Other")
    populate(world, me)
    populate(world, other)
    club_id = world.club(me)
    world.member(club_id, other, days_ago=3)
    assert delete_me(world, me).status_code == 204
    targets = tables_pointing_at_users(world)
    assert len(targets) >= 15, targets
    for table, column in targets:
        assert count(world, f'SELECT count(*) FROM "{table}" WHERE "{column}" = :u', u=me.id) == 0, f"{table}.{column} still holds the deleted reader"
    assert count(world, "SELECT count(*) FROM users WHERE id = :u", u=me.id) == 0
    assert count(world, "SELECT count(*) FROM user_books WHERE user_id = :u", u=other.id) == 1
    assert count(world, "SELECT count(*) FROM loans l JOIN user_books b ON b.id = l.user_book_id WHERE b.user_id = :u", u=other.id) == 1


def test_the_loan_link_of_a_deleted_reader_returns_not_found(world):
    me = world.person()
    entry = populate(world, me)
    token = count(world, "SELECT share_token FROM loans WHERE user_book_id = :e", e=entry.id)
    assert world.client.get(f"/loans/{token}").status_code == 200
    assert delete_me(world, me).status_code == 204
    assert world.client.get(f"/loans/{token}").status_code == 404


def test_the_204_clears_both_auth_cookies(world):
    response = delete_me(world, world.person())
    assert response.status_code == 204
    cookies = response.headers.get_list("set-cookie")
    for name in ("access_token", "refresh_token"):
        assert any(value.startswith(name) and "Max-Age=0" in value for value in cookies), cookies


def test_the_body_must_be_exactly_confirm_delete(world):
    me = world.person()
    for body in ({}, {"confirm": "yes"}, {"confirm": "DELETE"}, {"confirm": "delete", "extra": 1}, {"confirm": True}):
        assert delete_me(world, me, body).status_code == 422, body
    assert world.client.delete("/me").status_code == 422
    assert count(world, "SELECT count(*) FROM users WHERE id = :u", u=me.id) == 1


def test_signed_out_is_unauthorized(world, app_modules):
    from auth.dependencies import get_current_user
    app_modules["main"].app.dependency_overrides.pop(get_current_user, None)
    assert world.client.request("DELETE", "/me", json=GOOD).status_code == 401


def test_a_club_goes_to_the_longest_serving_admin(world):
    me, newer_admin, older_admin, old_member = (world.person() for _ in range(4))
    club_id = world.club(me)
    world.member(club_id, old_member, days_ago=30)
    world.member(club_id, older_admin, role="admin", days_ago=10)
    world.member(club_id, newer_admin, role="admin", days_ago=2)
    assert delete_me(world, me).status_code == 204
    assert world.role_of(club_id, older_admin) == "owner"
    assert world.role_of(club_id, newer_admin) == "admin"
    assert world.role_of(club_id, old_member) == "member"
    assert count(world, "SELECT owner_id FROM clubs WHERE id = :c", c=club_id) == older_admin.id
    assert count(world, "SELECT count(*) FROM club_members WHERE club_id = :c AND role = 'owner'", c=club_id) == 1


def test_with_no_admin_the_club_goes_to_the_longest_serving_member(world):
    me, newer, older = (world.person() for _ in range(3))
    club_id = world.club(me)
    world.member(club_id, newer, days_ago=1)
    world.member(club_id, older, days_ago=20)
    assert delete_me(world, me).status_code == 204
    assert world.role_of(club_id, older) == "owner"
    assert world.role_of(club_id, newer) == "member"


def test_a_club_with_only_the_reader_is_deleted_with_everything_in_it(world):
    me = world.person()
    club_id = world.club(me)
    world.as_(me)
    added = world.client.post(f"/clubs/{club_id}/books", json={"book_id": world.book().id, "status": "current"})
    assert added.status_code in (200, 201), added.text
    assert world.client.post(f"/clubs/{club_id}/invites", json={}).status_code == 201
    assert delete_me(world, me).status_code == 204
    for table, column in (("clubs", "id"), ("club_members", "club_id"), ("club_books", "club_id"), ("club_invites", "club_id")):
        assert count(world, f"SELECT count(*) FROM {table} WHERE {column} = :c", c=club_id) == 0, table


def test_their_posts_and_reports_are_deleted_and_report_counts_drop(world):
    me, a, b = (world.person() for _ in range(3))
    club_id = world.club(a)
    for who in (me, b):
        world.member(club_id, who)
    world.as_(a)
    cb = world.client.post(f"/clubs/{club_id}/books", json={"book_id": world.book().id, "status": "current"}).json()["id"]
    theirs = world.client.post(f"/clubs/{club_id}/books/{cb}/posts", json={"body": "a post"}).json()["id"]
    world.as_(me)
    mine = world.client.post(f"/clubs/{club_id}/books/{cb}/posts", json={"body": "my post"}).json()["id"]
    for reporter in (me, b):
        world.as_(reporter)
        assert world.client.post(f"/clubs/{club_id}/posts/{theirs}/report", json={}).status_code in (200, 201)
    assert count(world, "SELECT count(*) FROM club_reports WHERE post_id = :p", p=theirs) == 2
    assert delete_me(world, me).status_code == 204
    assert count(world, "SELECT count(*) FROM club_posts WHERE id = :p", p=mine) == 0
    assert count(world, "SELECT count(*) FROM club_reports WHERE post_id = :p", p=theirs) == 1
    assert count(world, "SELECT count(*) FROM club_posts WHERE id = :p", p=theirs) == 1


def test_a_subscription_is_cancelled_with_the_provider_first(world, monkeypatch):
    from services import billing
    me = world.person()
    populate(world, me)
    calls = []
    monkeypatch.setattr(billing, "configured", lambda: True)
    monkeypatch.setattr(billing.gateway, "cancel_subscription", lambda sub_id: calls.append(sub_id))
    sub = count(world, "SELECT stripe_subscription_id FROM entitlements WHERE user_id = :u", u=me.id)
    assert delete_me(world, me).status_code == 204
    assert calls == [sub]


def test_without_stripe_keys_nothing_calls_the_provider(world, monkeypatch):
    from services import billing
    me = world.person()
    populate(world, me)
    monkeypatch.setattr(billing, "configured", lambda: False)
    monkeypatch.setattr(billing.gateway, "cancel_subscription", lambda sub_id: pytest.fail("provider called"))
    assert delete_me(world, me).status_code == 204


def test_any_failure_rolls_everything_back(world, monkeypatch):
    from services import billing
    me = world.person()
    populate(world, me)
    monkeypatch.setattr(billing, "configured", lambda: True)

    def boom(_):
        raise RuntimeError("provider down")

    monkeypatch.setattr(billing.gateway, "cancel_subscription", boom)
    world.as_(me)
    with pytest.raises(RuntimeError):
        world.client.request("DELETE", "/me", json=GOOD)
    assert count(world, "SELECT count(*) FROM users WHERE id = :u", u=me.id) == 1
    assert count(world, "SELECT count(*) FROM user_books WHERE user_id = :u", u=me.id) == 1
    assert count(world, "SELECT status FROM entitlements WHERE user_id = :u", u=me.id) == "active"


def test_the_endpoint_is_rate_limited(world, monkeypatch):
    from services import account
    monkeypatch.setattr(account, "delete_account", lambda db, user: None)      # the limiter counts requests that pass validation
    world.as_(world.person())
    codes = [world.client.request("DELETE", "/me", json=GOOD).status_code for _ in range(7)]
    assert codes[:5] == [204] * 5 and 429 in codes[5:], codes
