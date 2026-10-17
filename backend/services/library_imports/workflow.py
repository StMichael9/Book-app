"""Durable bounded import requests, checkpointed in the transaction they advance.

No background tasks, external source requests, shared catalogue writes or
per-record commits. The authenticated browser drives one short step at a time.
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from database import settings
from library_import_models import LibraryImportRow as Row, LibraryImportRun as Run
from models import Book, CatalogueImportRun, ImportedLibraryRecord, UserBook
from services.library_imports.formats import FormatError, canonical, digest, inspect_headers, normalize_row, size, staged_size
from services.library_imports.matching import evidence, proposed_match

ACTIVE = ("uploading", "analyzing", "grouping", "preview_ready", "applying")
TERMINAL = ("completed", "completed_with_issues", "cancelled", "expired")


def fail(code, status=409):
    raise HTTPException(status, detail={"code": code})


def utcnow():
    return datetime.now(timezone.utc)


def limits():
    return {"file_bytes": 20 * 1024 * 1024, "rows": 20000, "batch_rows": 100,
            "request_bytes": 512 * 1024, "field_bytes": 65536, "columns": 128,
            "staged_bytes": 32 * 1024 * 1024, "events": 50000, "resume_days": 7}


class ImportWorkflow:
    def __init__(self, db):
        self.db = db

    def _budget(self):
        self.db.execute(text("SET LOCAL lock_timeout = '1s'"))
        self.db.execute(text("SET LOCAL statement_timeout = '8s'"))
        # Transaction-scoped locks survive multiple app processes and release
        # on commit/rollback; no connection waits while a reader reviews a file.
        for slot in (1, 2):
            if self.db.scalar(text("SELECT pg_try_advisory_xact_lock(513005, :slot)"), {"slot": slot}):
                return
        fail("import_busy_retry", 429)

    def _lock(self, user_id, run_id, *, active=True):
        self._budget()
        run = self.db.scalar(select(Run).where(Run.id == run_id, Run.user_id == user_id)
            .with_for_update(nowait=True).execution_options(populate_existing=True))
        if run is None:
            fail("import_not_found", 404)
        if active and run.expires_at <= utcnow():
            fail("import_expired", 410)
        if run.adapter_version != 1:
            fail("unsupported_import_version")
        return run

    def _capacity(self, *, reserve=False):
        # Do not raise the catalogue's saved storage guard. The feature's own
        # ceiling can only be reduced, not raised above the approved 800 MiB.
        ceiling = min(800, getattr(settings, "library_import_max_database_mb", 800))
        saved = self.db.scalar(select(CatalogueImportRun.max_database_mb)
            .where(CatalogueImportRun.max_database_mb.is_not(None)).order_by(CatalogueImportRun.updated_at.desc()).limit(1))
        if saved and saved > 0:
            ceiling = min(ceiling, saved)
        actual = self.db.scalar(text("SELECT pg_database_size(current_database())"))
        reservations = self.db.scalar(select(func.count()).select_from(Run).where(Run.phase.in_(ACTIVE))) or 0
        reserved = (reservations + int(reserve)) * 32 * 1024 * 1024
        if reserved > 128 * 1024 * 1024 or actual + reserved + 32 * 1024 * 1024 >= ceiling * 1024 * 1024:
            fail("import_capacity_pause", 507)
        return actual

    def _touch(self, run):
        run.updated_at = utcnow()
        run.expires_at = utcnow() + timedelta(days=7)
        run.report_expires_at = utcnow() + timedelta(days=30)

    def status(self, user_id, run_id):
        run = self.db.scalar(select(Run).where(Run.id == run_id, Run.user_id == user_id))
        if run is None or run.report_expires_at <= utcnow():
            fail("import_not_found", 404)
        result = {field: getattr(run, field) for field in ("id", "source", "scope", "phase", "row_count", "batch_count", "analyze_cursor", "group_cursor", "revision", "manifest_hash", "summary", "last_error", "expires_at", "report_expires_at", "created_at")}
        if run.expires_at <= utcnow() and run.phase not in TERMINAL:
            result["phase"] = "expired"
        result["limits"] = limits()
        if result["phase"] == "uploading":
            result["upload_config"] = {"headers": run.headers, "mapping": run.mapping, "source": run.source,
                "status_map": run.options.get("status_map", {}), "encoding": run.options.get("encoding", "UTF-8")}
        return result

    def recent(self, user_id):
        return [self.status(user_id, run_id) for run_id in self.db.scalars(select(Run.id)
            .where(Run.user_id == user_id, Run.report_expires_at > utcnow()).order_by(Run.created_at.desc()).limit(10))]

    def start(self, user_id, data):
        inspection = inspect_headers(data.headers, data.mapping)
        if inspection["ambiguous"] or inspection["missing_identity"]:
            fail("column_clarification_required", 422)
        source = "paste" if data.source == "paste" else inspection["source"]
        fingerprint = digest({"headers": data.headers, "mapping": inspection["mapping"], "source": source,
                              "scope": data.scope, "status_map": data.status_map, "encoding": data.encoding})
        self._budget()
        # Serialize capacity reservations/startup cleanup across all processes.
        if not self.db.scalar(text("SELECT pg_try_advisory_xact_lock(513005, 3)")):
            fail("import_busy_retry", 429)
        self.cleanup()
        # Maintenance must make durable progress even if this new run later
        # fails capacity reservation. Otherwise expired runs can trap capacity
        # forever by rolling their own cleanup back on every rejected start.
        self.db.commit()
        self._budget()
        if not self.db.scalar(text("SELECT pg_try_advisory_xact_lock(513005, 3)")):
            fail("import_busy_retry", 429)
        prior = self.db.scalar(select(Run).where(Run.id == data.id, Run.user_id == user_id))
        if prior:
            if prior.creation_fingerprint != fingerprint:
                fail("import_request_reused")
            self.db.commit()
            return self.status(user_id, prior.id)
        if self.db.scalar(select(Run.id).where(Run.user_id == user_id, Run.phase.in_(ACTIVE)).limit(1)):
            fail("active_import_exists")
        self._capacity(reserve=True)
        run = Run(id=data.id, user_id=user_id, source=source, scope=data.scope, headers=data.headers,
            mapping=inspection["mapping"], options={"status_map": {canonical(key): value for key, value in data.status_map.items()},
                "ignored_columns": inspection["ignored_columns"], "encoding": data.encoding}, creation_fingerprint=fingerprint)
        self.db.add(run)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            fail("active_import_or_request_exists")
        return self.status(user_id, run.id)

    def upload(self, user_id, run_id, ordinal, data):
        run = self._lock(user_id, run_id)
        batch_hash = digest(data.rows)
        if ordinal < run.batch_count:
            prior = self.db.execute(select(Row.batch_hash, Row.batch_length).where(Row.run_id == run.id,
                Row.user_id == user_id, Row.batch_ordinal == ordinal).limit(1)).one_or_none()
            if prior is None or prior.batch_hash != batch_hash or prior.batch_length != len(data.rows):
                fail("batch_content_changed")
            self.db.commit()
            return {"batch_hash": batch_hash, "status": self.status(user_id, run.id)}
        if run.phase != "uploading" or ordinal != run.batch_count:
            fail("unexpected_batch")
        if run.row_count + len(data.rows) > 20000 or size(data.model_dump()) > 512 * 1024:
            fail("import_input_limit", 413)
        self._capacity()
        rows, stage_bytes, event_count, input_bytes = [], 0, 0, 0
        for offset, cells in enumerate(data.rows, start=1):
            input_bytes += sum(len(cell.encode("utf-8")) for cell in cells) + len(cells)
            try:
                payload = normalize_row(run.source, run.headers, run.mapping, cells, status_map=run.options.get("status_map"))
                error = None
            except FormatError as exc:
                # Invalid content is not silently truncated or retained forever.
                payload, error = None, str(exc)
            row_hash = digest(payload) if payload else digest(cells)
            stage_bytes += staged_size(payload, {}, [])
            event_count += len(payload["events"]) if payload else 0
            rows.append({"run_id": run.id, "ordinal": run.row_count + offset, "user_id": user_id,
                "batch_ordinal": ordinal, "batch_hash": batch_hash, "batch_length": len(data.rows),
                "payload": payload, "row_hash": row_hash, "record_key": payload["record_key"] if payload else row_hash,
                "disposition": "pending" if payload else "invalid", "error_code": error})
        if run.stage_bytes + stage_bytes > 32 * 1024 * 1024 or run.event_count + event_count > 50000 or run.input_bytes + input_bytes > 20 * 1024 * 1024:
            fail("import_input_limit", 413)
        self.db.execute(insert(Row), rows)
        run.row_count += len(rows)
        run.batch_count += 1
        run.stage_bytes += stage_bytes
        run.input_bytes += input_bytes
        run.event_count += event_count
        self._touch(run)
        self.db.commit()
        return {"batch_hash": batch_hash, "status": self.status(user_id, run.id)}

    def finalize(self, user_id, run_id, data):
        run = self._lock(user_id, run_id)
        if run.phase != "uploading":
            if run.manifest_hash == data.manifest_hash and run.row_count == data.row_count and run.batch_count == data.batch_count:
                self.db.commit()
                return self.status(user_id, run.id)
            fail("upload_already_finalized")
        # At most 20K compact digests, not source payloads; maximum about 1.4 MiB.
        batches = self.db.execute(select(Row.batch_ordinal, func.min(Row.batch_hash), func.count())
            .where(Row.run_id == run.id, Row.user_id == user_id).group_by(Row.batch_ordinal).order_by(Row.batch_ordinal)).all()
        manifest = [{"ordinal": ordinal, "hash": value, "length": count} for ordinal, value, count in batches]
        if data.row_count != run.row_count or data.batch_count != run.batch_count or data.manifest_hash != digest(manifest):
            fail("upload_manifest_mismatch")
        run.manifest_hash, run.phase = data.manifest_hash, "analyzing"
        self._touch(run)
        self.db.commit()
        return self.status(user_id, run.id)

    def advance_analysis(self, user_id, run_id):
        run = self._lock(user_id, run_id)
        if run.phase not in ("analyzing", "grouping"):
            fail("import_not_analyzing")
        self._capacity()
        if run.phase == "analyzing":
            rows = list(self.db.scalars(select(Row).where(Row.run_id == run.id, Row.user_id == user_id,
                Row.ordinal > run.analyze_cursor).order_by(Row.ordinal).limit(100)))
            valid = [row for row in rows if row.payload]
            found = evidence(self.db, user_id, run.source, run.scope, [row.payload for row in valid]) if valid else None
            added_bytes = 0
            for row in valid:
                result = proposed_match(row.payload, found)
                previous = found["previous"].get(row.record_key)
                result["plan"]["expected_source_updated_at"] = previous.updated_at.isoformat() if previous else None
                added_bytes += staged_size(result["candidates"], result["plan"]) - staged_size(row.candidates, row.plan)
                row.target_key, row.candidates, row.plan = result["target_key"], result["candidates"], result["plan"]
                row.disposition = "review" if row.plan["kind"] in ("review", "removed") or row.payload["warnings"] else "ready"
            if run.stage_bytes + added_bytes > 32 * 1024 * 1024:
                fail("import_staging_limit_cancel_or_use_smaller_file", 413)
            run.stage_bytes += added_bytes
            if rows:
                run.analyze_cursor = rows[-1].ordinal
            if run.analyze_cursor == run.row_count:
                run.phase = "grouping"
        else:
            self._group(run)
        self._touch(run)
        self.db.commit()
        return self.status(user_id, run.id)

    def _group(self, run):
        rows = list(self.db.scalars(select(Row).where(Row.run_id == run.id, Row.user_id == run.user_id,
            Row.ordinal > run.group_cursor).order_by(Row.ordinal).limit(100)))
        target_keys = {row.target_key for row in rows if row.target_key}
        record_keys = {row.record_key for row in rows}
        groups = {key: (count, hashes, first, finished, stopped) for key, count, hashes, first, finished, stopped in self.db.execute(
            select(Row.target_key, func.count(), func.count(func.distinct(Row.row_hash)), func.min(Row.ordinal),
                func.bool_or(func.jsonb_path_exists(Row.payload, '$.events[*] ? (@.state == "finished")')),
                func.bool_or(func.jsonb_path_exists(Row.payload, '$.events[*] ? (@.state == "dnf")')))
            .where(Row.run_id == run.id, Row.user_id == run.user_id, Row.target_key.in_(target_keys)).group_by(Row.target_key))}
        sources = dict(self.db.execute(select(Row.record_key, func.count(func.distinct(Row.target_key)))
            .where(Row.run_id == run.id, Row.user_id == run.user_id, Row.record_key.in_(record_keys)).group_by(Row.record_key)).all())
        hashes = {key: digest(sorted(set(values))) for key, values in self.db.execute(
            select(Row.record_key, func.array_agg(Row.row_hash)).where(Row.run_id == run.id, Row.user_id == run.user_id,
                Row.record_key.in_(record_keys)).group_by(Row.record_key))}
        accepted = {key: (value, policy) for key, value, policy in self.db.execute(select(ImportedLibraryRecord.record_key,
            ImportedLibraryRecord.accepted_hash, ImportedLibraryRecord.context["history_policy"].astext)
            .where(ImportedLibraryRecord.user_id == run.user_id, ImportedLibraryRecord.source == run.source,
                ImportedLibraryRecord.scope == run.scope, ImportedLibraryRecord.record_key.in_(record_keys)))}
        for row in rows:
            if row.payload is None or row.decision or row.disposition == "duplicate":
                continue
            # Counts are bounded SQL aggregates; never materialize an enormous
            # same-book history. Preview rejects/isolates oversized groups.
            group = groups[row.target_key]
            source_targets = sources[row.record_key]
            if group[1] == 1 and group[0] > 1 and source_targets == 1:
                self.db.execute(update(Row).where(Row.run_id == run.id, Row.user_id == run.user_id,
                    Row.target_key == row.target_key, Row.ordinal != group[2], Row.disposition.in_(("ready", "review", "approved")))
                    .values(disposition="duplicate", error_code=None))
                if row.ordinal != group[2]:
                    continue
            if (group[0] > 100 and group[1] > 1) or source_targets > 1:
                row.disposition, row.error_code = "review", "oversized_or_conflicting_identity_group"
            elif row.record_key in accepted and accepted[row.record_key][0] == hashes[row.record_key] and row.plan.get("kind") in ("existing", "catalogue", "private"):
                if accepted[row.record_key][1] == "context_only":
                    row.plan = {**row.plan, "history_policy": "context_only"}
                row.disposition, row.error_code = "ready", None
            elif group[3] and group[4]:
                row.disposition, row.error_code = "review", "mixed_terminal_states_require_context_decision"
            elif group[1] > 1:
                # Different rows for one work may be real rereads OR conflicting
                # editions/statuses. Do not make input-order decide the outcome.
                row.disposition, row.error_code = "review", "multiple_source_rows_for_work"
            elif row.record_key in accepted and accepted[row.record_key][0] != hashes[row.record_key]:
                row.disposition, row.error_code = "review", "source_record_changed"
        if rows:
            run.group_cursor = rows[-1].ordinal
        if run.group_cursor == run.row_count:
            run.phase = "preview_ready"
            run.summary = self._summary(run)

    def _summary(self, run):
        return {"rows": run.row_count, "dispositions": dict(self.db.execute(select(Row.disposition, func.count())
            .where(Row.run_id == run.id, Row.user_id == run.user_id).group_by(Row.disposition)).all()),
            "distinct_targets": self.db.scalar(select(func.count(func.distinct(Row.target_key))).where(Row.run_id == run.id, Row.user_id == run.user_id)),
            "targets_by_kind": dict(self.db.execute(select(Row.plan["kind"].astext, func.count(func.distinct(Row.target_key)))
                .where(Row.run_id == run.id, Row.user_id == run.user_id, Row.target_key.is_not(None))
                .group_by(Row.plan["kind"].astext)).all()),
            "ignored_columns": run.options.get("ignored_columns", [])}

    def preview(self, user_id, run_id, *, after=0, only_review=False, limit=25):
        run = self.db.scalar(select(Run).where(Run.id == run_id, Run.user_id == user_id))
        if run is None or run.report_expires_at <= utcnow():
            fail("import_not_found", 404)
        if run.expires_at <= utcnow() and run.phase not in TERMINAL:
            fail("import_expired", 410)
        query = select(Row).where(Row.run_id == run.id, Row.user_id == user_id, Row.ordinal > after)
        if only_review:
            query = query.where(Row.disposition.in_(("review", "invalid")))
        rows = list(self.db.scalars(query.order_by(Row.ordinal).limit(limit + 1)))
        items = [{"ordinal": row.ordinal, "source": row.payload, "candidates": row.candidates, "plan": row.plan,
                  "decision": row.decision, "disposition": row.disposition, "error_code": row.error_code,
                  "entry_id": row.result_entry_id} for row in rows[:limit]]
        return {"items": items, "next_after": rows[limit - 1].ordinal if len(rows) > limit else None, "revision": run.revision}

    def decide(self, user_id, run_id, ordinal, data):
        run = self._lock(user_id, run_id)
        if run.phase != "preview_ready" or run.revision != data.expected_revision:
            fail("preview_changed")
        row = self.db.scalar(select(Row).where(Row.run_id == run.id, Row.user_id == user_id, Row.ordinal == ordinal))
        if row is None:
            fail("import_row_not_found", 404)
        if row.payload is None and data.action != "skip":
            fail("invalid_row_must_be_skipped", 422)
        related = (Row.target_key == row.target_key) if row.target_key else (Row.ordinal == row.ordinal)
        related = related | (Row.record_key == row.record_key)
        query = select(Row).where(Row.run_id == run.id, Row.user_id == user_id, related).order_by(Row.ordinal)
        group = list(self.db.scalars(query.limit(101)))
        if len(group) > 100:
            if data.action != "skip":
                fail("oversized_group_must_be_skipped", 422)
            self.db.execute(update(Row).where(Row.run_id == run.id, Row.user_id == user_id, related)
                .values(decision="skip", disposition="skipped", error_code=None))
        else:
            plan = dict(row.plan)
            target_key = row.target_key
            if data.action == "match":
                if data.entry_id:
                    entry = self.db.scalar(select(UserBook).where(UserBook.user_id == user_id, UserBook.id == data.entry_id))
                    if entry is None:
                        fail("library_entry_not_found", 404)
                    target_key = f"book:{entry.book_id}" if entry.book_id else f"entry:{entry.id}"
                    plan = {"kind": "existing", "book_id": entry.book_id, "entry_id": entry.id, "expected_version": entry.version}
                else:
                    book = self.db.get(Book, data.book_id)
                    if book is None:
                        fail("catalogue_book_not_found", 404)
                    entry = self.db.scalar(select(UserBook).where(UserBook.user_id == user_id, UserBook.book_id == book.id))
                    target_key = f"book:{book.id}"
                    plan = {"kind": "existing" if entry else "catalogue", "book_id": book.id,
                            "entry_id": entry.id if entry else None, "expected_version": entry.version if entry else None}
                plan["explicit_match"] = True
            elif data.action == "private":
                if not row.payload["title"]:
                    fail("private_title_required", 422)
                if row.plan.get("kind") == "removed":
                    fail("removed_record_cannot_be_restored_implicitly")
                plan = {"kind": "private", "private_available": True}
                target_key = f"record:{row.record_key}"
            elif data.action == "preserve" and plan.get("kind") not in ("existing", "catalogue", "private"):
                fail("choose_match_private_or_skip", 422)
            if data.action == "preserve" and plan.get("entry_id"):
                entry = self.db.scalar(select(UserBook).where(UserBook.user_id == user_id, UserBook.id == plan["entry_id"]))
                if entry is None:
                    fail("library_entry_not_found", 404)
                plan["expected_version"] = entry.version
            plan.update({"history_policy": data.history_policy, "accept_source_update": data.accept_source_update})
            source_versions = dict(self.db.execute(select(ImportedLibraryRecord.record_key, ImportedLibraryRecord.updated_at)
                .where(ImportedLibraryRecord.user_id == user_id, ImportedLibraryRecord.source == run.source,
                    ImportedLibraryRecord.scope == run.scope, ImportedLibraryRecord.record_key.in_({item.record_key for item in group}))).all())
            for item in group:
                item.decision = data.action
                item.disposition = "skipped" if data.action == "skip" else "approved"
                item.error_code = None
                if data.action != "skip":
                    version = source_versions.get(item.record_key)
                    item_plan = {**plan, "expected_source_updated_at": version.isoformat() if version else None}
                    run.stage_bytes += staged_size(item_plan) - staged_size(item.plan)
                    item.plan, item.target_key = item_plan, target_key
            if run.stage_bytes > 32 * 1024 * 1024:
                fail("import_staging_limit_cancel_or_use_smaller_file", 413)
        run.revision += 1
        # A match may combine formerly separate target groups. Recheck all
        # collisions with bounded grouping requests before another confirmation.
        run.phase, run.group_cursor = "grouping", 0
        self._touch(run)
        self.db.commit()
        return self.status(user_id, run.id)

    def confirm(self, user_id, run_id, data):
        run = self._lock(user_id, run_id)
        if run.phase == "applying" and run.confirmed_revision == data.expected_revision and run.manifest_hash == data.manifest_hash:
            if run.options.get("confirmation") != data.model_dump():
                fail("confirmation_policy_changed")
            self.db.commit()
            return self.status(user_id, run.id)
        if run.phase != "preview_ready" or run.revision != data.expected_revision or run.manifest_hash != data.manifest_hash:
            fail("preview_changed")
        if data.accept_warnings:
            # This authorizes keeping unsupported source values as private
            # context, not resolving identity collisions or inventing dates.
            self.db.execute(update(Row).where(Row.run_id == run.id, Row.user_id == user_id,
                Row.disposition == "review", Row.error_code.is_(None),
                Row.plan["kind"].astext.in_(("existing", "catalogue", "private")))
                .values(disposition="ready"))
        if data.approve_private:
            self.db.execute(update(Row).where(Row.run_id == run.id, Row.user_id == user_id,
                Row.disposition == "ready", Row.plan["kind"].astext == "private")
                .values(disposition="approved", decision="private"))
        else:
            self.db.execute(update(Row).where(Row.run_id == run.id, Row.user_id == user_id,
                Row.disposition == "ready", Row.plan["kind"].astext == "private")
                .values(disposition="review", error_code="private_approval_required"))
        unresolved = self.db.scalar(select(func.count()).select_from(Row).where(Row.run_id == run.id, Row.user_id == user_id,
            Row.disposition.in_(("invalid", "review"))))
        if unresolved and not data.skip_unresolved:
            fail("unresolved_rows_require_decision")
        if data.skip_unresolved:
            self.db.execute(update(Row).where(Row.run_id == run.id, Row.user_id == user_id,
                Row.disposition.in_(("invalid", "review"))).values(disposition="skipped"))
        run.confirmed_revision, run.phase = run.revision, "applying"
        run.options = {**run.options, "confirmation": data.model_dump()}
        run.summary = {**self._summary(run), "applied": {}}
        self._touch(run)
        self.db.commit()
        return self.status(user_id, run.id)

    def advance_apply(self, user_id, run_id):
        from services.library_imports.application import apply_groups
        run = self._lock(user_id, run_id)
        if run.phase in ("completed", "completed_with_issues"):
            self.db.commit()
            return self.status(user_id, run.id)
        if run.phase != "applying" or run.confirmed_revision != run.revision:
            fail("import_not_confirmed")
        self._capacity()
        # Choose only complete target groups whose total rows fit this batch.
        grouped = self.db.execute(select(Row.target_key, func.count(), func.min(Row.ordinal))
            .where(Row.run_id == run.id, Row.user_id == user_id, Row.disposition.in_(("ready", "approved")))
            .group_by(Row.target_key).order_by(func.min(Row.ordinal)).limit(100)).all()
        keys, count = [], 0
        for key, amount, _ in grouped:
            if amount > 100:
                self.db.execute(update(Row).where(Row.run_id == run.id, Row.user_id == user_id, Row.target_key == key)
                    .values(disposition="review", error_code="oversized_group_must_be_skipped"))
                continue
            if count + amount > 100:
                break
            keys.append(key)
            count += amount
        rows = list(self.db.scalars(select(Row).where(Row.run_id == run.id, Row.user_id == user_id,
            Row.target_key.in_(keys), Row.disposition.in_(("ready", "approved"))).order_by(Row.ordinal))) if keys else []
        groups = {}
        for row in rows:
            groups.setdefault(row.target_key, []).append(row)
        # Re-evaluate automatic catalogue evidence after confirmation. Explicit
        # owner decisions still cannot refer to a removed/foreign target.
        automatic = [row for row in rows if row.plan.get("book_id") and not row.plan.get("explicit_match")]
        if automatic:
            found = evidence(self.db, user_id, run.source, run.scope, [row.payload for row in automatic])
            for row in automatic:
                current = proposed_match(row.payload, found)
                if current["plan"].get("book_id") != row.plan.get("book_id") or current["plan"].get("evidence") != row.plan.get("evidence"):
                    for affected in groups[row.target_key]:
                        affected.disposition, affected.error_code = "review", "catalogue_changed_since_preview"
        counts = apply_groups(self.db, run, list(groups.values())) if groups else {}
        self.db.flush()
        totals = dict(run.summary.get("applied", {}))
        for key, value in counts.items():
            totals[key] = totals.get(key, 0) + value
        summary = self._summary(run)
        run.summary = {**summary, "applied": totals}
        pending = summary["dispositions"].get("ready", 0) + summary["dispositions"].get("approved", 0)
        review = summary["dispositions"].get("review", 0)
        if not pending:
            if review:
                run.phase, run.confirmed_revision = "preview_ready", None
                run.revision += 1
            else:
                run.phase = "completed_with_issues" if summary["dispositions"].get("skipped", 0) else "completed"
                self._purge(run)
        self._touch(run)
        self.db.commit()
        return self.status(user_id, run.id)

    def cancel(self, user_id, run_id):
        run = self._lock(user_id, run_id, active=False)
        if run.phase not in TERMINAL:
            run.phase = "cancelled"
            run.summary = self._summary(run)
            self._purge(run)
            self._touch(run)
        self.db.commit()
        return self.status(user_id, run.id)

    def _purge(self, run):
        self.db.execute(update(Row).where(Row.run_id == run.id, Row.user_id == run.user_id)
            .values(payload=None, candidates=[], plan={}, target_key=None))
        run.stage_bytes = 0

    def cleanup(self):
        # One bounded maintenance pass per import start, using SKIP LOCKED.
        expired = list(self.db.scalars(select(Run).where(Run.expires_at <= utcnow(), Run.phase.in_((*ACTIVE, "failed")))
            .order_by(Run.expires_at).limit(2).with_for_update(skip_locked=True)))
        for run in expired:
            run.phase = "expired"
            run.summary = self._summary(run)
            self._purge(run)
        report_ids = list(self.db.scalars(select(Run.id).where(Run.report_expires_at <= utcnow())
            .order_by(Run.report_expires_at).limit(2).with_for_update(skip_locked=True)))
        if report_ids:
            self.db.execute(delete(Run).where(Run.id.in_(report_ids)))
