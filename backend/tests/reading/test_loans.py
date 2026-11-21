"""T75A: lending. Owner scoping, the open-loan rule, idempotency, overdue, the borrower's link (secrecy, revoke, said-back), loans riding
along with entries in constant statements, events and exports."""
import importlib.util
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import delete, event, select, text

from test_lifecycle import entry, owner  # noqa: F401

TODAY = datetime.now(timezone.utc).date()


def make(client, saved, **fields):
    body = {"request_id": str(uuid.uuid4()), "direction": "lent", "person_name": "Sam", "entry_id": saved["id"], **fields}
    return client.post("/me/loans", json=body)


@pytest.fixture()
def lending(client, owner, seeded_books, db_session, app_modules):  # noqa: F811
    from rate_limit import limiter
    limiter.reset()
    models = app_modules["models"]
    db_session.execute(delete(models.EventCount))
    db_session.commit()

    class L:
        pass

    l = L()
    l.client, l.owner, l.db, l.models, l.books = client, owner, db_session, models, seeded_books
    l.saved = entry(client, seeded_books)
    yield l
    limiter.reset()
    db_session.rollback()
    db_session.execute(delete(models.EventCount))
    db_session.commit()


def events(l):
    l.db.expire_all()
    return {name: count for name, count in l.db.execute(text("SELECT name, sum(count) FROM event_counts GROUP BY name"))}


def stranger(l):
    other = l.models.User(email=f"stranger-{uuid.uuid4().hex}@example.com", hashed_password="fixture")
    l.db.add(other)
    l.db.commit()
    return other


def sign_in_as(l, user):
    from auth.dependencies import get_current_user
    from main import app
    app.dependency_overrides[get_current_user] = lambda: user


# --- the log -----------------------------------------------------------------------------------------------------------

def test_lend_a_book_and_see_it_in_the_list(lending):
    response = make(lending.client, lending.saved, due_on=str(TODAY + timedelta(days=14)))
    assert response.status_code == 201, response.text
    loan = response.json()
    assert (loan["direction"], loan["person_name"], loan["started_on"], loan["overdue"], loan["said_back"], loan["has_link"]) == (
        "lent", "Sam", str(TODAY), False, False, False)
    assert loan["entry_id"] == lending.saved["id"] and loan["ended_on"] is None
    listed = lending.client.get("/me/loans").json()["items"]
    assert [item["id"] for item in listed] == [loan["id"]] and listed[0]["title"]
    assert lending.client.get("/me/loans?state=closed").json()["items"] == []
    assert lending.client.get("/me/loans?direction=borrowed").json()["items"] == []
    assert lending.client.get("/me/loans?state=nope").status_code == 422


def test_lending_needs_an_owned_book_but_borrowing_does_not(lending):
    wanted_only = lending.client.put(f"/me/library/books/{lending.saved['book_id']}", json={"expected_version": lending.saved["version"], "is_owned": False})
    assert wanted_only.status_code == 200
    assert make(lending.client, lending.saved).status_code == 422
    assert make(lending.client, lending.saved).json()["detail"]["code"] == "lend_requires_owned"
    assert make(lending.client, lending.saved, direction="borrowed", person_name="Ana").status_code == 201


def test_borrowing_a_book_not_on_the_shelf_puts_it_there_not_owned(lending):
    other = [b for b in lending.books.values() if b.id != lending.saved["book_id"]][0]
    response = lending.client.post("/me/loans", json={"request_id": str(uuid.uuid4()), "direction": "borrowed", "person_name": "Ana",
                                                      "book_id": other.id})
    assert response.status_code == 201, response.text
    entry_row = lending.db.execute(select(lending.models.UserBook).where(lending.models.UserBook.book_id == other.id,
                                   lending.models.UserBook.user_id == lending.owner.id)).scalar_one()
    assert (entry_row.is_owned, entry_row.is_wanted) == (False, False) and response.json()["entry_id"] == entry_row.id
    lent_by_book = lending.client.post("/me/loans", json={"request_id": str(uuid.uuid4()), "direction": "lent", "person_name": "Sam", "book_id": other.id})
    assert lent_by_book.status_code == 422                                          # book_id is for borrowing only
    both = lending.client.post("/me/loans", json={"request_id": str(uuid.uuid4()), "direction": "borrowed", "person_name": "Ana",
                                                  "book_id": other.id, "entry_id": 1})
    assert both.status_code == 422


