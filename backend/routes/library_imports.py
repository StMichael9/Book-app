"""Authenticated private-import requests; default-off until separately approved."""
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from auth.dependencies import get_current_user
from database import engine, get_db, settings
from library_import_schemas import ConfirmImport, FinalizeImport, ForgetImportMarkers, ImportDecision, InspectImport, StartImport, UploadImportBatch
from models import User
from rate_limit import limiter
from services.library import reading_enabled
from services.library_imports.formats import FormatError, inspect_headers
from services.library_imports.workflow import ImportWorkflow, fail
from services.library_imports.provenance import clear_source, forget_removed_markers, sources
from routes.library import reading_user, writing_user

router = APIRouter(prefix="/me/library-imports")
sources_router = APIRouter(prefix="/me/library")


class ImportBodyLimit:
    """Bound bytes BEFORE JSON/Pydantic allocation, including chunked bodies."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/me/library-imports") or scope["method"] not in ("POST", "PUT", "PATCH"):
            return await self.app(scope, receive, send)
        chunks, total = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body = message.get("body", b"")
            total += len(body)
            if total > 512 * 1024:
                response = JSONResponse({"detail": {"code": "import_request_too_large"}}, status_code=413,
                    headers={"Cache-Control": "private, no-store"})
                return await response(scope, receive, send)
            chunks.append(body)
            if not message.get("more_body"):
                break
        consumed = False
        async def bounded_receive():
            nonlocal consumed
            if not consumed:
                consumed = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()
        return await self.app(scope, bounded_receive, send)


def import_user(current_user: User = Depends(get_current_user)):
    if not reading_enabled(current_user.id):
        fail("library_import_disabled", 403)
    return current_user


def _execute(db, operation):
    try:
        return operation()
    except FormatError as exc:
        db.rollback()
        fail(str(exc), 422)
    except (OperationalError, TimeoutError):
        db.rollback()
        fail("import_temporarily_unavailable_retry", 503)
    except IntegrityError:
        db.rollback()
        fail("import_concurrent_change_retry")


@router.post("/inspect")
@limiter.limit("30/minute")
def inspect_import(request: Request, data: InspectImport, current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    return _execute(db, lambda: inspect_headers(data.headers, data.mapping))


@router.get("")
@limiter.limit("60/minute")
def recent_imports(request: Request, current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    return {"items": _execute(db, lambda: ImportWorkflow(db).recent(current_user.id))}


@router.post("")
@limiter.limit("10/minute")
def start_import(request: Request, data: StartImport, current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    return _execute(db, lambda: ImportWorkflow(db).start(current_user.id, data))


@router.post("/forget-removed-markers")
@limiter.limit("3/minute")
def forget_markers(request: Request, data: ForgetImportMarkers, current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    return _execute(db, lambda: forget_removed_markers(db, current_user.id))


@sources_router.get("/{entry_id}/imported-sources")
@limiter.limit("60/minute")
def source_context(request: Request, entry_id: int, after: UUID | None = None,
                   current_user: User = Depends(reading_user), db: Session = Depends(get_db)):
    return _execute(db, lambda: sources(db, current_user.id, entry_id, after=after))


@sources_router.delete("/{entry_id}/imported-sources/{record_id}")
@limiter.limit("30/minute")
def remove_source_context(request: Request, entry_id: int, record_id: UUID,
                          current_user: User = Depends(writing_user), db: Session = Depends(get_db)):
    _execute(db, lambda: clear_source(db, current_user.id, entry_id, record_id))
    return {"removed": True}


@router.get("/export.csv")
@limiter.limit("3/minute")
def library_csv(request: Request, current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    from services.library_imports.exports import CsvLibraryExport
    owner = current_user.id
    db.rollback()  # Release authentication's connection before the snapshot.
    export = _execute(db, lambda: CsvLibraryExport(engine, owner))
    return StreamingResponse(export.stream(), media_type="text/csv; charset=utf-8", background=BackgroundTask(export.close),
        headers={"Content-Disposition": 'attachment; filename="bookvane-library-v1.csv"',
            "Content-Length": str(export.length), "X-Content-Type-Options": "nosniff"})


@router.get("/{run_id}")
@limiter.limit("120/minute")
def import_status(request: Request, run_id: UUID, current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    return _execute(db, lambda: ImportWorkflow(db).status(current_user.id, run_id))


@router.get("/{run_id}/report.csv")
@limiter.limit("6/minute")
def import_report(request: Request, run_id: UUID, current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    from services.library_imports.exports import CsvLibraryExport
    owner = current_user.id
    _execute(db, lambda: ImportWorkflow(db).status(owner, run_id))
    db.rollback()
    export = _execute(db, lambda: CsvLibraryExport(engine, owner, report_id=run_id))
    return StreamingResponse(export.stream(), media_type="text/csv; charset=utf-8", background=BackgroundTask(export.close),
        headers={"Content-Disposition": 'attachment; filename="bookvane-import-results.csv"',
            "Content-Length": str(export.length), "X-Content-Type-Options": "nosniff"})


@router.get("/{run_id}/rows")
@limiter.limit("120/minute")
def import_preview(request: Request, run_id: UUID, after: int = Query(default=0, ge=0, le=20000),
                   only_review: bool = False, limit: int = Query(default=25, ge=1, le=100),
                   current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    return _execute(db, lambda: ImportWorkflow(db).preview(current_user.id, run_id, after=after, only_review=only_review, limit=limit))


@router.put("/{run_id}/batches/{ordinal}")
@limiter.limit("120/minute")
def import_batch(request: Request, run_id: UUID, ordinal: int, data: UploadImportBatch,
                 current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    if not 0 <= ordinal < 20000:
        fail("invalid_batch_ordinal", 422)
    return _execute(db, lambda: ImportWorkflow(db).upload(current_user.id, run_id, ordinal, data))


@router.post("/{run_id}/finalize-upload")
@limiter.limit("30/minute")
def finalize_import(request: Request, run_id: UUID, data: FinalizeImport,
                    current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    return _execute(db, lambda: ImportWorkflow(db).finalize(current_user.id, run_id, data))


@router.post("/{run_id}/advance")
@limiter.limit("120/minute")
def advance_import(request: Request, run_id: UUID, current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    workflow = ImportWorkflow(db)
    def advance():
        phase = workflow.status(current_user.id, run_id)["phase"]
        return workflow.advance_apply(current_user.id, run_id) if phase in ("applying", "completed", "completed_with_issues") else workflow.advance_analysis(current_user.id, run_id)
    return _execute(db, advance)


@router.patch("/{run_id}/rows/{ordinal}")
@limiter.limit("60/minute")
def decide_import(request: Request, run_id: UUID, ordinal: int, data: ImportDecision,
                  current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    return _execute(db, lambda: ImportWorkflow(db).decide(current_user.id, run_id, ordinal, data))


@router.post("/{run_id}/confirm")
@limiter.limit("30/minute")
def confirm_import(request: Request, run_id: UUID, data: ConfirmImport,
                   current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    return _execute(db, lambda: ImportWorkflow(db).confirm(current_user.id, run_id, data))


@router.post("/{run_id}/cancel")
@limiter.limit("30/minute")
def cancel_import(request: Request, run_id: UUID, current_user: User = Depends(import_user), db: Session = Depends(get_db)):
    return _execute(db, lambda: ImportWorkflow(db).cancel(current_user.id, run_id))
