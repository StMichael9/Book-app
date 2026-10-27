from __future__ import annotations

import gzip
import json

import pytest
from sqlalchemy import delete, func, select

from data import extract_catalogue_backfill, extract_title_aliases, load_catalogue_backfill


def work_line(key, **fields):
    return f"/type/work\t{key}\t1\t2026-01-01T00:00:00\t{json.dumps({'key': key, **fields}, ensure_ascii=False)}"


def edition_line(work, title, *, pages=None, covers=None, languages=None, n=[0]):
    n[0] += 1
    data = {"key": f"/books/OL{n[0]}M", "title": title, "works": [{"key": work}]}
    if pages is not None:
        data["number_of_pages"] = pages
    if covers is not None:
        data["covers"] = covers
    if languages is not None:
        data["languages"] = [{"key": f"/languages/{code}"} for code in languages]
    return f"/type/edition\t{data['key']}\t1\t2026-01-01T00:00:00\t{json.dumps(data, ensure_ascii=False)}"


def write_gz(path, lines):
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    return path


MARKUP = "<p>A <b>great</b> [novel](http://x.org) about whales.</p>\n\n([source][1])\n\n[1]: http://example.org/ref"


@pytest.mark.parametrize("raw,expected", [
    (MARKUP, "A great novel about whales."),
    ({"type": "/type/text", "value": "Plain text description."}, "Plain text description."),
    ("**Bold** and __also__ with &amp; entity", "Bold and also with & entity"),
    ("Line one.\n\n\n\n\nLine two.", "Line one.\n\nLine two."),
    ("![cover](http://img/x.png) Text", "Text"),
    ("See <https://example.org> now", "See now"),
    ("   ", None), (None, None), (123, None), ({"value": "  "}, None), ("<p></p>", None),
])
def test_descriptions_are_stripped_of_markup(raw, expected):
    assert extract_catalogue_backfill.clean_description(raw) == expected


def test_long_descriptions_are_capped_at_a_word_boundary():
    capped = extract_catalogue_backfill.clean_description("word " * 2000)
    assert len(capped) <= 5000 and capped.endswith("…") and not capped[:-1].endswith(" ")
    assert extract_catalogue_backfill.clean_description("x" * 100) == "x" * 100


@pytest.fixture
def dumps(tmp_path):
    works = write_gz(tmp_path / "works.txt.gz", [
        work_line("/works/OL1W", title="Moby Dick", description=MARKUP),
        work_line("/works/OL2W", title="Second", description={"type": "/type/text", "value": "Plain text description."},
                  first_publish_date="June 3, 1847"),
        work_line("/works/OL3W", title="Third", description="word " * 1200, first_publish_year=1999),
        work_line("/works/OL4W", title="Fourth", description="   ", first_publish_date="n.d."),
        work_line("/works/OL5W", title="Unrequested", description="Ignored."),
        work_line("/works/OL6W", title="Sixth", first_publish_date="1066"),
        "not a dump line",
        "/type/work\t/works/OL1W\t1\t2026\t{broken json",
    ])
    editions = write_gz(tmp_path / "editions.txt.gz", [
        edition_line("/works/OL1W", "The Whale", pages=320, covers=[-1], languages=["eng"]),
        edition_line("/works/OL1W", "The Whale", pages=300, covers=[12345], languages=["eng"]),
        edition_line("/works/OL1W", "La Baleine", pages=900, covers=[999], languages=["fre"]),
        edition_line("/works/OL1W", "Moby Dick", pages=0, languages=["eng"]),
        edition_line("/works/OL1W", "Moby Dick", pages="abc", languages=["eng"]),
        edition_line("/works/OL1W", "Moby Dick", pages=True, languages=["eng"]),
        edition_line("/works/OL4W", "Fourth edition", pages=250, covers=[]),
        edition_line("/works/OL5W", "Unrequested edition", pages=10, covers=[5]),
    ])
    wanted = tmp_path / "works.txt"
    wanted.write_text("/works/OL1W\n/works/OL2W\n/works/OL3W\n/works/OL4W\n/works/OL6W\n", encoding="utf-8")
    return works, editions, wanted


def rows_by_work(rows):
    return {row["work"]: row for row in rows}