def test_one_open_loan_per_entry_and_direction_and_closed_loans_stay_as_history(lending):
    first = make(lending.client, lending.saved).json()
    again = make(lending.client, lending.saved, person_name="Someone else")
    assert again.status_code == 409 and again.json()["detail"]["code"] == "loan_already_open"
    assert make(lending.client, lending.saved, direction="borrowed", person_name="Ana").status_code == 201      # the other direction is separate
    closed = lending.client.patch(f"/me/loans/{first['id']}", json={"ended": True})
    assert closed.status_code == 200 and closed.json()["ended_on"] == str(TODAY)
    second = make(lending.client, lending.saved, person_name="Jo")
    assert second.status_code == 201
    history = lending.client.get("/me/loans?state=closed").json()["items"]
    assert [item["id"] for item in history] == [first["id"]]
    count = lending.db.scalar(text("SELECT count(*) FROM loans WHERE user_book_id = :e AND direction = 'lent' AND ended_on IS NULL"), {"e": lending.saved["id"]})
    assert count == 1                                                              # the partial unique index holds it at one


def test_the_partial_unique_index_is_enforced_by_the_database(lending):
    make(lending.client, lending.saved)
    with pytest.raises(Exception):
        lending.db.execute(text("INSERT INTO loans (user_book_id, direction, person_name, request_id) VALUES (:e, 'lent', 'X', :r)"),
                           {"e": lending.saved["id"], "r": uuid.uuid4()})
        lending.db.flush()
    lending.db.rollback()


def test_the_same_request_is_idempotent_and_a_changed_request_conflicts(lending):
    body = {"request_id": str(uuid.uuid4()), "direction": "lent", "person_name": "Sam", "entry_id": lending.saved["id"]}
    first = lending.client.post("/me/loans", json=body)
    replay = lending.client.post("/me/loans", json=body)
    assert first.status_code == replay.status_code == 201 and first.json()["id"] == replay.json()["id"]
    assert lending.client.post("/me/loans", json={**body, "person_name": "Other"}).status_code == 409
    assert lending.db.scalar(text("SELECT count(*) FROM loans")) == 1
    lending.client.patch(f"/me/loans/{first.json()['id']}", json={"ended": True})
    assert lending.client.post("/me/loans", json=body).status_code == 201           # a retry after the loan closed still gets the same loan back
    assert lending.db.scalar(text("SELECT count(*) FROM loans")) == 1


def test_validation_of_names_and_dates(lending):
    for bad in ({"person_name": ""}, {"person_name": "   "}, {"person_name": "x" * 81}, {"due_on": str(TODAY - timedelta(days=1))},
                {"started_on": str(TODAY + timedelta(days=1))}, {"direction": "gave"}, {"extra": 1}):
        assert make(lending.client, lending.saved, **bad).status_code == 422, bad
    assert make(lending.client, lending.saved, person_name="x" * 80).status_code == 201
    assert make(lending.client, lending.saved, started_on=str(TODAY - timedelta(days=3)), due_on=str(TODAY - timedelta(days=3)),
                direction="borrowed").status_code == 201


