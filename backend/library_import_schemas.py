"""Strict, bounded private-import request contracts. Raw CSV never reaches disk."""
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictStr, model_validator

Cell = Annotated[StrictStr, Field(max_length=65536)]
Cells = Annotated[list[Cell], Field(min_length=1, max_length=128)]


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InspectImport(ImportRequest):
    headers: list[Annotated[StrictStr, Field(max_length=200)]] = Field(min_length=1, max_length=128)
    mapping: dict[str, Annotated[int, Field(strict=True, ge=0, le=127)]] | None = None


class StartImport(InspectImport):
    id: UUID
    scope: Annotated[StrictStr, Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")] = "default"
    source: Literal["auto", "paste"] = "auto"
    encoding: Literal["UTF-8", "windows-1252"] = "UTF-8"
    status_map: dict[Annotated[StrictStr, Field(max_length=120)], Literal["", "want", "reading", "paused", "finished", "dnf"]] = Field(default_factory=dict, max_length=100)


class UploadImportBatch(ImportRequest):
    rows: list[Cells] = Field(min_length=1, max_length=100)


class FinalizeImport(ImportRequest):
    row_count: int = Field(strict=True, ge=1, le=20000)
    batch_count: int = Field(strict=True, ge=1, le=20000)
    manifest_hash: Annotated[StrictStr, Field(pattern=r"^[0-9a-f]{64}$")]


class ImportDecision(ImportRequest):
    expected_revision: int = Field(strict=True, ge=1)
    action: Literal["match", "private", "skip", "preserve"]
    book_id: int | None = Field(default=None, strict=True, ge=1)
    entry_id: int | None = Field(default=None, strict=True, ge=1)
    history_policy: Literal["preserve", "add", "context_only"] = "preserve"
    accept_source_update: bool = Field(default=False, strict=True)

    @model_validator(mode="after")
    def target(self):
        if self.action == "match" and ((self.book_id is None) == (self.entry_id is None)):
            raise ValueError("Select exactly one target")
        if self.action != "match" and (self.book_id is not None or self.entry_id is not None):
            raise ValueError("Only match decisions take a target")
        return self


class ConfirmImport(ImportRequest):
    expected_revision: int = Field(strict=True, ge=1)
    manifest_hash: Annotated[StrictStr, Field(pattern=r"^[0-9a-f]{64}$")]
    approve_private: bool = Field(strict=True)
    skip_unresolved: bool = Field(strict=True)
    accept_warnings: bool = Field(default=False, strict=True)


class ForgetImportMarkers(ImportRequest):
    confirmed: bool = Field(strict=True)

    @model_validator(mode="after")
    def explicit_confirmation(self):
        if self.confirmed is not True:
            raise ValueError("Explicit confirmation required")
        return self