def test_extractor_combines_both_dumps_per_requested_work(dumps):
    works, editions, wanted = dumps
    rows = rows_by_work(extract_catalogue_backfill.extract(wanted, works_dump=works, editions_dump=editions))
    assert rows["/works/OL1W"] == {"work": "/works/OL1W", "description": "A great novel about whales.",
                                   "page_count": 310, "cover_id": 12345}
    assert rows["/works/OL2W"] == {"work": "/works/OL2W", "description": "Plain text description.", "first_publish_year": 1847}
    assert rows["/works/OL3W"]["first_publish_year"] == 1999 and len(rows["/works/OL3W"]["description"]) <= 5000
    assert rows["/works/OL4W"] == {"work": "/works/OL4W", "page_count": 250}
    assert set(rows) == {"/works/OL1W", "/works/OL2W", "/works/OL3W", "/works/OL4W"}  # OL5W unrequested, OL6W has nothing valid


def test_extractor_works_with_only_one_dump(dumps):
    works, editions, wanted = dumps
    only_works = rows_by_work(extract_catalogue_backfill.extract(wanted, works_dump=works))
    assert "page_count" not in only_works["/works/OL1W"] and only_works["/works/OL1W"]["description"]
    only_editions = rows_by_work(extract_catalogue_backfill.extract(wanted, editions_dump=editions))
    assert set(only_editions["/works/OL1W"]) == {"work", "page_count", "cover_id"}


def test_one_editions_pass_can_also_write_the_title_aliases(dumps, tmp_path):
    works, editions, wanted = dumps
    out, aliases = tmp_path / "backfill.jsonl", tmp_path / "aliases.jsonl"
    assert extract_catalogue_backfill.main(["--works-file", str(wanted), "--works-dump", str(works), "--editions-dump", str(editions),
                                            "--output", str(out), "--aliases-output", str(aliases)]) == 0
    written = [json.loads(line) for line in aliases.read_text(encoding="utf-8").splitlines()]
    assert written == [{"work": "/works/OL1W", "title": "The Whale", "language": "eng"},
                       {"work": "/works/OL4W", "title": "Fourth edition", "language": None}]
    titled = tmp_path / "titled.txt"
    titled.write_text("/works/OL1W\tMoby Dick\n/works/OL4W\tFourth\n", encoding="utf-8")
    assert written == list(extract_title_aliases.extract(editions, titled))
    assert [json.loads(line)["work"] for line in out.read_text(encoding="utf-8").splitlines()] == [
        "/works/OL1W", "/works/OL2W", "/works/OL3W", "/works/OL4W"]


def test_extractor_cli_needs_a_dump_and_never_touches_the_network(dumps, tmp_path):
    works, editions, wanted = dumps
    with pytest.raises(SystemExit):
        extract_catalogue_backfill.main(["--works-file", str(wanted)])
    with pytest.raises(SystemExit):
        extract_catalogue_backfill.main(["--works-file", str(wanted), "--works-dump", str(works), "--aliases-output", str(tmp_path / "a.jsonl")])


@pytest.fixture
def catalogue(db_session, app_modules):
    models = app_modules["models"]
    author = models.Author(name="Dump Author")
    db_session.add(author)
    db_session.execute(delete(models.CatalogueSourceAlias).where(models.CatalogueSourceAlias.old_source_id == "/works/OL9W"))
    made = {}

    def book(key, **fields):
        item = models.Book(title=f"Book {key}", source_id=key, **fields)
        item.authors.append(author)
        db_session.add(item)
        made[key] = item
        return item

    book("/works/OL1W")
    book("/works/OL2W", description="Keep me.", page_count=100, cover_image_url="")
    book("/works/OL3W", description="Whole.", page_count=50, published_year=1900, cover_image_url="https://c/whole.jpg")
    book("/works/OL4W", description="   ", page_count=60, published_year=1950, cover_image_url="https://c/four.jpg")
    db_session.add(models.CatalogueSourceAlias(old_source_id="/works/OL9W", canonical_source_id="/works/OL1W", source_type="redirect"))
    db_session.commit()
    yield {key: item.id for key, item in made.items()}
    db_session.rollback()
    db_session.execute(delete(models.CatalogueSourceAlias).where(models.CatalogueSourceAlias.old_source_id == "/works/OL9W"))
    db_session.commit()


@pytest.fixture
def backfill_file(tmp_path):
    rows = [
        json.dumps({"work": "/works/OL1W", "page_count": 310, "cover_id": 12345, "first_publish_year": 1851}),
        json.dumps({"work": "/works/OL9W", "description": "Call me Ishmael."}),
        json.dumps({"work": "/works/OL2W", "description": "Replace?", "page_count": 999, "first_publish_year": 1847, "cover_id": 777}),
        json.dumps({"work": "/works/OL3W", "description": "No.", "page_count": 1, "first_publish_year": 1800, "cover_id": 1}),
        json.dumps({"work": "/works/OL4W", "description": "Real text."}),
        json.dumps({"work": "/works/OL404W", "description": "Unknown work."}),
        json.dumps({"work": "/works/OL1W", "page_count": -5}),
        json.dumps({"work": "x", "description": "bad key"}),
        "not json",
    ]
    path = tmp_path / "backfill.jsonl"
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return path


