"""Apply a prevalidated bounded group batch. Caller owns its transaction.

Native fields always win. Imported text is source context, never native notes,
reactions, preferences or catalogue metadata. Deleted-source markers survive.
"""
from collections import defaultdict
from datetime import date, datetime, timezone
from uuid import uuid4, uuid5

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert

from models import Book, Edition, ImportedLibraryRecord, ImportedReadLink, ReadingAttempt, UserBook
from services.library import projection
from services.library_imports.formats import canonical, digest, staged_size


def _context(rows):
    # Dates belong to each event, not a last-row-wins record field.
    excluded = {"started_on", "finished_on", "attempt_id", "status", "private_note"}
    contexts = [{key: value for key, value in row.payload["context"].items() if key not in excluded} for row in rows]
    if len({digest(value) for value in contexts}) > 1:
        return None
    context = dict(contexts[0])
    source_dates = [{key: row.payload["context"][key] for key in ("started_on", "finished_on", "status") if row.payload["context"].get(key)} for row in rows]
    if any(source_dates):
        context["source_dates"] = list({digest(value): value for value in source_dates if value}.values())
    notes = {row.payload["context"]["private_note"] for row in rows if row.payload["context"].get("private_note")}
    if len(notes) == 1:
        context["private_note"] = next(iter(notes))
    elif notes:
        context["reading_notes"] = [{"events": [event["key"] for event in row.payload["events"]],
            "private_note": row.payload["context"]["private_note"]} for row in rows if row.payload["context"].get("private_note")]
    context["import_warnings"] = list(dict.fromkeys(warning for row in rows for warning in row.payload["warnings"]))
    return context if staged_size(context) <= 262144 else None


