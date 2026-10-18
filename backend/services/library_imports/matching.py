"""Batched local work/edition evidence. No source API calls or catalogue writes."""
from collections import defaultdict

from sqlalchemy import func, select, union, or_

from models import Author, Book, CatalogueSourceAlias, Edition, EditionISBN, ImportedLibraryRecord, UserBook, book_authors
from services.library_imports.formats import canonical, digest


def _bounded_partition(query, key, maximum=6):
    rows = query.subquery()
    ranked = select(rows, func.row_number().over(partition_by=rows.c[key], order_by=rows.c.book_id).label("rank")).subquery()
    return select(ranked).where(ranked.c.rank <= maximum)


def evidence(db, user_id, source, scope, payloads):
    """At most 100 input rows, six candidates per identifier/title. Sixth flags overflow."""
    isbns = {value for row in payloads for value in row["isbns"]}
    work_keys = {row["work_source_id"] for row in payloads if row["work_source_id"]}
    titles = {canonical(row["title"]) for row in payloads if row["title"]}
    by_isbn, by_title, by_work = defaultdict(set), defaultdict(set), {}
    if isbns:
        candidates = union(select(Book.isbn13.label("isbn"), Book.id.label("book_id")).where(Book.isbn13.in_(isbns)),
            select(EditionISBN.isbn13.label("isbn"), Edition.book_id.label("book_id")).join(Edition).where(EditionISBN.isbn13.in_(isbns)))
        for row in db.execute(_bounded_partition(candidates, "isbn")):
            by_isbn[row.isbn].add(row.book_id)
    aliases = dict(db.execute(select(CatalogueSourceAlias.old_source_id, CatalogueSourceAlias.canonical_source_id)
        .where(CatalogueSourceAlias.old_source_id.in_(work_keys))).all()) if work_keys else {}
    if work_keys:
        canonical_keys = work_keys | set(aliases.values())
        found = dict(db.execute(select(Book.source_id, Book.id).where(Book.source_id.in_(canonical_keys))).all())
        by_work = {key: found.get(aliases.get(key, key)) for key in work_keys}
    # Lowercase/whitespace only; no lossy ASCII/transliteration/qualifier removal.
    title_key = func.lower(func.regexp_replace(func.btrim(Book.title), r"\s+", " ", "g"))
    if titles:
        query = select(title_key.label("title_key"), Book.id.label("book_id")).where(title_key.in_(titles))
        for row in db.execute(_bounded_partition(query, "title_key")):
            by_title[row.title_key].add(row.book_id)
    previous = {row.record_key: row for row in db.scalars(select(ImportedLibraryRecord).where(
        ImportedLibraryRecord.user_id == user_id, ImportedLibraryRecord.source == source,
        ImportedLibraryRecord.scope == scope, ImportedLibraryRecord.record_key.in_([row["record_key"] for row in payloads])))}
    ids = set().union(*by_isbn.values(), *by_title.values(), {value for value in by_work.values() if value is not None})
    previous_entry_ids = {row.user_book_id for row in previous.values() if row.user_book_id is not None}
    previous_entry_ids.update(row["native_entry_id"] for row in payloads if row.get("native_entry_id"))
    entries = list(db.scalars(select(UserBook).where(UserBook.user_id == user_id,
        or_(UserBook.book_id.in_(ids), UserBook.id.in_(previous_entry_ids)))))
    entries_by_book = {entry.book_id: entry for entry in entries if entry.book_id is not None}
    entries_by_id = {entry.id: entry for entry in entries}
    private_candidates = defaultdict(list)
    if titles:
        private_key = func.lower(func.regexp_replace(func.btrim(UserBook.private_title), r"\s+", " ", "g"))
        query = select(private_key.label("title_key"), UserBook.id.label("book_id"), UserBook.private_title.label("title"),
            UserBook.private_author.label("author"), UserBook.version).where(UserBook.user_id == user_id,
                UserBook.book_id.is_(None), private_key.in_(titles))
        for candidate in db.execute(_bounded_partition(query, "title_key")):
            private_candidates[candidate.title_key].append({"entry_id": candidate.book_id, "title": candidate.title,
                "authors": [candidate.author] if candidate.author else [], "version": candidate.version})
    ids.update(entry.book_id for entry in entries if entry.book_id is not None)
    books = {row.id: {"book_id": row.id, "title": row.title, "authors": []} for row in db.execute(
        select(Book.id, Book.title).where(Book.id.in_(ids)))}
    if ids:
        for book_id, name in db.execute(select(book_authors.c.book_id, Author.name).join(Author, Author.id == book_authors.c.author_id)
                .where(book_authors.c.book_id.in_(ids))):
            # Catalogue author counts are finite, but prevent hostile legacy
            # metadata from creating oversized previews.
            if len(books[book_id]["authors"]) < 20:
                books[book_id]["authors"].append(name)
        for book in books.values():
            book["authors"].sort(key=canonical)
    edition_matches = defaultdict(set)
    if isbns:
        query = select(EditionISBN.isbn13, Edition.id, Edition.book_id, Edition.source_id, Edition.physical_format, Edition.page_count).join(Edition).where(EditionISBN.isbn13.in_(isbns)).subquery()
        ranked = select(query, func.row_number().over(partition_by=query.c.isbn13, order_by=query.c.id).label("rank")).subquery()
        for row in db.execute(select(ranked).where(ranked.c.rank <= 6)):
            edition_matches[row.isbn13].add((row.id, row.book_id, row.source_id, row.physical_format, row.page_count))
    return {"isbn": by_isbn, "title": by_title, "work": by_work, "books": books, "entries": entries_by_book,
            "entries_by_id": entries_by_id, "previous": previous, "editions": edition_matches, "private": private_candidates}