def test_patch_rename_due_date_close_and_the_closed_loan_is_final(lending):
    loan = make(lending.client, lending.saved).json()
    renamed = lending.client.patch(f"/me/loans/{loan['id']}", json={"person_name": "  Samuel ", "due_on": str(TODAY + timedelta(days=3))})
    assert renamed.json()["person_name"] == "Samuel" and renamed.json()["due_on"] == str(TODAY + timedelta(days=3))
    assert lending.client.patch(f"/me/loans/{loan['id']}", json={"due_on": None}).json()["due_on"] is None
    assert lending.client.patch(f"/me/loans/{loan['id']}", json={"due_on": str(TODAY - timedelta(days=9))}).status_code == 422
    assert lending.client.patch(f"/me/loans/{loan['id']}", json={"ended": False}).status_code == 422
    assert lending.client.patch(f"/me/loans/{loan['id']}", json={"person_name": None}).status_code == 422
    assert lending.client.patch(f"/me/loans/{loan['id']}", json={"ended": True}).status_code == 200
    assert lending.client.patch(f"/me/loans/{loan['id']}", json={"person_name": "Late"}).status_code == 409
    assert lending.client.delete(f"/me/loans/{loan['id']}").status_code == 204        # deletion is for mistakes, and works on a closed loan too
    assert lending.client.delete(f"/me/loans/{loan['id']}").status_code == 404


def test_overdue_is_calculated_from_the_due_date_and_only_while_open(lending):
    past = str(TODAY - timedelta(days=2))
    started = str(TODAY - timedelta(days=10))
    loan = make(lending.client, lending.saved, started_on=started, due_on=past).json()
    assert loan["overdue"] is True
    lending.db.execute(text("UPDATE loans SET due_on = :d WHERE id = :i"), {"d": TODAY, "i": loan["id"]})
    lending.db.commit()
    assert lending.client.get("/me/loans").json()["items"][0]["overdue"] is False         # due today is not yet overdue
    lending.db.execute(text("UPDATE loans SET due_on = :d WHERE id = :i"), {"d": TODAY - timedelta(days=1), "i": loan["id"]})
    lending.db.commit()
    assert lending.client.get("/me/loans").json()["items"][0]["overdue"] is True
    lending.client.patch(f"/me/loans/{loan['id']}", json={"ended": True})
    assert lending.client.get("/me/loans?state=closed").json()["items"][0]["overdue"] is False


def test_the_list_puts_overdue_first_then_by_due_date(lending):
    other_books = [b for b in lending.books.values() if b.id != lending.saved["book_id"]][:2]
    ids = []
    for book in other_books:
        saved = lending.client.put(f"/me/library/books/{book.id}", json={"is_owned": True}).json()
        ids.append(saved)
    far = make(lending.client, lending.saved, due_on=str(TODAY + timedelta(days=30))).json()
    overdue = make(lending.client, ids[0], started_on=str(TODAY - timedelta(days=9)), due_on=str(TODAY - timedelta(days=1))).json()
    none = make(lending.client, ids[1]).json()
    order = [item["id"] for item in lending.client.get("/me/loans?state=open").json()["items"]]
    assert order == [overdue["id"], far["id"], none["id"]]


# --- owner scoping ---------------------------------------------------------------------------------------------------------

def test_another_reader_gets_404_for_every_loan_endpoint(lending):
    loan = make(lending.client, lending.saved).json()
    link = lending.client.post(f"/me/loans/{loan['id']}/share").json()["url"]
    other = stranger(lending)
    sign_in_as(lending, other)
    assert make(lending.client, lending.saved).status_code == 404                      # not their entry
    for call in (lambda: lending.client.patch(f"/me/loans/{loan['id']}", json={"ended": True}), lambda: lending.client.delete(f"/me/loans/{loan['id']}"),
                 lambda: lending.client.post(f"/me/loans/{loan['id']}/share"), lambda: lending.client.delete(f"/me/loans/{loan['id']}/share")):
        assert call().status_code == 404
    assert lending.client.get("/me/loans").json()["items"] == []
    assert link.rsplit("/", 1)[1]                                                      # the link itself still works for anyone with it
    assert lending.client.get(f"/loans/{link.rsplit('/', 1)[1]}").status_code == 200


