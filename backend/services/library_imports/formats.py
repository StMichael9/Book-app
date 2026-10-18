"""Version-one source adapters. Pure functions: no network, database or logging.

CSV syntax belongs to the browser parser; these adapters accept lossless string
cells. Unsupported or ambiguous values are disclosed, never silently inferred.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import date
from decimal import Decimal, InvalidOperation
from uuid import UUID

from data.clean import isbn13, isbn10_to_13, work_key

ADAPTER_VERSION = 1
FIELDS = (
    "record_id", "title", "author", "isbn13", "isbn10", "work_source_id",
    "status", "owned", "wanted", "date_added", "started_on", "finished_on",
    "attempt_id", "rating", "review", "private_note", "labels", "format",
    "page_count", "read_count", "dates_read", "version", "csv_escaped_fields",
)
BOOKVANE_HEADERS = tuple(field for field in FIELDS if field not in ("read_count", "dates_read"))
GOODREADS = {
    "record_id": "Book Id", "title": "Title", "author": "Author",
    "isbn13": "ISBN13", "isbn10": "ISBN", "status": "Exclusive Shelf",
    "owned": "Owned Copies", "date_added": "Date Added", "finished_on": "Date Read",
    "rating": "My Rating", "review": "My Review", "private_note": "Private Notes",
    "labels": "Bookshelves", "format": "Binding", "page_count": "Number of Pages",
    "read_count": "Read Count",
}
STORYGRAPH = {
    "title": "Title", "author": "Authors", "record_id": "ISBN/UID", "isbn13": "ISBN/UID",
    "status": "Read Status", "owned": "Owned?", "date_added": "Date Added",
    "finished_on": "Last Date Read", "dates_read": "Dates Read", "read_count": "Read Count",
    "rating": "Star Rating", "review": "Review", "labels": "Tags", "format": "Format",
}
STORY_CONTEXT = (
    "Contributors", "Moods", "Pace", "Character- or Plot-Driven?",
    "Strong Character Development?", "Loveable Characters?", "Diverse Characters?",
    "Flawed Characters?", "Content Warnings", "Content Warning Description",
)
ALIASES = {
    "title": ("title", "book title"), "author": ("author", "authors"),
    "isbn13": ("isbn", "isbn13", "isbn 13"), "isbn10": ("isbn10", "isbn 10"),
    "status": ("status", "reading status", "read status"),
    "owned": ("owned", "own", "owned?"), "wanted": ("wanted", "want"),
    "started_on": ("started on", "date started", "start date", "started_on"),
    "finished_on": ("finished on", "date read", "end date", "finished_on"),
    **{field: (field, field.replace("_", " ")) for field in FIELDS
       if field not in ("title", "author", "isbn13", "isbn10", "status", "owned", "wanted", "started_on", "finished_on")},
}
STATUSES = {
    "to-read": "want", "to read": "want", "want": "want", "want to read": "want",
    "currently-reading": "reading", "currently reading": "reading", "reading": "reading",
    "paused": "paused", "read": "finished", "finished": "finished",
    "did-not-finish": "dnf", "did not finish": "dnf", "dnf": "dnf",
}


class FormatError(ValueError):
    """Stable, non-sensitive error code suitable for a response."""


def canonical(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).split()).casefold()


def digest(value: object) -> str:
    try:
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    except UnicodeError:
        raise FormatError("invalid_encoding") from None
    return hashlib.sha256(encoded).hexdigest()


def size(value: object) -> int:
    try:
        return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    except UnicodeError:
        raise FormatError("invalid_encoding") from None


def staged_size(*values: object) -> int:
    # PostgreSQL jsonb::text uses spaces after separators. Count full normalized
    # payload AND preview metadata; physical table/index headroom is separate.
    try:
        return sum(len(json.dumps(value, ensure_ascii=False).encode("utf-8")) for value in values)
    except UnicodeError:
        raise FormatError("invalid_encoding") from None


def inspect_headers(headers: list[str], supplied: dict[str, int] | None = None) -> dict:
    if not headers or len(headers) > 128:
        raise FormatError("invalid_columns")
    keys = [canonical(header.lstrip("\ufeff") if index == 0 else header) for index, header in enumerate(headers)]
    if any(not key or "\x00" in key or len(key) > 200 for key in keys) or len(set(keys)) != len(keys):
        raise FormatError("duplicate_or_invalid_headers")
    source = "generic"
    if {canonical(GOODREADS[key]) for key in ("record_id", "title", "author", "status")} <= set(keys):
        source, aliases = "goodreads", GOODREADS
    elif {canonical(STORYGRAPH[key]) for key in ("title", "author", "record_id", "status")} <= set(keys):
        source, aliases = "storygraph", STORYGRAPH
    elif "version" in keys and "record_id" in keys and "title" in keys:
        source, aliases = "bookvane", {key: key for key in FIELDS}
    else:
        aliases = None
    mapping, ambiguous = {}, {}
    for field in FIELDS:
        choices = [canonical(aliases[field])] if aliases and field in aliases else ([] if aliases else ALIASES[field])
        indices = [index for index, key in enumerate(keys) if key in choices]
        if len(indices) == 1:
            mapping[field] = indices[0]
        elif len(indices) > 1:
            ambiguous[field] = indices
    if supplied is not None:
        for field, index in supplied.items():
            if field not in FIELDS or type(index) is not int or not 0 <= index < len(headers):
                raise FormatError("invalid_column_mapping")
        mapping.update(supplied)
        ambiguous = {field: value for field, value in ambiguous.items() if field not in supplied}
    used = set(mapping.values())
    # A single cell may supply the StoryGraph opaque UID and validated ISBN only.
    reverse = {}
    for field, index in mapping.items():
        reverse.setdefault(index, set()).add(field)
    if any(len(fields) > 1 and not (source == "storygraph" and fields == {"record_id", "isbn13"}) for fields in reverse.values()):
        raise FormatError("overlapping_column_mapping")
    return {"source": source, "adapter_version": ADAPTER_VERSION, "mapping": mapping,
            "ambiguous": ambiguous, "missing_identity": not any(key in mapping for key in ("title", "isbn13", "isbn10")),
            "ignored_columns": [headers[index] for index in range(len(headers)) if index not in used and not (source == "storygraph" and headers[index] in STORY_CONTEXT)]}


def _cell(value: str) -> str:
    if type(value) is not str or "\x00" in value or len(value.encode("utf-8")) > 65536:
        raise FormatError("invalid_or_oversized_field")
    if any(ord(char) < 32 and char not in "\t\r\n" for char in value):
        raise FormatError("binary_content")
    return value


def _date(value: str, platform: bool, warnings: list[str], field: str) -> str | None:
    if not value:
        return None
    candidate = value.replace("/", "-") if platform and re.fullmatch(r"\d{4}/\d{2}/\d{2}", value) else value
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", candidate):
            raise ValueError
        return date.fromisoformat(candidate).isoformat()
    except ValueError:
        warnings.append(f"unparsed_{field}")
        return None


def _bool(value: str, warnings: list[str], field: str) -> bool | None:
    if not value:
        return None
    key = canonical(value)
    if key in ("yes", "true", "1"):
        return True
    if key in ("no", "false", "0"):
        return False
    warnings.append(f"unrecognized_{field}")
    return None


def normalize_row(source: str, headers: list[str], mapping: dict[str, int], cells: list[str], *, status_map: dict[str, str] | None = None) -> dict:
    if source not in ("goodreads", "storygraph", "bookvane", "generic", "paste"):
        raise FormatError("unsupported_source")
    if len(cells) != len(headers) or len(cells) > 128 or size(cells) > 262144:
        raise FormatError("invalid_or_oversized_row")
    checked = [_cell(cell) for cell in cells]
    raw = {field: (checked[index] if field in ("review", "private_note") else checked[index].strip())
           for field, index in mapping.items() if checked[index].strip()}
    if source == "bookvane" and raw.get("version") not in (None, "1"):
        raise FormatError("unsupported_bookvane_version")
    if source == "bookvane" and raw.get("csv_escaped_fields"):
        try:
            escaped = json.loads(raw["csv_escaped_fields"])
        except ValueError:
            raise FormatError("invalid_csv_escape_metadata") from None
        if type(escaped) is not list or len(escaped) > len(FIELDS) or any(type(field) is not str or field not in FIELDS or field == "csv_escaped_fields" for field in escaped):
            raise FormatError("invalid_csv_escape_metadata")
        for field in escaped:
            value = raw.get(field, "")
            if not value.startswith("'") or len(value) < 2 or not (value[1] in "=+-@\t\r\n" or value[1:].lstrip(" \t\r\n").startswith(("=", "+", "-", "@"))):
                raise FormatError("invalid_csv_escape_metadata")
            raw[field] = value[1:]
    title, author = raw.get("title", ""), raw.get("author", "")
    if len(title) > 500 or len(author) > 500:
        raise FormatError("identity_too_long")
    warnings = []
    valid_isbns = set()
    for field in ("isbn13", "isbn10"):
        value = raw.get(field, "")
        if source == "goodreads" and re.fullmatch(r'="[^"\r\n]*"', value):
            value = value[2:-1]
        if value:
            valid = isbn13(value) or isbn10_to_13(value)
            if valid:
                valid_isbns.add(valid)
            elif not (source == "storygraph" and field == "isbn13"):
                warnings.append("invalid_isbn")
    if not title and not valid_isbns:
        raise FormatError("missing_identity")
    work = work_key(raw.get("work_source_id"))
    if raw.get("work_source_id") and not work:
        warnings.append("invalid_work_key")
    source_status = canonical(raw.get("status", ""))
    status = STATUSES.get(source_status)
    if status_map and source_status in status_map:
        status = status_map[source_status] or None
        if status not in (None, "want", "reading", "paused", "finished", "dnf"):
            raise FormatError("invalid_status_mapping")
    if source_status and status is None:
        warnings.append("unmapped_status")
    owned = _bool(raw.get("owned", ""), warnings, "owned")
    if source == "goodreads" and raw.get("owned", "").isdigit():
        if len(raw["owned"]) > 6:
            warnings.append("invalid_owned_count")
            owned = None
        else:
            owned = int(raw["owned"]) > 0
            warnings = [item for item in warnings if item != "unrecognized_owned"]
    wanted = _bool(raw.get("wanted", ""), warnings, "wanted")
    if status == "want":
        if wanted is False:
            warnings.append("conflicting_want")
        else:
            wanted = True
    platform = source in ("goodreads", "storygraph")
    started = _date(raw.get("started_on", ""), platform, warnings, "started_on")
    ended = _date(raw.get("finished_on", ""), platform, warnings, "finished_on")
    if started and ended and ended < started:
        warnings.append("inverted_dates")
        started = ended = None
    if status not in ("finished", "dnf") and ended:
        warnings.append("end_date_without_terminal_status")
        ended = None
    rating = None
    if raw.get("rating"):
        try:
            value = Decimal(raw["rating"])
            if not value.is_finite() or not 0 <= value <= 5 or value.as_tuple().exponent < -2:
                raise InvalidOperation
            rating = None if source == "goodreads" and value == 0 else str(value)
        except InvalidOperation:
            warnings.append("invalid_rating")
    labels = []
    if raw.get("labels"):
        if source in ("bookvane", "generic", "paste"):
            # JSON list syntax is unambiguous for commas, semicolons and quotes.
            try:
                labels = json.loads(raw["labels"])
            except (ValueError, TypeError):
                warnings.append("unparsed_labels")
        else:
            labels = [label.strip() for label in raw["labels"].split(",") if label.strip()]
        if type(labels) is not list or len(labels) > 100 or any(type(label) is not str or not label.strip() or len(label) > 120 for label in labels):
            raise FormatError("invalid_or_oversized_labels")
        labels = list(dict.fromkeys(labels))
    context = {key: value for key, value in raw.items() if key not in ("title", "author", "record_id", "version", "attempt_id", "csv_escaped_fields")}
    context.update({"rating": rating, "rating_scale": "5", "labels": labels})
    if raw.get("rating"):
        context["reported_rating"] = raw["rating"]
    if raw.get("labels"):
        context["reported_labels"] = raw["labels"]
    if source == "storygraph":
        context["platform"] = {header: checked[index] for index, header in enumerate(headers) if header in STORY_CONTEXT and checked[index]}
        # The observed native fixture has empty date lists. Preserve unfamiliar
        # lists, do not invent a grammar or lose their source information.
        if raw.get("dates_read"):
            warnings.append("dates_read_requires_review")
    count = raw.get("read_count")
    if count and (not count.isdigit() or len(count) > 6):
        warnings.append("invalid_read_count")
    elif count and int(count) > (1 if status in ("finished", "dnf") else 0):
        warnings.append("incomplete_read_history")
    pages = raw.get("page_count", "")
    page_count = int(pages) if pages.isdigit() and len(pages) < 7 and 0 < int(pages) <= 100000 else None
    if pages and page_count is None:
        warnings.append("invalid_page_count")
    event = None
    if status in ("reading", "paused", "finished", "dnf"):
        event_format = raw.get("format")
        if event_format and len(event_format) > 200:
            warnings.append("oversized_edition_format")
            event_format = None
        event = {"state": status, "started_on": started, "ended_on": ended, "total_pages": page_count, "format": event_format}
        event["key"] = digest({"id": raw["attempt_id"]}) if raw.get("attempt_id") else digest({key: event[key] for key in ("state", "started_on", "ended_on")})
        if source == "bookvane" and raw.get("attempt_id", "").startswith("bv-attempt-"):
            try:
                event["native_attempt_id"] = str(UUID(raw["attempt_id"][11:]))
            except ValueError:
                warnings.append("invalid_bookvane_attempt_id")
    identity = raw.get("record_id")
    # Weak keys combine bibliographic fields, not ISBN alone: different source
    # records/editions may repeat an identifier. Collisions are reviewed later.
    record_key = digest({"id": identity}) if identity else digest({"title": canonical(title), "author": canonical(author), "isbns": sorted(valid_isbns)})
    result = {"title": title, "author": author, "isbns": sorted(valid_isbns), "work_source_id": work,
              "record_key": record_key, "strong_key": bool(identity), "status": status,
              "is_owned": owned, "is_wanted": wanted, "events": [event] if event else [],
              "context": context, "warnings": list(dict.fromkeys(warnings))}
    if source == "bookvane" and identity and re.fullmatch(r"bv-entry-[1-9][0-9]{0,9}", identity):
        result["native_entry_id"] = int(identity[9:])
    if staged_size(result) > 262144:
        raise FormatError("normalized_row_too_large")
    return result


def paste_rows(value: str) -> tuple[list[str], list[list[str]]]:
    if not isinstance(value, str) or len(value.encode("utf-8")) > 512 * 1024 or "\x00" in value:
        raise FormatError("paste_too_large_or_invalid")
    lines = [line.strip() for line in value.splitlines() if line.strip()]
    if not lines or len(lines) > 1000:
        raise FormatError("paste_line_limit")
    rows = []
    for line in lines:
        valid = isbn13(line) or isbn10_to_13(line)
        if valid:
            rows.append(["", "", valid])
        elif "\t" in line or " — " in line:
            separator = "\t" if "\t" in line else " — "
            if line.count(separator) != 1:
                raise FormatError("ambiguous_paste_separator")
            title, author = line.split(separator)
            rows.append([title.strip(), author.strip(), ""])
        else:
            # Ordinary title hyphens are never assumed to divide author/title.
            rows.append([line, "", ""])
    return ["title", "author", "isbn13"], rows