def apply_groups(db, run, groups):
    """At most 100 source rows across complete target groups. No commits here."""
    rows = [row for group in groups for row in group]
    by_record = defaultdict(list)
    for row in rows:
        by_record[row.record_key].append(row)
    records = {record.record_key: record for record in db.scalars(select(ImportedLibraryRecord).where(
        ImportedLibraryRecord.user_id == run.user_id, ImportedLibraryRecord.source == run.source,
        ImportedLibraryRecord.scope == run.scope, ImportedLibraryRecord.record_key.in_(by_record)))}
    book_ids = {row.plan["book_id"] for row in rows if row.plan.get("book_id")}
    entry_ids = {row.plan["entry_id"] for row in rows if row.plan.get("entry_id")}
    entries = list(db.scalars(select(UserBook).where(UserBook.user_id == run.user_id,
        or_(UserBook.id.in_(entry_ids), UserBook.book_id.in_(book_ids)))
        .order_by(UserBook.id).with_for_update().execution_options(populate_existing=True)))
    by_entry, by_book = {entry.id: entry for entry in entries}, {entry.book_id: entry for entry in entries if entry.book_id}
    # Native deletion locks the parent before its provenance-removal triggers.
    # Use that same order here, not records→parent, to avoid a lock inversion.
    if records:
        records = {record.record_key: record for record in db.scalars(select(ImportedLibraryRecord).where(
            ImportedLibraryRecord.user_id == run.user_id, ImportedLibraryRecord.id.in_([record.id for record in records.values()]))
            .order_by(ImportedLibraryRecord.id).with_for_update().execution_options(populate_existing=True))}
    histories = defaultdict(list)
    # The work batch is bounded; large existing histories are never fetched in
    # full. The 101st signals review rather than silently ignoring old reads.
    if by_entry:
        ranked = select(ReadingAttempt.id, ReadingAttempt.user_book_id,
            func.row_number().over(partition_by=ReadingAttempt.user_book_id, order_by=ReadingAttempt.id).label("rank")).where(ReadingAttempt.user_book_id.in_(by_entry)).subquery()
        attempts = db.scalars(select(ReadingAttempt).join(ranked, ranked.c.id == ReadingAttempt.id).where(ranked.c.rank <= 101))
        for attempt in attempts:
            histories[attempt.user_book_id].append(attempt)
    links = {(link.record_id, link.event_key): link for link in db.scalars(select(ImportedReadLink).where(
        ImportedReadLink.user_id == run.user_id, ImportedReadLink.record_id.in_([record.id for record in records.values()]),
        ImportedReadLink.event_key.in_({event["key"] for row in rows for event in row.payload["events"]}))) }
    books = {book.id: book for book in db.scalars(select(Book).where(Book.id.in_(book_ids)).with_for_update(read=True, key_share=True))}
    editions = {edition.id: edition for edition in db.scalars(select(Edition).where(
        Edition.id.in_({row.plan["edition_id"] for row in rows if row.plan.get("edition_id")})))}
    prepared, inserts, lookups = [], [], {}
    for group in groups:
        first = group[0]
        plan = first.plan
        if any(row.error_code or row.disposition not in ("approved", "ready") for row in group):
            continue
        payloads = [row.payload for row in group]
        if any(records.get(row.record_key) and records[row.record_key].removed for row in group):
            _review(group, "removed_record")
            continue
        if any(row.record_key in records and row.plan.get("expected_source_updated_at") != records[row.record_key].updated_at.isoformat() for row in group):
            _review(group, "source_context_changed_since_preview")
            continue
        source_groups = {key: [row for row in group if row.record_key == key] for key in {row.record_key for row in group}}
        contexts = {key: _context(value) for key, value in source_groups.items()}
        if any(value is None for value in contexts.values()):
            _review(group, "conflicting_source_context")
            continue
        # An accepted source update is not account synchronization. A changed
        # fingerprint requires a preview decision; an exact reupload is a no-op.
        hashes = {key: digest(sorted({row.row_hash for row in value})) for key, value in source_groups.items()}
        changed = [key for key in source_groups if key in records and records[key].accepted_hash != hashes[key]]
        if changed and not all(row.plan.get("accept_source_update") for row in group):
            _review(group, "source_record_changed")
            continue
        entry = by_entry.get(plan.get("entry_id")) if plan.get("entry_id") else by_book.get(plan.get("book_id"))
        if plan.get("entry_id"):
            if entry is None or entry.version != plan.get("expected_version"):
                _review(group, "library_changed_since_preview")
                continue
        elif entry is not None:
            _review(group, "library_changed_since_preview")
            continue
        if plan.get("book_id") and plan["book_id"] not in books:
            _review(group, "catalogue_changed_since_preview")
            continue
        if any(key in records and records[key].user_book_id != (entry.id if entry else None) for key in source_groups):
            _review(group, "source_target_conflict")
            continue
        event_versions = defaultdict(set)
        for payload in payloads:
            for event in payload["events"]:
                event_versions[event["key"]].add(digest(event))
        if any(len(values) > 1 for values in event_versions.values()):
            _review(group, "conflicting_read_event")
            continue
        events = {event["key"]: event for payload in payloads for event in payload["events"]}
        context_only = all(row.plan.get("history_policy") == "context_only" for row in group)
        if {event["state"] for event in events.values()} >= {"finished", "dnf"} and not context_only:
            _review(group, "mixed_terminal_states_require_context_decision")
            continue
        if len(events) > 100 or (not context_only and len({event["key"] for payload in payloads for event in payload["events"] if event["state"] in ("reading", "paused")}) > 1):
            _review(group, "conflicting_or_oversized_history")
            continue
        existing = histories.get(entry.id, []) if entry else []
        if len(existing) > 100 and not context_only:
            _review(group, "large_existing_history_requires_review")
            continue
        event_plans = []
        for row in group:
            record = records.get(row.record_key)
            for event in row.payload["events"]:
                link = links.get((record.id, event["key"])) if record else None
                if link:
                    if link.event_hash != digest(event):
                        # A stable external event can change without changing
                        # the native read it was originally linked to. Accepted
                        # identical replay is a no-op, even after context erasure.
                        if record.accepted_hash == hashes[row.record_key]:
                            event_plans.append((row, event, "unchanged", link.attempt_id))
                            continue
                        # The changed-source guard above already requires
                        # explicit update consent. Preserve the incoming span
                        # only as context; never rewrite the old link or attempt.
                        if context_only:
                            event_plans.append((row, event, "context", None))
                            continue
                        _review(group, "source_event_changed")
                        break
                    event_plans.append((row, event, "unchanged", link.attempt_id))
                    continue
                if context_only:
                    event_plans.append((row, event, "context", None))
                    continue
                native = next((attempt for attempt in existing if str(attempt.id) == event.get("native_attempt_id")), None)
                if native:
                    same = native.state == event["state"] and (str(native.started_on) if native.started_on else None) == event["started_on"] and (str(native.ended_on) if native.ended_on else None) == event["ended_on"]
                    if not same:
                        _review(group, "bookvane_reading_changed")
                        break
                    event_plans.append((row, event, "link", native.id))
                    continue
                exact = [attempt for attempt in existing if attempt.state == event["state"]
                    and (str(attempt.started_on) if attempt.started_on else None) == event["started_on"]
                    and (str(attempt.ended_on) if attempt.ended_on else None) == event["ended_on"]]
                if len(exact) == 1 and (event["started_on"] or event["ended_on"]):
                    event_plans.append((row, event, "link", exact[0].id))
                elif existing and row.plan.get("history_policy") != "add":
                    event_plans.append((row, event, "context", None))
                elif event["state"] in ("reading", "paused") and any(attempt.state in ("reading", "paused") for attempt in existing):
                    _review(group, "active_read_conflict")
                    break
                elif existing and row.plan.get("history_policy") == "add" and (not event["ended_on"]
                        or any(attempt.ended_on is None or str(attempt.ended_on) == event["ended_on"] for attempt in existing)):
                    _review(group, "overlapping_read_requires_review")
                    break
                else:
                    event_plans.append((row, event, "new", uuid4()))
            if any(row.error_code for row in group):
                break
        if any(row.error_code for row in group):
            continue
        for row, event, action, _ in event_plans:
            if action == "context":
                context = contexts[row.record_key]
                context["history_preserved_without_changes"] = True
                preserved = {value["key"]: value for value in context.get("preserved_events", [])}
                preserved[event["key"]] = event
                context["preserved_events"] = list(preserved.values())
                if context_only:
                    context["history_policy"] = "context_only"
        if any(staged_size(context) > 262144 for context in contexts.values()):
            _review(group, "source_context_limit")
            continue
        request_id = uuid5(run.user_id, f"import:{run.source}:{run.scope}:{first.target_key}")
        if entry is None:
            payload = first.payload
            if not plan.get("book_id") and not payload["title"]:
                _review(group, "private_title_required")
                continue
            lookup = None if plan.get("book_id") else _lookup(payload)
            own = any(payload["is_owned"] is True for payload in payloads)
            want = any(payload["is_wanted"] is True for payload in payloads)
            inserts.append({"user_id": run.user_id, "book_id": plan.get("book_id"),
                "private_title": None if plan.get("book_id") else payload["title"],
                "private_author": None if plan.get("book_id") else payload["author"] or None,
                # A matched catalogue book keeps its own description; only a reader's private entry stores this one.
                "private_description": None if plan.get("book_id") else payload.get("description") or None,
                "private_catalogue": lookup and {"isbn": lookup["isbn"], "lookup_key": lookup["key"]},
                "is_owned": own, "is_wanted": want, "status": projection(own, want), "version": 1,
                "create_request_id": request_id, "creation_fingerprint": digest({"target": first.target_key})})
            if lookup:
                lookups[request_id] = lookup
        prepared.append((group, entry, request_id, contexts, hashes, event_plans))
    created = {}
    if inserts:
        result = db.scalars(insert(UserBook).values(inserts).on_conflict_do_nothing().returning(UserBook))
        created = {entry.create_request_id: entry for entry in result}
    _enqueue_lookups(db, created, lookups)
    source_inserts, attempt_inserts, link_inserts = [], [], []
    count = {"added_entries": len(created), "linked_records": 0, "added_reads": 0, "preserved_reads": 0}
    new_event_ids = {}
    for group, entry, request_id, contexts, hashes, events in prepared:
        entry = entry or created.get(request_id)
        if entry is None:
            _review(group, "library_changed_since_preview")
            continue
        for key in contexts:
            record = records.get(key)
            if record is None:
                record = ImportedLibraryRecord(id=uuid4(), user_id=run.user_id, user_book_id=entry.id,
                    source=run.source, scope=run.scope, record_key=key, accepted_hash=hashes[key], context=contexts[key])
                records[key] = record
                source_inserts.append(record)
                count["linked_records"] += 1
            elif record.accepted_hash != hashes[key]:
                record.accepted_hash, record.context = hashes[key], contexts[key]
        if any(row.error_code for row in group):
            continue
        touched = False
        for row, event, action, attempt_id in events:
            record = records[row.record_key]
            if action == "unchanged":
                continue
            event_identity = (entry.id, event["key"])
            if action == "new" and event_identity not in new_event_ids:
                edition = editions.get(row.plan.get("edition_id"))
                attempt_inserts.append(ReadingAttempt(id=attempt_id, user_book_id=entry.id, state=event["state"],
                    started_on=date.fromisoformat(event["started_on"]) if event["started_on"] else None,
                    ended_on=date.fromisoformat(event["ended_on"]) if event["ended_on"] else None,
                    total_pages=event["total_pages"], edition_id=edition.id if edition and edition.book_id == entry.book_id else None,
                    edition_source_id=edition.source_id if edition and edition.book_id == entry.book_id else None,
                    edition_format=event.get("format") if event.get("format") and len(event["format"]) <= 200 else None,
                    creation_fingerprint=digest(event), origin="import"))
                new_event_ids[event_identity] = attempt_id
                count["added_reads"] += 1
                touched = True
            elif action == "context":
                count["preserved_reads"] += 1
            if action == "new":
                attempt_id = new_event_ids[event_identity]
            link_key = (record.id, event["key"])
            if link_key not in links:
                link = ImportedReadLink(id=uuid4(), user_id=run.user_id, record_id=record.id, user_book_id=entry.id,
                    attempt_id=attempt_id, event_key=event["key"], event_hash=digest(event))
                link_inserts.append(link)
                links[link_key] = link
        if touched:
            entry.version += 1
            entry.updated_at = datetime.now(timezone.utc)
        for row in group:
            row.disposition = "applied"
            row.result_entry_id = entry.id
            row.plan = {**row.plan, "entry_id": entry.id}
    db.add_all(source_inserts)
    db.flush()
    db.add_all(attempt_inserts)
    db.flush()
    db.add_all(link_inserts)
    return count


def _lookup(payload):
    """What to look up for an unmatched row: its ISBN, else its title and author. None when there is nothing to search on."""
    from services.catalogue_queue import lookup_key
    isbn = payload["isbns"][0] if payload.get("isbns") else None
    title, author = payload.get("title"), payload.get("author")
    if not isbn and not (title and author):
        return None
    return {"isbn": isbn, "title": title, "author": author, "key": lookup_key(isbn, title, author)}


def _enqueue_lookups(db, created, lookups):
    """Queue the new private entries for a one-time Open Library lookup; they stay private entries until it succeeds."""
    from sqlalchemy import event
    from services import catalogue_queue
    queued = False
    for request_id, entry in created.items():
        lookup = lookups.get(request_id)
        if lookup and entry.book_id is None:
            catalogue_queue.enqueue(db, isbn=lookup["isbn"], title=lookup["title"], author=lookup["author"],
                                    user_book_id=entry.id)
            queued = True
    if queued:
        event.listen(db, "after_commit", lambda _session: catalogue_queue.wake(), once=True)


def _review(group, code):
    for row in group:
        row.disposition, row.error_code = "review", code
