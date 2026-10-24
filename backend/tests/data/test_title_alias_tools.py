from __future__ import annotations

import gzip
import json

import pytest
from sqlalchemy import delete, func, select

from data import extract_title_aliases, load_title_aliases


def edition(work, title, languages=None, key="/books/OL1M"):
    data = {"key": key, "title": title, "works": [{"key": work}]}
    if languages is not None:
        data["languages"] = [{"key": f"/languages/{code}"} for code in languages]
    return f"/type/edition\t{key}\t1\t2026-01-01T00:00:00\t{json.dumps(data, ensure_ascii=False)}"


@pytest.fixture
def dump(tmp_path):
    lines = [
        edition("/works/OL1W", "The Odyssey", ["eng"]),
        edition("/works/OL1W", "  the   odyssey ", ["eng"]),
        edition("/works/OL1W", "THE ODYSSEY", ["eng", "fre"]),
        edition("/works/OL1W", "Odyssey of Homer", ["eng"]),
        edition("/works/OL1W", "Odyssey of Homer", ["eng"]),
        edition("/works/OL1W", "Homer's Odyssey", ["eng"]),
        edition("/works/OL1W", "Odyssey Retold", None),
        edition("/works/OL1W", "A fourth English title", ["eng"]),
        edition("/works/OL1W", "Ὀδύσσεια", ["eng"]),
        edition("/works/OL1W", "L'Odyssée", ["fre"]),
        edition("/works/OL2W", "Le Comte de Monte-Cristo", None),
        edition("/works/OL2W", "Der Graf von Monte Christo", ["ger"]),
        edition("/works/OL3W", "Война и мир", None),
        edition("/works/OL4W", "Unrequested work", ["eng"]),
        "not a dump line",
        "/type/edition\t/books/OL9M\t1\t2026-01-01\t{broken json",
        "/type/edition\t/books/OL9M\t1\t2026-01-01\t" + json.dumps({"title": "No work", "languages": [{"key": "/languages/eng"}]}),
    ]
    path = tmp_path / "editions.txt.gz"
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    works = tmp_path / "works.txt"
    works.write_text("/works/OL1W\tὈδύσσεια\n/works/OL2W\n/works/OL3W\n", encoding="utf-8")
    return path, works


def test_extractor_keeps_english_titles_deduplicated_capped_and_most_frequent_first(dump):
    path, works = dump
    rows = list(extract_title_aliases.extract(path, works))
    odyssey = [row for row in rows if row["work"] == "/works/OL1W"]
    assert [row["title"] for row in odyssey] == ["The Odyssey", "Odyssey of Homer", "Homer's Odyssey"]
    assert {row["language"] for row in odyssey} == {"eng"}


def test_extractor_skips_the_work_title_and_other_languages_and_unrequested_works(dump):
    path, works = dump
    rows = list(extract_title_aliases.extract(path, works))
    titles = {row["title"] for row in rows}
    assert "Ὀδύσσεια" not in titles and "L'Odyssée" not in titles and "Der Graf von Monte Christo" not in titles
    assert "Unrequested work" not in titles and "No work" not in titles
    assert all(row["work"] in {"/works/OL1W", "/works/OL2W", "/works/OL3W"} for row in rows)


def test_extractor_keeps_unlabelled_editions_only_when_ascii(dump):
    path, works = dump
    rows = {row["work"]: row for row in extract_title_aliases.extract(path, works) if row["work"] != "/works/OL1W"}
    assert rows["/works/OL2W"] == {"work": "/works/OL2W", "title": "Le Comte de Monte-Cristo", "language": None}
    assert "/works/OL3W" not in rows


def test_extractor_cli_writes_jsonl(dump, tmp_path, capsys):
    path, works = dump
    output = tmp_path / "aliases.jsonl"
    assert extract_title_aliases.main(["--editions-dump", str(path), "--works-file", str(works), "--output", str(output)]) == 0
    lines = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
    assert lines[0] == {"work": "/works/OL1W", "title": "The Odyssey", "language": "eng"}
    assert len(lines) == 4