# --- the borrower's link -----------------------------------------------------------------------------------------------------

def token_of(lending, loan):
    return lending.client.post(f"/me/loans/{loan['id']}/share").json()["url"].rsplit("/", 1)[1]


def test_share_creates_then_reuses_a_32_byte_token_and_only_for_lent_open_loans(lending):
    loan = make(lending.client, lending.saved).json()
    first = lending.client.post(f"/me/loans/{loan['id']}/share")
    assert first.status_code == 200 and first.json()["url"].startswith("https://") and "/l/" in first.json()["url"]
    token = first.json()["url"].rsplit("/", 1)[1]
    assert len(token) == 43 and set(token) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")      # 32 random bytes, base64url
    assert lending.client.post(f"/me/loans/{loan['id']}/share").json()["url"].endswith(token)                              # reused
    assert lending.client.get("/me/loans").json()["items"][0]["has_link"] is True
    borrowed = make(lending.client, lending.saved, direction="borrowed", person_name="Ana").json()
    assert lending.client.post(f"/me/loans/{borrowed['id']}/share").status_code == 422
    lending.client.patch(f"/me/loans/{loan['id']}", json={"ended": True})
    assert lending.client.post(f"/me/loans/{loan['id']}/share").status_code == 409
    assert lending.db.scalar(text("SELECT count(*) FROM loans WHERE direction = 'borrowed' AND share_token IS NOT NULL")) == 0


def test_the_public_page_shows_one_book_and_the_lenders_first_name_and_nothing_else(lending):
    handle = f"ada-{uuid.uuid4().hex[:8]}"
    lending.db.execute(text("UPDATE users SET display_name = 'Ada Lovelace', handle = :h, bio = 'my private bio' WHERE id = :i"),
                       {"h": handle, "i": lending.owner.id})
    lending.db.commit()
    loan = make(lending.client, lending.saved, person_name="Sam Secretname", due_on=str(TODAY + timedelta(days=7))).json()
    token = token_of(lending, loan)
    response = lending.client.get(f"/loans/{token}")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"state", "title", "authors", "cover_url", "lender_first_name", "started_on", "due_on", "said_back"}
    assert body["lender_first_name"] == "Ada" and body["state"] == "open" and body["due_on"] == str(TODAY + timedelta(days=7))
    assert body["title"] and body["said_back"] is False
    raw = response.text
    for secret in ("Secretname", "Sam", "Lovelace", handle, "private bio", lending.owner.email, str(lending.owner.id), loan["id"], token):
        assert secret not in raw, secret
    assert response.headers["cache-control"] == "private, no-store" and "noindex" in response.headers["x-robots-tag"]
    lending.db.execute(text("UPDATE users SET display_name = NULL WHERE id = :i"), {"i": lending.owner.id})
    lending.db.commit()
    assert lending.client.get(f"/loans/{token}").json()["lender_first_name"] is None          # no name set: the page says nothing, never the email


def test_the_page_needs_no_sign_in_and_unknown_or_malformed_tokens_are_404(lending):
    token = token_of(lending, make(lending.client, lending.saved).json())
    from auth.dependencies import get_current_user
    from main import app
    app.dependency_overrides.pop(get_current_user, None)
    assert lending.client.get(f"/loans/{token}").status_code == 200
    for bad in ("nope", "x" * 43, token[:-1] + ("A" if token[-1] != "A" else "B"), "a" * 200, "..%2f..", token + "x"):
        assert lending.client.get(f"/loans/{bad}").status_code == 404, bad
    assert lending.client.post("/loans/not-a-token/back").status_code == 404


