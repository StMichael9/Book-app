"""Invites that have no code yet get a RANDOM one the first time their club's invites are listed or another invite is created.

The one-off backfill in migration b7c3f5a91d24 gave live invites codes worked out from their position, which anyone could recompute from the
public repo. It is a no-op in production (no live invites there); this is how any invite without a code gets one without that weakness.
"""
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from test_club_meetings import team  # noqa: F401
from test_clubs import world  # noqa: F401
from test_club_join_handover import CODE


def old_backfill_code(n: int) -> str:
    """What the old position-based backfill gave the n-th live invite."""
    alphabet, v = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", (n * 740297423 + 91234567) % 887503681
    return "".join(alphabet[(v // 31 ** k) % 31] for k in range(5, -1, -1))


def bare_invite(w, club_id, state="live"):
    """An invite as it was before codes existed: no code."""
    now = datetime.now(timezone.utc)
    row = w.models.ClubInvite(token=secrets.token_urlsafe(32), club_id=club_id, created_by=w.owner.id, code=None,
                              expires_at=now + (timedelta(days=-1) if state == "expired" else timedelta(days=5)), revoked_at=now if state == "revoked" else None)
    w.db.add(row)
    w.db.commit()
    return row.id


def listed(w, club_id=None):
    w.as_(w.owner)
    response = w.client.get(f"/clubs/{club_id or w.cid}/invites")
    assert response.status_code == 200, response.text
    return {i["id"]: i for i in response.json()["items"]}


def test_listing_gives_live_invites_without_a_code_a_random_one_and_leaves_the_rest(team):
    live = [str(bare_invite(team, team.cid)) for _ in range(3)]
    revoked, expired = str(bare_invite(team, team.cid, "revoked")), str(bare_invite(team, team.cid, "expired"))
    items = listed(team)
    codes = [items[i]["code"] for i in live]
    assert len(set(codes)) == 3 and all(CODE.match(c) for c in codes)
    assert items[revoked]["code"] is None and items[expired]["code"] is None                      # only live invites get one
    assert [listed(team)[i]["code"] for i in live] == codes                                        # stored: a second listing shows the same
    team.db.expire_all()
    assert team.db.scalar(text("SELECT count(*) FROM club_invites WHERE club_id = :c AND code IS NOT NULL"), {"c": team.cid}) == 3
    team.as_(team.outsider)
    assert team.client.get(f"/club-invites/code/{codes[0]}").status_code == 200                  # and the code works


def test_creating_an_invite_also_fills_the_clubs_missing_codes(team):
    old = bare_invite(team, team.cid)
    team.as_(team.owner)
    created = team.client.post(f"/clubs/{team.cid}/invites", json={}).json()
    team.db.expire_all()
    stored = team.db.scalar(text("SELECT code FROM club_invites WHERE id = :i"), {"i": old})
    assert stored and CODE.match(stored) and stored != created["code"]


def test_the_same_invites_in_two_places_get_different_codes_never_the_old_formula(team):
    other = team.club(team.owner, "Twin")
    for club_id in (team.cid, other):
        for _ in range(4):
            bare_invite(team, club_id)
    first = [i["code"] for i in listed(team, team.cid).values()]
    second = [i["code"] for i in listed(team, other).values()]
    assert len(set(first + second)) == 8                                                         # the "same" four invites in each club: eight different codes
    assert not set(first + second) & {old_backfill_code(n) for n in range(1, 200)}              # nothing a reader of the repo could work out


def test_a_collision_while_filling_retries_with_a_fresh_code(team, monkeypatch):
    from services import clubs
    team.as_(team.owner)
    taken = team.client.post(f"/clubs/{team.cid}/invites", json={}).json()["code"]
    bare_invite(team, team.cid)
    seq = iter([taken, taken, "QQQQQQ"])
    monkeypatch.setattr(clubs, "_new_code", lambda: next(seq))
    codes = sorted(i["code"] for i in listed(team).values())
    assert codes == sorted([taken, "QQQQQQ"])


def test_only_moderators_can_trigger_the_fill(team):
    bare_invite(team, team.cid)
    team.as_(team.m1)
    assert team.client.get(f"/clubs/{team.cid}/invites").status_code == 403
    team.db.expire_all()
    assert team.db.scalar(text("SELECT count(*) FROM club_invites WHERE club_id = :c AND code IS NOT NULL"), {"c": team.cid}) == 0
