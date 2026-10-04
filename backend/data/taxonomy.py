"""Reviewed deterministic category, tag, mood, and theme mapping."""
from __future__ import annotations

import re

SUBJECT_ALIASES: dict[str, tuple[str, ...]] = {
    "fantasy": ("fantasy", "fantasy fiction"),
    "mystery": ("mystery", "mystery fiction", "detective and mystery stories"),
    "horror": ("horror", "horror stories"),
    "romance": ("romance", "romance fiction", "love stories"),
    "science_fiction": ("science fiction", "science-fiction"),
    "thriller": ("thriller", "thrillers", "suspense fiction"),
    "biography": ("biography", "biographies"),
    "poetry": ("poetry", "poems"),
    "history": ("history", "historical fiction"),
    "drama": ("drama", "plays"),
    "adventure": ("adventure", "adventure stories"),
    "humor": ("humor", "humour", "humorous stories"),
    "classics": ("classics", "classic literature"),
    "young_adult": ("young adult", "young adult fiction"),
    "philosophy": ("philosophy",),
    "science": ("science", "popular science"),
    "technology": ("technology", "computers", "computer science"),
    "business": ("business", "management"),
    "art": ("art", "arts"),
    "music": ("music",),
    "cooking": ("cooking", "cookbooks", "cookery"),
    "travel": ("travel", "travel writing"),
    "health": ("health", "medicine"),
    "nature": ("nature", "natural history"),
    "sports": ("sports", "sport"),
    "psychology": ("psychology",),
    "religion": ("religion", "religions"),
    "politics": ("politics", "political science"),
    "education": ("education",),
}

CATEGORY_TYPES = {
    **{name: "genre" for name in (
        "fantasy", "mystery", "horror", "romance", "science_fiction", "thriller",
        "biography", "adventure", "humor", "classics",
    )},
    "poetry": "form", "drama": "form", "young_adult": "audience",
    **{name: "topic" for name in (
        "history", "philosophy", "science", "technology", "business", "art", "music",
        "cooking", "travel", "health", "nature", "sports", "psychology", "religion",
        "politics", "education",
    )},
}

MOOD_THEME_ALIASES = {
    "Friendship -- Fiction": ("Friendship", "theme"),
    "Coming of age -- Fiction": ("Coming of age", "theme"),
    "Bildungsromans": ("Coming of age", "theme"),
    "Family life -- Fiction": ("Family", "theme"),
    "Families -- Fiction": ("Family", "theme"),
    "Survival -- Fiction": ("Survival", "theme"),
    "Survival stories": ("Survival", "theme"),
    "Cozy mysteries": ("Cozy", "mood"),
    "Cozy mystery fiction": ("Cozy", "mood"),
    "Humorous stories": ("Humorous", "mood"),
    "Humorous fiction": ("Humorous", "mood"),
    "Suspense fiction": ("Suspenseful", "mood"),
    "Suspense stories": ("Suspenseful", "mood"),
}

def _subject_key(value: str) -> str:
    return re.sub(r"[\s_-]+", " ", value.casefold()).strip()

def subject_map() -> dict[str, str]:
    return {_subject_key(alias): label for label, aliases in SUBJECT_ALIASES.items() for alias in aliases}

SUBJECT_MAP = subject_map()
MOOD_THEME_MAP = {_subject_key(alias): target for alias, target in MOOD_THEME_ALIASES.items()}
