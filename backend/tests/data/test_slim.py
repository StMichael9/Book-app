"""T66: the slim task removes only source aliases nothing reads, and a finished import leaves none behind."""
from __future__ import annotations

from sqlalchemy import select, text

from test_load import import_env  # noqa: F401
from test_import_resume import scenario
from test_popular_growth import fake_stream, popular


def test_orphan_aliases_are_counted_then_removed_and_the_rest_is_kept(import_env):
    models, factory, importer, config = import_env
    from data import slim
    with factory.begin() as session:
        book = models.Book(title="Held", source_id="/works/OL1W")
        session.add(book)
        session.flush()
        session.add_all([
            models.CatalogueSourceAlias(old_source_id="/works/OL10W", canonical_source_id="/works/OL1W", source_type="redirect"),
            models.CatalogueSourceAlias(old_source_id="/works/OL11W", canonical_source_id="/works/OL99W", source_type="redirect"),
            models.CatalogueSourceAlias(old_source_id="/works/OL12W", canonical_source_id="/works/OL98W", source_type="redirect"),
            models.CatalogueSourceAlias(old_source_id="/works/OL13W", canonical_source_id="/works/OL97W", source_type="deleted"),
        ])
    with factory.begin() as session:
        data = slim.report(session.connection())
        assert data["orphan_aliases"] == 2 and data["aliases_total"] == 4           # the deleted-type row is not an orphan
        assert slim.delete_orphan_aliases(session.connection()) == 2
    with factory() as session:
        left = set(session.scalars(select(models.CatalogueSourceAlias.old_source_id)))
    assert left == {"/works/OL10W", "/works/OL13W"}                                  # the held book's alias and the deleted marker


def test_a_finished_import_leaves_no_alias_without_a_book(import_env, monkeypatch):
    models, factory, importer, config = import_env
    fake_stream(monkeypatch, scenario())
    assert importer.run_import(popular(config)) == "complete"
    with factory() as session:
        orphans = session.execute(text("""SELECT count(*) FROM catalogue_source_aliases a WHERE a.source_type <> 'deleted'
            AND NOT EXISTS (SELECT 1 FROM books b WHERE b.source_id = a.canonical_source_id)""")).scalar_one()
    assert orphans == 0