def test_said_back_is_idempotent_shows_to_the_lender_and_the_lender_confirms(lending):
    loan = make(lending.client, lending.saved).json()
    token = token_of(lending, loan)
    first = lending.client.post(f"/loans/{token}/back")
    assert first.status_code == 200 and first.json()["said_back"] is True and first.json()["state"] == "open"
    stamped = lending.db.scalar(text("SELECT borrower_said_back_at FROM loans WHERE id = :i"), {"i": loan["id"]})
    again = lending.client.post(f"/loans/{token}/back")
    assert again.json()["said_back"] is True
    lending.db.expire_all()
    assert lending.db.scalar(text("SELECT borrower_said_back_at FROM loans WHERE id = :i"), {"i": loan["id"]}) == stamped      # not moved by a repeat
    assert lending.client.get("/me/loans").json()["items"][0]["said_back"] is True and lending.client.get("/me/loans").json()["items"][0]["ended_on"] is None
    assert lending.client.patch(f"/me/loans/{loan['id']}", json={"ended": True}).status_code == 200                     # the lender confirms
    closed = lending.client.get(f"/loans/{token}").json()
    assert closed["state"] == "closed"


def test_revoking_closes_the_page_for_30_days_then_it_is_a_404_and_a_new_link_is_new(lending):
    loan = make(lending.client, lending.saved).json()
    token = token_of(lending, loan)
    lending.client.post(f"/loans/{token}/back")
    assert lending.client.delete(f"/me/loans/{loan['id']}/share").status_code == 204
    assert lending.client.delete(f"/me/loans/{loan['id']}/share").status_code == 204          # revoking twice is fine
    page = lending.client.get(f"/loans/{token}")
    assert page.status_code == 200 and page.json()["state"] == "closed"
    assert lending.client.post(f"/loans/{token}/back").json()["state"] == "closed"
    lending.db.execute(text("UPDATE loans SET borrower_said_back_at = NULL WHERE id = :i"), {"i": loan["id"]})
    lending.db.commit()
    lending.client.post(f"/loans/{token}/back")
    assert lending.db.scalar(text("SELECT borrower_said_back_at FROM loans WHERE id = :i"), {"i": loan["id"]}) is None      # a revoked link changes nothing
    lending.db.execute(text("UPDATE loans SET share_revoked_at = now() - interval '31 days' WHERE id = :i"), {"i": loan["id"]})
    lending.db.commit()
    assert lending.client.get(f"/loans/{token}").status_code == 404
    fresh = token_of(lending, loan)
    assert fresh != token and lending.client.get(f"/loans/{fresh}").json()["state"] == "open" and lending.client.get(f"/loans/{token}").status_code == 404


def test_a_returned_loans_page_says_closed_then_goes_after_30_days(lending):
    loan = make(lending.client, lending.saved).json()
    token = token_of(lending, loan)
    lending.client.patch(f"/me/loans/{loan['id']}", json={"ended": True})
    assert lending.client.get(f"/loans/{token}").json()["state"] == "closed"
    lending.db.execute(text("UPDATE loans SET started_on = :s, ended_on = :e WHERE id = :i"),
                       {"s": TODAY - timedelta(days=60), "e": TODAY - timedelta(days=31), "i": loan["id"]})
    lending.db.commit()
    assert lending.client.get(f"/loans/{token}").status_code == 404


def test_the_public_endpoints_are_rate_limited(lending):
    token = token_of(lending, make(lending.client, lending.saved).json())
    codes = [lending.client.get(f"/loans/{token}").status_code for _ in range(35)]
    assert 429 in codes and codes[0] == 200
    from rate_limit import limiter
    limiter.reset()
    backs = [lending.client.post(f"/loans/{token}/back").status_code for _ in range(12)]
    assert 429 in backs


def test_a_private_entry_can_be_lent_and_its_page_uses_its_own_title(lending):
    private = lending.client.post("/me/library/private", json={"request_id": str(uuid.uuid4()), "title": "My Own Book", "author": "Me", "is_owned": True})
    assert private.status_code == 200, private.text
    loan = make(lending.client, private.json()).json()
    body = lending.client.get(f"/loans/{token_of(lending, loan)}").json()
    assert body["title"] == "My Own Book" and body["authors"] == ["Me"]