@pytest.fixture
def catalogue(db_session, app_modules):
    models = app_modules["models"]
    db_session.execute(delete(models.CatalogueSourceAlias).where(models.CatalogueSourceAlias.old_source_id == "/works/OL6W"))
    odyssey = models.Book(title="Ὀδύσσεια", source_id="/works/OL1W")
    prince = models.Book(title="Le petit prince", source_id="/works/OL5W")
    db_session.add_all([odyssey, prince, models.CatalogueSourceAlias(
        old_source_id="/works/OL6W", canonical_source_id="/works/OL5W", source_type="redirect")])
    db_session.commit()
    yield {"odyssey": odyssey.id, "prince": prince.id}
    db_session.rollback()
    db_session.execute(delete(models.CatalogueSourceAlias).where(models.CatalogueSourceAlias.old_source_id == "/works/OL6W"))
    db_session.commit()


@pytest.fixture
def aliases_file(tmp_path):
    rows = [
        {"work": "/works/OL1W", "title": "The Odyssey", "language": "eng"},
        {"work": "/works/OL1W", "title": "Odyssey of Homer", "language": "eng"},
        {"work": "/works/OL6W", "title": "The Little Prince", "language": "eng"},
        {"work": "/works/OL5W", "title": "le PETIT prince", "language": "eng"},
        {"work": "/works/OL404W", "title": "Unknown", "language": "eng"},
    ]
    path = tmp_path / "aliases.jsonl"
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
    return path


def alias_count(db_session, models):
    db_session.expire_all()
    return db_session.scalar(select(func.count()).select_from(models.BookTitleAlias))


def test_loader_dry_run_reports_counts_and_writes_nothing(catalogue, aliases_file, test_database_url, db_session, app_modules):
    counts = load_title_aliases.load(test_database_url, aliases_file, apply=False, max_database_mb=10_000)
    assert counts == {"matched_works": 2, "new_aliases": 3, "skipped_duplicate": 1, "unknown_works": 1, "invalid_rows": 0, "applied": False}
    assert alias_count(db_session, app_modules["models"]) == 0


def test_loader_apply_is_idempotent_and_follows_redirects(catalogue, aliases_file, test_database_url, db_session, app_modules):
    models = app_modules["models"]
    first = load_title_aliases.load(test_database_url, aliases_file, apply=True, max_database_mb=10_000, batch_size=2)
    assert first["new_aliases"] == 3 and first["applied"] is True
    assert alias_count(db_session, models) == 3
    stored = db_session.execute(select(models.BookTitleAlias.book_id, models.BookTitleAlias.title, models.BookTitleAlias.language,
                                       models.BookTitleAlias.source).order_by(models.BookTitleAlias.id)).all()
    assert (catalogue["prince"], "The Little Prince", "eng", "openlibrary_edition") in stored
    second = load_title_aliases.load(test_database_url, aliases_file, apply=True, max_database_mb=10_000, batch_size=2)
    assert second["new_aliases"] == 0 and second["skipped_duplicate"] == 4 and second["unknown_works"] == 1
    assert alias_count(db_session, models) == 3


def test_loader_counts_unknown_works_without_inserting_them(catalogue, tmp_path, test_database_url, db_session, app_modules):
    path = tmp_path / "unknown.jsonl"
    path.write_text(json.dumps({"work": "/works/OL404W", "title": "Nobody", "language": "eng"}) + "\n", encoding="utf-8")
    counts = load_title_aliases.load(test_database_url, path, apply=True, max_database_mb=10_000)
    assert counts["unknown_works"] == 1 and counts["new_aliases"] == 0
    assert alias_count(db_session, app_modules["models"]) == 0


def test_loader_refuses_when_the_database_is_over_the_size_limit(catalogue, aliases_file, test_database_url, db_session, app_modules):
    with pytest.raises(load_title_aliases.DatabaseTooLarge):
        load_title_aliases.load(test_database_url, aliases_file, apply=True, max_database_mb=0)
    assert alias_count(db_session, app_modules["models"]) == 0
    assert load_title_aliases.main(["--database-url", test_database_url, "--input", str(aliases_file),
                                     "--apply", "--max-database-mb", "0"]) == 2


def test_loader_cli_never_falls_back_to_database_url(aliases_file, test_database_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", test_database_url)
    with pytest.raises(SystemExit):
        load_title_aliases.main(["--input", str(aliases_file)])


def test_loader_cli_is_a_dry_run_by_default(catalogue, aliases_file, test_database_url, db_session, app_modules, capsys):
    assert load_title_aliases.main(["--database-url", test_database_url, "--input", str(aliases_file)]) == 0
    assert "dry run" in capsys.readouterr().out.lower()
    assert alias_count(db_session, app_modules["models"]) == 0
