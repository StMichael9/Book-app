"""Short invite codes (join by code or QR), owner hand-over, and the owner leaving with a successor."""
import importlib.util
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import text

from test_club_meetings import team  # noqa: F401  (a club with an owner, an admin, two members and an outsider)
from test_clubs import counting, world  # noqa: F401

CODE = re.compile(r"^[A-HJ-KM-NP-Z2-9]{6}$")                    # no 0, O, 1, I or L


def invite(w, who, club_id=None, **body):
    w.as_(who)
    response = w.client.post(f"/clubs/{club_id or w.cid}/invites", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def token_of(created):
    return created["url"].split("/c/")[1].split("?")[0]


def lookup(w, code):
    return w.client.get(f"/club-invites/code/{code}")


# --- codes -----------------------------------------------------------------------------------------------------------------

def test_every_new_invite_has_a_code_and_the_list_shows_it(team):
    first, second = invite(team, team.owner), invite(team, team.admin)
    assert CODE.match(first["code"]) and CODE.match(second["code"]) and first["code"] != second["code"]
    team.as_(team.owner)
    listed = {i["id"]: i["code"] for i in team.client.get(f"/clubs/{team.cid}/invites").json()["items"]}
    assert listed == {first["id"]: first["code"], second["id"]: second["code"]}


def test_a_code_opens_the_same_preview_plus_the_token(team):
    created = invite(team, team.owner)
    by_token = team.client.get(f"/club-invites/{token_of(created)}").json()
    by_code = lookup(team, created["code"])
    assert by_code.status_code == 200 and by_code.headers["cache-control"] == "private, no-store"
    assert by_code.json() == {**by_token, "token": token_of(created)}
    team.as_(team.outsider)
    joined = team.client.post("/me/clubs/join", json={"token": by_code.json()["token"]})            # joining still goes through the token
    assert joined.status_code == 200 and joined.json()["joined"] is True


def test_the_code_is_case_insensitive_and_ignores_dashes_and_spaces(team):
    code = invite(team, team.owner)["code"]
    for typed in (code.lower(), f"{code[:3]}-{code[3:]}", f"{code[:3]} {code[3:]}".lower(), f" {code} ", f"{code[:2]}-{code[2:4]}-{code[4:]}"):
        assert lookup(team, typed.replace(" ", "%20")).status_code == 200, typed


def test_an_unknown_expired_used_up_or_revoked_code_is_the_same_plain_404(team):
    live = invite(team, team.owner)
    spent = invite(team, team.owner, max_uses=1)
    old = invite(team, team.owner)
    gone = invite(team, team.owner)
    team.as_(team.outsider)
    assert team.client.post("/me/clubs/join", json={"token": token_of(spent)}).status_code == 200
    team.db.execute(text("UPDATE club_invites SET expires_at = now() - interval '1 day' WHERE id = :i"), {"i": old["id"]})
    team.db.commit()
    team.as_(team.owner)
    assert team.client.delete(f"/clubs/{team.cid}/invites/{gone['id']}").status_code == 204
    answers = {name: lookup(team, code) for name, code in (("unknown", "ZZZZZZ"), ("used_up", spent["code"]), ("expired", old["code"]), ("revoked", gone["code"]),
                                                          ("short", "ABC"), ("long", "ABCDEFGHJK"), ("bad_chars", "AB!D3F"), ("zero", "ABCD10"))}
    assert {name: r.status_code for name, r in answers.items()} == {name: 404 for name in answers}
    assert len({r.text for r in answers.values()}) == 1                                                # nothing tells them apart
    assert lookup(team, live["code"]).status_code == 200


def test_a_revoked_code_can_be_reused_but_two_live_invites_never_share_one(team, monkeypatch):
    from services import clubs
    seq = iter(["AAAAAA", "AAAAAA", "BBBBBB", "AAAAAA", "CCCCCC"])
    monkeypatch.setattr(clubs, "_new_code", lambda: next(seq))
    first = invite(team, team.owner)
    assert first["code"] == "AAAAAA"
    second = invite(team, team.owner)                                    # a collision with a live invite: it retries
    assert second["code"] == "BBBBBB"
    team.as_(team.owner)
    team.client.delete(f"/clubs/{team.cid}/invites/{first['id']}")
    third = invite(team, team.owner)                                     # revoked: the code is free again
    assert third["code"] == "AAAAAA"
    assert lookup(team, "AAAAAA").json()["token"] == token_of(third)


def test_the_code_lookup_is_rate_limited_and_only_moderators_make_codes(team):
    from rate_limit import limiter
    limiter.reset()
    codes = [lookup(team, "ZZZZZZ").status_code for _ in range(12)]
    assert codes[:10] == [404] * 10 and 429 in codes[10:]
    limiter.reset()
    team.as_(team.m1)
    assert team.client.post(f"/clubs/{team.cid}/invites", json={}).status_code == 403
    assert team.client.get(f"/clubs/{team.cid}/invites").status_code == 403


def test_the_migration_backfills_unique_codes_for_live_invites_only(team):
    spec = importlib.util.spec_from_file_location("backfill", Path(__file__).parent.parent / "alembic" / "versions" / "b7c3f5a91d24_club_invite_codes.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    ids = []
    for state in ("live", "live", "live", "revoked", "expired"):
        row = team.models.ClubInvite(token=uuid.uuid4().hex + uuid.uuid4().hex[:8], club_id=team.cid, created_by=team.owner.id,
                                     expires_at=datetime.now(timezone.utc) + (timedelta(days=-1) if state == "expired" else timedelta(days=5)),
                                     revoked_at=datetime.now(timezone.utc) if state == "revoked" else None)
        team.db.add(row)
        team.db.flush()
        ids.append((row.id, state))
    team.db.execute(text("UPDATE club_invites SET code = NULL WHERE club_id = :c"), {"c": team.cid})
    team.db.execute(text(module.BACKFILL))
    team.db.commit()
    team.db.expire_all()
    got = {state: team.db.scalar(text("SELECT code FROM club_invites WHERE id = :i"), {"i": i}) for i, state in ids if state != "live"}
    live = [team.db.scalar(text("SELECT code FROM club_invites WHERE id = :i"), {"i": i}) for i, state in ids if state == "live"]
    assert got == {"revoked": None, "expired": None}
    assert len(set(live)) == 3 and all(CODE.match(c) for c in live)


# --- hand-over --------------------------------------------------------------------------------------------------------------

def roles(w):
    w.db.expire_all()
    return {n: r for n, r in w.db.execute(text("SELECT u.display_name, m.role FROM club_members m JOIN users u ON u.id = m.user_id WHERE m.club_id = :c"), {"c": w.cid})}


def owner_id(w):
    w.db.expire_all()
    return w.db.scalar(text("SELECT owner_id FROM clubs WHERE id = :c"), {"c": w.cid})


def transfer(w, who, target):
    w.as_(who)
    return w.client.post(f"/clubs/{w.cid}/transfer", json={"user_id": str(getattr(target, "id", target))})


def test_only_the_owner_hands_over_and_the_old_owner_becomes_an_admin(team):
    assert transfer(team, team.admin, team.m1).json()["detail"]["code"] == "owner_only"
    assert transfer(team, team.m1, team.m1).status_code == 403
    assert transfer(team, team.outsider, team.m1).status_code == 404
    done = transfer(team, team.owner, team.m1)
    assert done.status_code == 200, done.text
    assert {m["name"]: m["role"] for m in done.json()["items"]} == {"Olga": "admin", "Adam": "admin", "Mia": "owner", "Max": "member"}
    assert roles(team) == {"Olga": "admin", "Adam": "admin", "Mia": "owner", "Max": "member"}
    assert owner_id(team) == team.m1.id
    assert transfer(team, team.owner, team.m2).status_code == 403                    # the old owner is no longer the owner
    assert transfer(team, team.m1, team.admin).status_code == 200                   # ... and an admin successor works the same way
    assert roles(team)["Adam"] == "owner" and roles(team)["Mia"] == "admin" and list(roles(team).values()).count("owner") == 1


def test_a_hand_over_needs_a_current_member(team):
    for target in (team.outsider, uuid.uuid4()):
        refused = transfer(team, team.owner, target)
        assert refused.status_code == 409 and refused.json()["detail"]["code"] == "not_a_member"
    again = transfer(team, team.owner, team.owner)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "already_owner"
    assert transfer(team, team.owner, "not-a-uuid").status_code == 422
    assert roles(team)["Olga"] == "owner" and owner_id(team) == team.owner.id


# --- the owner leaves --------------------------------------------------------------------------------------------------------

def leave(w, who, successor=None, **extra):
    w.as_(who)
    body = {"successor_user_id": str(successor.id)} if successor is not None else {}
    return w.client.post(f"/clubs/{w.cid}/leave", json={**body, **extra}) if (body or extra) else w.client.post(f"/clubs/{w.cid}/leave")


def test_an_owner_with_other_members_must_name_a_successor(team):
    refused = leave(team, team.owner)
    assert refused.status_code == 422 and refused.json()["detail"]["code"] == "successor_required"
    for bad in (team.outsider,):
        assert leave(team, team.owner, bad).json()["detail"]["code"] == "not_a_member"
    assert leave(team, team.owner, team.owner).json()["detail"]["code"] == "not_a_member"          # not themselves
    assert roles(team)["Olga"] == "owner"
    done = leave(team, team.owner, team.admin)
    assert done.status_code == 204
    assert roles(team) == {"Adam": "owner", "Mia": "member", "Max": "member"} and owner_id(team) == team.admin.id


def test_a_plain_member_successor_becomes_the_owner_and_the_old_owner_is_gone(team):
    assert leave(team, team.owner, team.m2).status_code == 204
    assert roles(team) == {"Adam": "admin", "Mia": "member", "Max": "owner"} and owner_id(team) == team.m2.id
    team.as_(team.owner)
    assert team.client.get(f"/clubs/{team.cid}").status_code == 404                              # no longer a member


def test_an_owner_alone_cannot_leave_and_non_owners_leave_as_before(world):
    owner, other = world.person("Solo"), world.person("Other")
    cid = world.club(owner)
    world.as_(owner)
    alone = world.client.post(f"/clubs/{cid}/leave")
    assert alone.status_code == 409 and alone.json()["detail"]["code"] == "only_member"
    world.add_member(cid, other)
    world.as_(other)
    assert world.client.post(f"/clubs/{cid}/leave", json={"successor_user_id": str(owner.id)}).status_code == 204     # a successor is ignored for a member
    world.as_(owner)
    assert world.client.get(f"/clubs/{cid}").json()["me"]["role"] == "owner"
    world.as_(owner)
    again = world.client.post(f"/clubs/{cid}/leave", json={"successor_user_id": str(other.id)})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "only_member"          # alone again, even naming someone who left


def test_leaving_with_a_successor_clears_the_old_owners_rsvp_and_votes(team):
    from datetime import timedelta as td
    team.as_(team.owner)
    meeting = team.client.post(f"/clubs/{team.cid}/meetings", json={"starts_at": (datetime.now(timezone.utc) + td(days=2)).isoformat()}).json()["id"]
    team.client.put(f"/clubs/{team.cid}/meetings/{meeting}/rsvp", json={"status": "going"})
    assert leave(team, team.owner, team.m1).status_code == 204
    team.db.rollback()
    assert team.db.scalar(text("SELECT count(*) FROM club_meeting_rsvps WHERE meeting_id = :m"), {"m": meeting}) == 0


def test_statements_do_not_grow_with_the_number_of_members(team, app_modules):
    def add_many(n):
        for k in range(n):
            team.add_member(team.cid, team.person(f"Extra {k}"))

    code = invite(team, team.owner)["code"]
    few_lookup, _ = counting(team, app_modules, team.outsider, f"/club-invites/code/{code}")
    few_transfer, response = counting(team, app_modules, team.owner, f"/clubs/{team.cid}/transfer", "post", json={"user_id": str(team.m1.id)})
    assert response.status_code == 200
    add_many(15)
    many_lookup, _ = counting(team, app_modules, team.outsider, f"/club-invites/code/{code}")
    many_transfer, response = counting(team, app_modules, team.m1, f"/clubs/{team.cid}/transfer", "post", json={"user_id": str(team.owner.id)})
    assert response.status_code == 200
    assert (few_lookup, few_transfer) == (many_lookup, many_transfer)