# --- loans ride along with entries -------------------------------------------------------------------------------------------------

def test_entries_carry_the_open_loan_in_the_entry_payloads(lending):
    lent = make(lending.client, lending.saved, due_on=str(TODAY + timedelta(days=5))).json()
    make(lending.client, lending.saved, direction="borrowed", person_name="Ana")
    detail = lending.client.get(f"/me/library/{lending.saved['id']}").json()
    assert detail["loan"]["id"] == lent["id"] and detail["loan"]["direction"] == "lent"                 # lent comes first
    assert [item["direction"] for item in detail["loans"]] == ["lent", "borrowed"]
    page = lending.client.get("/me/library").json()["items"][0]
    assert page["loan"]["person_name"] == "Sam" and len(page["loans"]) == 2
    workspace = lending.client.get(f"/me/library/{lending.saved['id']}/reading").json()["entry"]
    assert workspace["loan"]["id"] == lent["id"]
    lending.client.patch(f"/me/loans/{lent['id']}", json={"ended": True})
    assert [item["direction"] for item in lending.client.get(f"/me/library/{lending.saved['id']}").json()["loans"]] == ["borrowed"]


def test_loans_add_no_statement_to_the_library_list_or_the_workspace(lending, app_modules):
    engine = app_modules["database"].engine
    other_books = [b for b in lending.books.values() if b.id != lending.saved["book_id"]][:3]
    for book in other_books:
        lending.client.put(f"/me/library/books/{book.id}", json={"is_owned": True})

    def count(path):
        seen = []
        listener = lambda conn, cursor, statement, *a: seen.append(statement)
        lending.db.commit()
        lending.db.expire_all()
        event.listen(engine, "before_cursor_execute", listener)
        try:
            assert lending.client.get(path).status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len(seen)

    paths = ("/me/library", f"/me/library/{lending.saved['id']}", f"/me/library/{lending.saved['id']}/reading")
    before = [count(path) for path in paths]
    for saved in lending.client.get("/me/library").json()["items"]:
        if saved["is_owned"]:
            make(lending.client, saved)
            make(lending.client, saved, direction="borrowed", person_name="Ana")
    assert [count(path) for path in paths] == before


# --- events, exports ------------------------------------------------------------------------------------------------------------

def test_events_are_daily_totals_with_no_loan_detail_and_loan_is_a_ref(lending):
    from services import event_counts
    loan = make(lending.client, lending.saved, person_name="Sam Secret").json()
    token = token_of(lending, loan)
    lending.client.post(f"/me/loans/{loan['id']}/share")                                 # reused: not a second "link created"
    lending.client.get(f"/loans/{token}")
    lending.client.get(f"/loans/{token}")
    lending.client.post(f"/loans/{token}/back")
    lending.client.post(f"/loans/{token}/back")                                          # a repeat is not counted twice
    assert events(lending) == {"loan_created": 1, "loan_link_created": 1, "loan_link_opened": 2, "loan_back": 1}
    rows = lending.db.execute(text("SELECT name, src, placement, ref FROM event_counts")).all()
    assert all((src, placement, ref) == ("", "", "") for name, src, placement, ref in rows)
    assert "loan" in event_counts.REFS and event_counts.clean_ref("loan") == "loan"
    assert lending.client.post("/events", json={"name": "loan_created"}).status_code == 204                 # not a client event
    assert events(lending)["loan_created"] == 1


def test_the_json_export_includes_the_readers_own_loans_but_never_a_link(lending):
    loan = make(lending.client, lending.saved, person_name="Sam Export").json()
    token = token_of(lending, loan)
    make(lending.client, lending.saved, direction="borrowed", person_name="Ana")
    text_ = lending.client.get("/me/reading-export").text
    lines = [json.loads(line) for line in text_.splitlines() if line]
    loans = [line["data"] for line in lines if line["type"] == "loan"]
    assert sorted((item["direction"], item["person_name"]) for item in loans) == [("borrowed", "Ana"), ("lent", "Sam Export")]
    lent = next(item for item in loans if item["direction"] == "lent")
    assert lent["link_active"] is True and lent["user_book_id"] == lending.saved["id"]
    assert token not in text_ and "share_token" not in text_
    assert next(line for line in lines if line["type"] == "complete")["counts"]["loan"] == 2
    other = stranger(lending)
    sign_in_as(lending, other)
    assert "Sam Export" not in lending.client.get("/me/reading-export").text


