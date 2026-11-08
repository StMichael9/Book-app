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
    r"\s*[-:,–—]?\s*\(?\b(annotated|illustrated|unabridged|abridged|deluxe|special|collector'?s|anniversary|centenary|"
    r"large\s+print|enhanced|complete\s+and\s+unabridged|omnibus|new|revised|updated|classic|original|authorized)"
    r"(\s+edition)?\)?\s*$", re.IGNORECASE)
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
        if stripped_author or not DERIVATIVE.search(value):
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


def clean_description(text: str | None) -> str | None:
    """English prose only, without edition or seller sentences; None when nothing usable is left."""
    value = " ".join((text or "").replace("\r", "\n").split(" ")).strip()
    if not value:
        return None
    cut = _TRAILER.search(value)
    if cut:
        value = value[:cut.start()]
    value = re.sub(r"<[^>]+>", " ", value)
    kept = [s for s in _SENTENCE.split(" ".join(value.split())) if s.strip() and not SELLER.search(s)]
    result = " ".join(kept).strip()
    if len(result) < 25 or not is_english(result):
        return None
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
    points += 15 if description and clean_description(description) == " ".join(description.split()) else 0
    points += 5 if popularity is not None else 0
    points += 5 if genres > 0 else 0
    return min(points, 40) if derivative else points
