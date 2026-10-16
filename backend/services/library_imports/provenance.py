"""Owner-only source context, private labels and explicit retention controls."""
from sqlalchemy import delete, select

from models import ImportedLibraryRecord, UserBook
from services.library_imports.workflow import fail


def sources(db, user_id, entry_id, *, after=None, limit=10):
    entry = db.scalar(select(UserBook.id).where(UserBook.user_id == user_id, UserBook.id == entry_id))
    if entry is None:
        fail("library_entry_not_found", 404)
    query = select(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user_id,
        ImportedLibraryRecord.user_book_id == entry_id, ImportedLibraryRecord.removed.is_(False), ImportedLibraryRecord.context != {})
    if after:
        query = query.where(ImportedLibraryRecord.id > after)
    rows = list(db.scalars(query.order_by(ImportedLibraryRecord.id).limit(limit + 1)))
    return {"items": [{"id": row.id, "source": row.source, "context": row.context, "updated_at": row.updated_at} for row in rows[:limit]],
            "next_after": rows[limit - 1].id if len(rows) > limit else None}


def clear_source(db, user_id, entry_id, record_id):
    entry = db.scalar(select(UserBook).where(UserBook.user_id == user_id, UserBook.id == entry_id).with_for_update())
    if entry is None:
        fail("library_entry_not_found", 404)
    record = db.scalar(select(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user_id,
        ImportedLibraryRecord.user_book_id == entry_id, ImportedLibraryRecord.id == record_id).with_for_update())
    if record is None:
        fail("source_record_not_found", 404)
    # Accepted fingerprint and event links remain, so replay cannot restore this
    # removed text. Native notes, reactions, flags and attempts are untouched.
    record.context = {}
    db.commit()


def forget_removed_markers(db, user_id):
    removed = db.execute(delete(ImportedLibraryRecord).where(ImportedLibraryRecord.user_id == user_id,
        ImportedLibraryRecord.user_book_id.is_(None), ImportedLibraryRecord.removed.is_(True)))
    db.commit()
    return {"removed_markers": removed.rowcount}