def book_state(db_session, models, book_id):
    db_session.expire_all()
    book = db_session.get(models.Book, book_id)
    return dict(description=book.description, page_count=book.page_count, published_year=book.published_year,
                cover_image_url=book.cover_image_url, is_complete=book.is_complete)


def test_loader_dry_run_writes_nothing_and_predicts_the_apply(catalogue, backfill_file, test_database_url, db_session, app_modules):
    models = app_modules["models"]
    before = {key: book_state(db_session, models, book_id) for key, book_id in catalogue.items()}
    dry = load_catalogue_backfill.load(test_database_url, backfill_file, max_database_mb=10_000)
    assert {key: book_state(db_session, models, book_id) for key, book_id in catalogue.items()} == before
    assert dry["applied"] is False
    applied = load_catalogue_backfill.load(test_database_url, backfill_file, apply=True, max_database_mb=10_000)
    assert applied["filled"] == dry["filled"] and applied["complete_after"] == dry["complete_after"]


def test_loader_fills_only_missing_fields_and_never_overwrites(catalogue, backfill_file, test_database_url, db_session, app_modules):
    models = app_modules["models"]
    report = load_catalogue_backfill.load(test_database_url, backfill_file, apply=True, max_database_mb=10_000, batch_size=2)
    one, two = book_state(db_session, models, catalogue["/works/OL1W"]), book_state(db_session, models, catalogue["/works/OL2W"])
    assert one == dict(description="Call me Ishmael.", page_count=310, published_year=1851,
                       cover_image_url="https://covers.openlibrary.org/b/id/12345-L.jpg", is_complete=True)
    assert two == dict(description="Keep me.", page_count=100, published_year=1847,
                       cover_image_url="https://covers.openlibrary.org/b/id/777-L.jpg", is_complete=True)
    assert book_state(db_session, models, catalogue["/works/OL3W"]) == dict(
        description="Whole.", page_count=50, published_year=1900, cover_image_url="https://c/whole.jpg", is_complete=True)
    assert book_state(db_session, models, catalogue["/works/OL4W"])["description"] == "Real text."
    assert report["filled"] == {"description": 2, "published_year": 2, "page_count": 1, "cover_image_url": 2}
    assert report["matched_works"] == 4 and report["unknown_works"] == 1 and report["invalid_rows"] == 3
    assert report["complete_after"] == report["complete_before"] + 3


def test_loader_rerun_changes_nothing(catalogue, backfill_file, test_database_url, db_session, app_modules):
    load_catalogue_backfill.load(test_database_url, backfill_file, apply=True, max_database_mb=10_000)
    state = {key: book_state(db_session, app_modules["models"], book_id) for key, book_id in catalogue.items()}
    again = load_catalogue_backfill.load(test_database_url, backfill_file, apply=True, max_database_mb=10_000)
    assert again["filled"] == {"description": 0, "published_year": 0, "page_count": 0, "cover_image_url": 0}
    assert again["complete_before"] == again["complete_after"]
    assert {key: book_state(db_session, app_modules["models"], book_id) for key, book_id in catalogue.items()} == state


def test_loader_refuses_when_the_database_is_over_the_size_limit(catalogue, backfill_file, test_database_url, db_session, app_modules):
    models = app_modules["models"]
    before = book_state(db_session, models, catalogue["/works/OL1W"])
    with pytest.raises(load_catalogue_backfill.DatabaseTooLarge):
        load_catalogue_backfill.load(test_database_url, backfill_file, apply=True, max_database_mb=0)
    assert book_state(db_session, models, catalogue["/works/OL1W"]) == before
    assert load_catalogue_backfill.main(["--database-url", test_database_url, "--input", str(backfill_file),
                                         "--apply", "--max-database-mb", "0"]) == 2


def test_loader_cli_needs_an_explicit_url_and_is_a_dry_run_by_default(catalogue, backfill_file, test_database_url, db_session, app_modules,
                                                                     monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", test_database_url)
    with pytest.raises(SystemExit):
        load_catalogue_backfill.main(["--input", str(backfill_file)])
    with pytest.raises(SystemExit):
        load_catalogue_backfill.main(["--database-url", test_database_url, "--input", str(backfill_file), "--apply"])
    assert load_catalogue_backfill.main(["--database-url", test_database_url, "--input", str(backfill_file)]) == 0
    assert "dry run" in capsys.readouterr().out.lower()
    assert book_state(db_session, app_modules["models"], catalogue["/works/OL1W"])["description"] is None
