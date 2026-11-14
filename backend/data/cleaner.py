"""The book cleaner (T47): one set of pure rules for authors, titles and descriptions, and a 0-100 quality score.

Open Library merges many editions into one "work", and its author and description fields carry that mess (thirty "authors",
a Spanish publisher's blurb on an English book). Everything here is a pure function of the text it is given, so the same rules
serve the October merge, the gate that vets every new book, and the one-off re-clean of the books we already hold.
Nothing here reads or writes the database.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter

MAX_AUTHORS = 3
LISTING_THRESHOLD = 60
CONSENSUS = 0.5

# Words that mark a name as a publisher, brand or account rather than a person.
PUBLISHER_WORDS = frozenset({
    "ink", "press", "books", "book", "publishing", "publishers", "publisher", "classics", "read", "reads", "reader", "library",
    "libraries", "editions", "edition", "creative", "writing", "studio", "studios", "media", "group", "company", "inc", "ltd",
    "llc", "gutenberg", "team", "www", "com", "org", "net", "pub", "house", "digital", "ebooks", "ebook", "audio", "audiobooks"})
PLACEHOLDER_NAMES = frozenset({"various", "unknown", "anonymous", "n/a", "na", "none", "et al", "others", "multiple authors"})

DERIVATIVE = re.compile(
    r"\b(box(ed)?\s?set|omnibus|anthology|collections?|collected\s+(works|stories|poems|novels|plays)|"
    r"complete\s+(works|novels|stories|poems|plays|collection|series|trilogy|set)|selected\s+(works|stories|poems|writings)|"
    r"novels\s+in\s+one|\d+\s+(books?|novels)\s+(in|set|collection|box)|trilogy(\s+(set|collection|boxed))?|bundle|"
    r"volumes?\s+\d|summary\s+of|study\s+guide|sparknotes|cliffsnotes|workbook\s+for)\b", re.IGNORECASE)
_EDITION_WORDS = re.compile(
    r"\s*[-:,–—]?\s*(?:\(\s*(?:annotated|illustrated|unabridged|abridged|deluxe|special|large\s+print|enhanced)\s*\)|"
    r"\b(?:annotated|illustrated|unabridged|abridged|deluxe|special|collector'?s|anniversary|centenary|large\s+print|enhanced|"
    r"complete\s+and\s+unabridged|new|revised|updated|classic|original|authorized)\s+edition)\s*$", re.IGNORECASE)
_OMNIBUS_TAIL = re.compile(r"\s+omnibus(\s+edition)?\s*$", re.IGNORECASE)
_TRAILING_PAREN = re.compile(r"\s*[\(\[][^)\]]*(edition|classics|library|series|book\s+\d+|#\d+|vol)[^)\]]*[\)\]]\s*$", re.IGNORECASE)
_POSSESSIVE = re.compile(r"^(?P<name>[^'’]{3,60})['’]s\s+(?P<rest>.+)$")

SELLER = re.compile(
    r"\b(e-?books?|kindle|paperback|hard\s?cover|hardback|this\s+(edition|ebook|version|volume|printing)|"
    r"this\s+book\s+is\s+a\s+reproduction|print[- ]on[- ]demand|printing|reprint(ed)?|all\s+rights\s+reserved|public\s+domain|"
    r"translat(ed|or|ion)\s+by|illustrated\s+by|foreword\s+by|introduction\s+by|with\s+an?\s+(introduction|foreword)|"
    r"includes?\s+an?\s+(introduction|foreword|biography)|isbn|buy\s+now|order\s+now|free\s+(shipping|download|sample)|"
    r"formatted\s+for|active\s+table\s+of\s+contents|table\s+of\s+contents|large\s+print|new\s+edition|first\s+published|"
    r"digital\s+edition|e-?reader|cover\s+design|typeset|proofread)\b", re.IGNORECASE)
_TRAILER = re.compile(r"\s--\s|\s*-{3,}|\[source\]|\(\[?source|\r?\n\s*----")
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"“'‘(\[])")
_STOPWORDS = frozenset(
    "the of and a an to in is it that was for on with as his her he she they this by at from be are or but not had have which "
    "who their its into has were been one all when will would there what so up out if about can more than them then also".split())


# --- names ------------------------------------------------------------------------------------------------------------

def _strip_accents(value: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c))


def name_tokens(name: str) -> list[str]:
    return re.findall(r"[^\W_]+", _strip_accents(name).casefold())


def name_key(name: str) -> str:
    return " ".join(name_tokens(name))


def tidy_name(name: str) -> str:
    """One display form: single spaces, no trailing punctuation, proper case for ALL CAPS or all lowercase."""
    value = " ".join(unicodedata.normalize("NFKC", name or "").split()).strip(" ,;:.-_/\\")
    letters = [c for c in value if c.isalpha()]
    if letters and (all(c.isupper() for c in letters) or all(c.islower() for c in letters)):
        value = " ".join(part.capitalize() if len(part) > 1 or not part.isalpha() else part.upper() for part in value.split())
    return value


def looks_like_publisher(name: str) -> bool:
    tokens = name_tokens(name)
    if not tokens or name_key(name) in PLACEHOLDER_NAMES:
        return True
    if any(token in PUBLISHER_WORDS for token in tokens):
        return True
    raw = (name or "").strip()
    if " " not in raw and re.search(r"[a-z][A-Z]", raw):                      # ClassyBookRead: CamelCase, no space
        return any(word in raw.casefold() for word in ("book", "read", "press", "pub", "ink", "media"))
    return bool(re.search(r"\d{2,}|@|https?:|\.com\b", raw))


def _initial_compatible(short: list[str], long: list[str]) -> bool:
    """"J Joyce" / "R L Stevenson" fold into "James Joyce" / "Robert Louis Stevenson": same surname, initials agree."""
    if not short or not long or short[-1] != long[-1] or len(short) > len(long):
        return False
    first_short, first_long = short[:-1], long[:-1]
    if not first_short:
        return False
    if all(len(t) == 1 for t in first_short):
        initials = "".join(t[0] for t in first_long)
        return initials.startswith("".join(first_short)) or "".join(first_short) in initials
    return first_short == first_long[:len(first_short)]


def _distance(a: str, b: str, limit: int = 2) -> int:
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        row = [i]
        for j, cb in enumerate(b, 1):
            row.append(min(previous[j] + 1, row[-1] + 1, previous[j - 1] + (ca != cb)))
        previous = row
    return previous[-1]


def same_person(a: str, b: str) -> bool:
    ta, tb = name_tokens(a), name_tokens(b)
    ka, kb = " ".join(ta), " ".join(tb)
    if not ka or not kb:
        return False
    if ka == kb:
        return True
    short, long = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    if _initial_compatible(short, long):
        return True
    return len(ka) >= 8 and len(kb) >= 8 and _distance(ka, kb) <= 2 and _distance(ta[-1], tb[-1]) <= 2


def clean_authors(names: list[str], support: dict[str, float] | None = None) -> list[str]:
    """The authors of one work: Open Library's first-listed author, plus co-authors only when they are really co-authors.

    `support` maps a name to the share of the work's editions that list it as an author (not translator or illustrator).
    Without it, a work with more than two distinct people after folding variants keeps only its first author.
    Variants fold into one person; publisher- and brand-like names are dropped; at most three are kept.
    """
    people: list[list[str]] = []                        # groups of variant spellings, first-listed group first
    for raw in names or []:
        name = tidy_name(raw)
        if not name or looks_like_publisher(name):
            continue
        for group in people:
            if any(same_person(name, member) for member in group):
                group.append(name)
                break
        else:
            people.append([name])
    if not people:
        return []
    primary, rest = people[0], people[1:]
    if support is not None:
        shared = {name_key(n): v for n, v in support.items()}
        rest = [g for g in rest if max(shared.get(name_key(n), 0.0) for n in g) >= CONSENSUS]
    elif len(people) > 2:
        rest = []                                         # no edition data: co-authors are only believed in pairs
    return [group[0] for group in [primary, *rest]][:MAX_AUTHORS]


# --- titles -----------------------------------------------------------------------------------------------------------

def is_derivative(title: str | None) -> bool:
    return bool(title and DERIVATIVE.search(title))


def clean_title(title: str | None, authors: list[str] | None = None, edition_titles: list[str] | None = None) -> str | None:
    """The title as readers know it: the most common edition title if given, without "Author's", edition words or series tags.

    An omnibus is only stripped of that word when it is "<Author>'s <Work> omnibus" (one work in a big edition); on its own it
    stays and is caught by `is_derivative`.
    """
    if edition_titles:
        counts = Counter(t for t in (clean_title(t, authors) for t in edition_titles) if t and not is_derivative(t))
        if counts:
            title = sorted(counts.items(), key=lambda item: (-item[1], len(item[0]), item[0]))[0][0]
    value = " ".join(unicodedata.normalize("NFKC", title or "").split())
    if not value:
        return None
    possessive = _POSSESSIVE.match(value)
    stripped_author = False
    if possessive and authors:
        owner = set(name_tokens(possessive.group("name")))
        if owner and any(owner <= set(name_tokens(a)) or set(name_tokens(a)) <= owner for a in authors if name_tokens(a)):
            value, stripped_author = possessive.group("rest").strip(), True
    previous = None
    while previous != value:
        previous = value
        value = _TRAILING_PAREN.sub("", value).strip()
        if stripped_author:
            value = _OMNIBUS_TAIL.sub("", value).strip()          # "<Author>'s <Work> omnibus": one work in a large edition
        if not DERIVATIVE.search(value):
            value = _EDITION_WORDS.sub("", value).strip()
        value = value.rstrip(" ,;:-–—")
    return value or None


# --- descriptions -----------------------------------------------------------------------------------------------------

def is_english(text: str) -> bool:
    """A stop-word ratio check (no dependency): English prose is about 40% stop-words, other languages far fewer."""
    words = re.findall(r"[A-Za-z']+", text.casefold())
    letters = sum(c.isalpha() for c in text)
    if letters == 0 or len(words) < 4:
        return False
    ascii_share = sum(c.isascii() for c in text if c.isalpha()) / letters
    return ascii_share >= 0.85 and sum(w in _STOPWORDS for w in words) / len(words) >= 0.2


# --- description: Markdown, paragraphs, sections, credits (T58) ------------------------------------------------------------

_LINK_DEFINITION = re.compile(r"(?m)^[ \t]*\[[^\]\n]+\]:[ \t]*\S+.*$")
_LINK_DEFINITION_TAIL = re.compile(r"\s*\[\w+\]:\s*https?://\S+")          # a definition left inside collapsed text
_OPEN_LIBRARY_URL = re.compile(r"https?://(?:www\.)?openlibrary\.org\S*", re.IGNORECASE)
_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_INLINE_LINK = re.compile(r"\[([^\]]+)\]\([^)\s]*(?:\s+\"[^\"]*\")?\)")
_REFERENCE_LINK = re.compile(r"\[([^\]]+)\]\[[^\]]*\]")
_STARS = re.compile(r"(\*{1,3})(?=\S)(.+?)(?<=\S)\1")
_UNDERSCORES = re.compile(r"(?<!\w)(_{1,3})(?=\S)(.+?)(?<=\S)\1(?!\w)")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s*(.*?)\s*#*\s*$")
_BOLD_LINE = re.compile(r"^\s*(?:\*{1,3}|_{1,3})\s*([^*_\n]{2,60}?)\s*:?\s*(?:\*{1,3}|_{1,3})\s*:?\s*$")
_LIST_ITEM = re.compile(r"^\s*(?:[-*+]|\d{1,3}[.)])\s+(.*)$")
_SERIES_LINE = re.compile(r"^\s*(?:\*{1,3}|_{1,3})?\s*(?:followed|preceded)\s+by\b", re.IGNORECASE)

KEEP_SECTIONS = frozenset({"plot", "summary", "synopsis", "plot summary", "plot overview", "book summary", "story summary",
                           "about the book", "about this book"})
DROP_SECTIONS = frozenset({
    "characters", "key characters", "main characters", "major characters", "list of characters", "character list", "themes",
    "major themes", "awards", "awards and recognition", "awards and honors", "awards and honours", "awards and nominations",
    "reception", "critical reception", "adaptations", "adaptation", "film adaptation", "see also", "contents",
    "table of contents", "followed by", "preceded by", "series", "editions", "publication history", "references",
    "external links", "further reading", "sequels", "legacy", "notes"})

_CREDIT_HEAD = re.compile(
    r"^(?:(?:written|edited|translated|illustrated|retold|adapted|compiled|abridged|introduced|annotated|selected|narrated)"
    r"(?:\s*,\s*|\s+and\s+|\s*&\s*)?)+\s+(?:from\s+(?:the\s+)?[A-Z][\w-]*(?:\s+and\s+[A-Z][\w-]*)?\s+)?by\b(?P<rest>.*)$",
    re.IGNORECASE)
_CREDIT_NOTES = re.compile(
    r"^(?:with\s+)?(?:an?\s+)?(?:notes?|introduction|foreword|afterword|bibliography|commentary|glossary|chronology|illustrations?|revised|"
    r"appendi(?:x|ces)|index)\b(?P<rest>.*)$", re.IGNORECASE)
_TRANSLATION_OF = re.compile(r"^translation\s+(?:of|from)\b.{0,120}$", re.IGNORECASE)
_CREDIT_WORDS = frozenset(
    "and & with by the a an of de van von der den la le du da di del y e notes note introduction foreword afterword bibliography "
    "filmography discography commentary glossary chronology appendix appendices index illustrations essays criticism sources "
    "edited written translated illustrated revised in collaboration".split())


def _credit_clause(value: str) -> bool:
    value = value.strip().strip("\"“”'‘’ ").strip()
    if not value:
        return False
    if _TRANSLATION_OF.match(value):
        return True
    head = _CREDIT_HEAD.match(value)
    match = head or _CREDIT_NOTES.match(value)
    if not match:
        return False
    tokens = [t.strip(".,;:()\"“”'") for t in re.findall(r"[^\s;,]+", match.group("rest"))]
    tokens = [t for t in tokens if t]
    if (not tokens and head) or len(tokens) > 30:
        return False
    return all(t[0].isupper() or t[0].isdigit() or t.lower() in _CREDIT_WORDS for t in tokens)


def _credit(sentence: str) -> bool:
    """A statement of responsibility: every ";" clause is one ("Written and edited by Leonard Wolf ; notes, bibliography, and
    filmography revised in collaboration with Roxana Stuart ; illustrations by Christopher Bing", "Translation of: …")."""
    clauses = [clause for clause in re.split(r"\s*;\s*", sentence.strip()) if clause.strip()]
    return bool(clauses) and all(_credit_clause(clause) for clause in clauses)


def _section_key(title: str) -> str:
    return re.sub(r"[^a-z ]", "", re.sub(r"[*_#:]", "", title).lower()).strip()


def _heading(line: str) -> str | None:
    match = _HEADING.match(line)
    if match:
        return match.group(1)
    match = _BOLD_LINE.match(line)
    if match and _section_key(match.group(1)) in KEEP_SECTIONS | DROP_SECTIONS:
        return match.group(1)
    return None


def _trim_sections(lines: list[str]) -> list[str]:
    """With headed sections, keep the intro and the plot or summary; drop characters, themes, awards and the rest."""
    sections: list[tuple[str | None, list[str]]] = [(None, [])]
    for line in lines:
        title = _heading(line)
        if title is None:
            sections[-1][1].append(line)
        else:
            sections.append((_section_key(title), []))
    if len(sections) == 1:
        return lines
    kept = [body for key, body in sections if key is None or key in KEEP_SECTIONS]
    if not any("".join(body).strip() for body in kept):
        kept = [body for key, body in sections if key is None or key not in DROP_SECTIONS]
    result: list[str] = []
    for body in kept:
        result += body + [""]
    return result


def markdown_to_text(value: str) -> str:
    """Open Library descriptions are often Markdown: keep the words, drop the markup. Paragraphs stay as blank-line gaps and
    list items as their own lines."""
    value = _LINK_DEFINITION.sub("", value)
    value = _LINK_DEFINITION_TAIL.sub("", value)
    value = _IMAGE.sub(r"\1", value)
    value = _INLINE_LINK.sub(r"\1", value)
    value = _REFERENCE_LINK.sub(r"\1", value)
    for _ in range(2):
        value = _STARS.sub(r"\2", value)
        value = _UNDERSCORES.sub(r"\2", value)
    value = _OPEN_LIBRARY_URL.sub("", value)
    return value


def description_blocks(value: str) -> list[tuple[str, str]]:
    """Plain-text blocks [("p" | "li", text)] of one description after section and series-line handling."""
    lines = _trim_sections(value.replace("\r\n", "\n").replace("\r", "\n").split("\n"))
    blocks: list[tuple[str, str]] = []
    paragraph: list[str] = []

    def close():
        if paragraph:
            blocks.append(("p", " ".join(" ".join(paragraph).split())))
            paragraph.clear()

    for line in lines:
        if _SERIES_LINE.match(line):
            continue
        if not line.strip():
            close()
            continue
        item = _LIST_ITEM.match(line)
        if item:
            close()
            if item.group(1).strip():
                blocks.append(("li", " ".join(item.group(1).split())))
        else:
            paragraph.append(line.strip())
    close()
    return blocks


def clean_description(text: str | None) -> str | None:
    """English prose only, without markup, edition, seller or credit text, keeping paragraphs (blank line) and list lines;
    None when nothing usable is left."""
    value = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    if not value.strip():
        return None
    cut = _TRAILER.search(value)
    if cut:
        value = value[:cut.start()]
    value = re.sub(r"<[^>]+>", " ", value)
    parts: list[tuple[str, str]] = []
    for kind, block in description_blocks(value):
        kept = " ".join(s for s in _SENTENCE.split(" ".join(markdown_to_text(block).split())) if s.strip() and not SELLER.search(s)
                        and not _credit(s)).strip()
        if kept:
            parts.append((kind, kept))
    result = ""
    for index, (kind, block) in enumerate(parts):
        result += block if index == 0 else ("\n" if kind == "li" and parts[index - 1][0] == "li" else "\n\n") + block
    flat = " ".join(result.split())
    if len(flat) < 5 or (len(flat.split()) >= 8 and not is_english(flat)):
        return None       # too short to judge the language: kept (unless it was seller text, removed above)
    return result


# --- quality ----------------------------------------------------------------------------------------------------------

def quality_score(*, title: str | None, authors: list[str], description: str | None, cover: str | None, pages: int | None,
                  year: int | None, popularity: float | None = None, genres: int = 0) -> int:
    """0-100. Below LISTING_THRESHOLD a book is unlisted (never deleted) until it is fixed. A derivative title caps at 40."""
    points = 0
    derivative = is_derivative(title)
    if title and not derivative and clean_title(title, authors) == " ".join(title.split()):
        points += 15
    if 1 <= len(authors) <= MAX_AUTHORS and not any(looks_like_publisher(a) for a in authors):
        points += 20
    points += 20 if cover else 0
    points += 10 if pages else 0
    points += 10 if year else 0
    points += 15 if description and " ".join((clean_description(description) or "").split()) == " ".join(description.split()) else 0
    points += 5 if popularity is not None else 0
    points += 5 if genres > 0 else 0
    return min(points, 40) if derivative else points