def proposed_match(payload, found):
    identifiers = set().union(*(found["isbn"][value] for value in payload["isbns"]))
    explicit = found["work"].get(payload["work_source_id"])
    previous = found["previous"].get(payload["record_key"])
    native_entry = found["entries_by_id"].get(payload.get("native_entry_id"))
    suggestions = set(found["title"][canonical(payload["title"])]) if payload["title"] else set()
    strong_ids = identifiers | ({explicit} if explicit else set())
    reasons, selected, confidence = [], None, "none"
    if native_entry and native_entry.book_id is None:
        if not strong_ids and canonical(native_entry.private_title) == canonical(payload["title"]) and canonical(native_entry.private_author or "") == canonical(payload["author"]):
            return {"target_key": f"entry:{native_entry.id}", "candidates": [], "plan": {"kind": "existing", "entry_id": native_entry.id,
                "book_id": None, "expected_version": native_entry.version, "evidence": digest(payload), "confidence": "owned_bookvane_id"}}
        reasons.append("bookvane_identity_disagreement")
    elif native_entry and (not strong_ids or strong_ids == {native_entry.book_id}):
        selected, confidence = native_entry.book_id, "owned_bookvane_id"
    if previous and (previous.removed or previous.user_book_id is None):
        return {"target_key": f"removed:{payload['record_key']}", "candidates": [], "plan": {"kind": "removed", "reason": "removed_record"}}
    if previous:
        entry = found["entries_by_id"].get(previous.user_book_id)
        if entry and (not strong_ids or strong_ids == {entry.book_id}):
            if entry.book_id is None:
                if canonical(entry.private_title) == canonical(payload["title"]) and canonical(entry.private_author or "") == canonical(payload["author"]):
                    return {"target_key": f"entry:{entry.id}", "candidates": [], "plan": {"kind": "existing", "entry_id": entry.id,
                        "book_id": None, "expected_version": entry.version, "evidence": digest(payload), "confidence": "previous"}}
            else:
                selected, confidence = entry.book_id, "previous"
        else:
            reasons.append("previous_identity_changed")
    if selected is None and len(strong_ids) == 1 and not reasons:
        selected, confidence = next(iter(strong_ids)), "identifier"
    elif len(strong_ids) > 1:
        reasons.append("conflicting_identifiers")
    if payload["work_source_id"] and not explicit:
        reasons.append("unknown_work_key")
    if selected:
        book = found["books"].get(selected)
        if not book or (payload["title"] and canonical(book["title"]) != canonical(payload["title"])):
            reasons.append("title_disagreement")
        author_evidence = {canonical(author) for author in book["authors"]} if book else set()
        if book and confidence == "owned_bookvane_id":
            author_evidence.add(canonical(", ".join(book["authors"])))
        if book and payload["author"] and canonical(payload["author"]) not in author_evidence:
            reasons.append("author_disagreement")
    if selected is None and not reasons and payload["author"]:
        exact = [book_id for book_id in suggestions if canonical(payload["author"]) in {canonical(name) for name in found["books"][book_id]["authors"]}]
        if len(exact) == 1 and len(suggestions) < 6:
            selected, confidence = exact[0], "title_author"
    candidates = sorted(strong_ids | suggestions)
    previews = [found["books"][book_id] for book_id in candidates[:5] if book_id in found["books"]]
    private = found["private"][canonical(payload["title"])] if payload["title"] else []
    if private and confidence not in ("previous", "owned_bookvane_id") and (selected is None or selected not in found["entries"]):
        reasons.append("private_library_match_requires_review")
        previews = (previews + private)[:5]
    if reasons or selected is None:
        kind = "review" if reasons or candidates else "private"
        return {"target_key": f"record:{payload['record_key']}", "candidates": previews,
                "plan": {"kind": kind, "reasons": reasons, "candidate_overflow": len(candidates) > 5,
                         "private_available": bool(payload["title"])}}
    entry = found["entries"].get(selected)
    editions = set().union(*(found["editions"][value] for value in payload["isbns"]))
    editions = {item for item in editions if item[1] == selected}
    edition = next(iter(editions)) if len(editions) == 1 else None
    if edition and any((event.get("format") and edition[3] and canonical(event["format"]) != canonical(edition[3]))
            or (event.get("total_pages") and edition[4] and event["total_pages"] != edition[4]) for event in payload["events"]):
        # Work confidence is not edition confidence. Keep supplied copy/page
        # context without asserting a contradictory catalogue edition link.
        edition = None
    plan = {"kind": "existing" if entry else "catalogue", "book_id": selected,
            "entry_id": entry.id if entry else None, "expected_version": entry.version if entry else None,
            "confidence": confidence, "edition_id": edition[0] if edition else None,
            "edition_source_id": edition[2] if edition else None,
            "evidence": digest({"book": found["books"][selected], "isbns": sorted(identifiers), "edition": edition}),
            "needs_approval": confidence == "title_author"}
    return {"target_key": f"book:{selected}", "candidates": previews, "plan": plan}