def test_robots_keep_crawlers_off_the_loan_pages_and_the_sitemaps_never_list_them():
    root = Path(__file__).resolve().parents[3]
    robots = (root / "frontend" / "public" / "robots.txt").read_text(encoding="utf-8")
    assert robots.count("Disallow: /l/") == 2                                          # the general rule and the AI-crawler block
    sitemap = (root / "frontend" / "public" / "sitemap.xml").read_text(encoding="utf-8")
    assert "/l/" not in sitemap


def test_the_migration_has_the_partial_unique_index_and_the_cascade(lending):
    index = lending.db.scalar(text("SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_loan_open'"))
    assert "UNIQUE" in index and "ended_on IS NULL" in index
    loan = make(lending.client, lending.saved).json()
    lending.db.execute(text("DELETE FROM user_books WHERE id = :e"), {"e": lending.saved["id"]})
    lending.db.commit()
    assert lending.db.scalar(text("SELECT count(*) FROM loans WHERE id = :i"), {"i": loan["id"]}) == 0      # a removed entry takes its loans with it


def test_the_open_loan_has_an_id_and_has_link_but_never_the_token(lending):
    loan = make(lending.client, lending.saved).json()
    assert lending.client.get(f"/me/library/{lending.saved['id']}").json()["loan"]["has_link"] is False
    token = token_of(lending, loan)
    detail = lending.client.get(f"/me/library/{lending.saved['id']}")
    assert detail.json()["loan"]["id"] == loan["id"] and detail.json()["loan"]["has_link"] is True and token not in detail.text
    for path in ("/me/library", f"/me/library/{lending.saved['id']}/reading", "/me/loans"):
        assert token not in lending.client.get(path).text
    lending.client.delete(f"/me/loans/{loan['id']}/share")
    assert lending.client.get(f"/me/library/{lending.saved['id']}").json()["loan"]["has_link"] is False       # revoked: no live link


def test_loans_can_be_filtered_to_one_entry_and_limited_most_recent_first(lending):
    ids = []
    for n in range(7):
        loan = make(lending.client, lending.saved, person_name=f"P{n}").json()
        lending.client.patch(f"/me/loans/{loan['id']}", json={"ended": True})
        lending.db.execute(text("UPDATE loans SET started_on = :s, ended_on = :e WHERE id = :i"),
                           {"s": TODAY - timedelta(days=30), "e": TODAY - timedelta(days=20 - n), "i": loan["id"]})
        ids.append(loan["id"])
    lending.db.commit()
    other = [b for b in lending.books.values() if b.id != lending.saved["book_id"]][0]
    elsewhere = lending.client.put(f"/me/library/books/{other.id}", json={"is_owned": True}).json()
    make(lending.client, elsewhere)
    recent = lending.client.get(f"/me/loans?state=closed&entry_id={lending.saved['id']}&limit=5").json()["items"]
    assert [item["id"] for item in recent] == list(reversed(ids))[:5]
    assert len(lending.client.get("/me/loans?state=closed").json()["items"]) == 7
    assert len(lending.client.get(f"/me/loans?entry_id={elsewhere['id']}").json()["items"]) == 1
    assert lending.client.get("/me/loans?limit=0").status_code == 422 and lending.client.get("/me/loans?limit=201").status_code == 422
    sign_in_as(lending, stranger(lending))
    assert lending.client.get(f"/me/loans?entry_id={lending.saved['id']}").json()["items"] == []            # another reader's entry shows nothing
