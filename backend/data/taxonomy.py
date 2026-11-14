"""The one genre list (T46): 28 genres defined once, the Open Library subjects that map to each, and mood/theme tags.

Everything that shows or assigns a genre reads this module: the importer, the gate (`promote`), the `GET /genres` endpoint
that feeds the UI's single genre picker, and the migration that renames the old tags. Moods and themes stay as tags and never
appear in the genre picker.

A book gets a genre from ONE exact alias (a subject that is exactly a strong alias) or from TWO partial hits (two different
subjects that each contain one of the genre's keywords as a whole word). Noisy bare subjects are weak (one hit in all, never alone),
and a fiction book needs a strong exact alias behind a nonfiction genre (T57).
"""
from __future__ import annotations

import re

# key (the tag name), label, group
GENRES: tuple[tuple[str, str, str], ...] = (
    ("fantasy", "Fantasy", "fiction"),
    ("science_fiction", "Science fiction", "fiction"),
    ("mystery_crime", "Mystery & crime", "fiction"),
    ("thriller", "Thriller", "fiction"),
    ("horror", "Horror", "fiction"),
    ("romance", "Romance", "fiction"),
    ("historical_fiction", "Historical fiction", "fiction"),
    ("literary_fiction", "Literary fiction", "fiction"),
    ("classics", "Classics", "fiction"),
    ("young_adult", "Young adult", "fiction"),
    ("childrens", "Children's", "fiction"),
    ("humor", "Humour", "fiction"),
    ("poetry", "Poetry", "fiction"),
    ("drama", "Drama & plays", "fiction"),
    ("short_stories", "Short stories", "fiction"),
    ("graphic_novels", "Graphic novels & comics", "nonfiction"),
    ("biography_memoir", "Biography & memoir", "nonfiction"),
    ("history", "History", "nonfiction"),
    ("science_nature", "Science & nature", "nonfiction"),
    ("business_money", "Business & money", "nonfiction"),
    ("self_help", "Self-help", "nonfiction"),
    ("psychology", "Psychology", "nonfiction"),
    ("philosophy_religion", "Philosophy & religion", "nonfiction"),
    ("christian_faith", "Christian & faith", "nonfiction"),
    ("politics_society", "Politics & society", "nonfiction"),
    ("travel", "Travel", "nonfiction"),
    ("food_cooking", "Food & cooking", "nonfiction"),
    ("art_music", "Art & music", "nonfiction"),
)
GENRE_KEYS = tuple(key for key, _, _ in GENRES)
assert len(GENRES) == 28 and len(set(GENRE_KEYS)) == 28

# Exact aliases: Open Library subject strings (case, punctuation, hyphens and underscores are ignored when matching).
SUBJECT_ALIASES: dict[str, tuple[str, ...]] = {
    "fantasy": ("fantasy", "fantasy fiction", "epic fantasy", "high fantasy", "urban fantasy", "dark fantasy", "magic",
                "wizards", "dragons", "sword and sorcery", "fairy tales", "fantasy fiction, american", "fantasy fiction, english",
                "magic -- fiction", "witches -- fiction", "fantasy romance"),
    "science_fiction": ("science fiction", "science-fiction", "sci-fi", "space opera", "dystopias", "dystopian fiction",
                        "cyberpunk", "time travel", "extraterrestrial beings", "science fiction, american",
                        "science fiction, english", "post-apocalyptic fiction", "interplanetary voyages", "robots -- fiction",
                        "space flight -- fiction", "life on other planets -- fiction", "apocalyptic fiction"),
    "mystery_crime": ("mystery", "mystery fiction", "detective and mystery stories", "detective fiction", "mystery and detective stories",
                      "crime", "crime fiction", "true crime", "murder -- fiction", "private investigators -- fiction",
                      "police -- fiction", "cozy mysteries", "cozy mystery fiction", "noir fiction", "whodunits",
                      "serial murderers -- fiction", "murder", "detective and mystery stories, english",
                      "detective and mystery stories, american"),
    "thriller": ("thriller", "thrillers", "suspense fiction", "suspense", "suspense stories", "psychological thrillers",
                 "spy stories", "espionage", "legal thrillers", "political thrillers", "techno-thrillers",
                 "action and adventure fiction", "adventure stories", "adventure", "conspiracies -- fiction",
                 "terrorism -- fiction", "thrillers (fiction)"),
    "horror": ("horror", "horror stories", "horror fiction", "ghost stories", "supernatural", "vampires", "vampires -- fiction",
               "werewolves", "zombies", "haunted houses", "gothic fiction", "occult fiction", "monsters", "demonology -- fiction"),
    "romance": ("romance", "romance fiction", "love stories", "love stories, american", "love stories, english", "romantic suspense",
                "contemporary romance", "historical romance", "regency romance", "man-woman relationships -- fiction",
                "dating (social customs) -- fiction", "paranormal romance", "erotic fiction", "love -- fiction", "chick lit"),
    "historical_fiction": ("historical fiction", "historical fiction, american", "historical fiction, english", "history -- fiction",
                           "world war, 1939-1945 -- fiction", "world war, 1914-1918 -- fiction",
                           "united states -- history -- fiction", "middle ages -- fiction", "civil war -- fiction",
                           "historical romance fiction", "france -- history -- fiction"),
    "literary_fiction": ("literary fiction", "psychological fiction", "domestic fiction", "family life -- fiction",
                         "families -- fiction", "domestic fiction, american", "bildungsromans", "coming of age -- fiction",
                         "married women -- fiction", "social life and customs -- fiction", "women -- fiction",
                         "fiction, literary", "fiction, psychological", "fiction, family life", "literary"),
    "classics": ("classics", "classic literature", "classic fiction", "classic books", "great books", "fiction, classics",
                 "literary classics", "english fiction -- 19th century", "american fiction -- 19th century",
                 "english literature -- 19th century", "english literature -- early modern, 1500-1700", "greek drama",
                 "latin literature", "russian literature"),
    "young_adult": ("young adult", "young adult fiction", "young adult literature", "teenagers -- fiction",
                    "teenage girls -- fiction", "teenage boys -- fiction", "high schools -- fiction", "schools -- fiction",
                    "teens", "ya", "dystopian young adult fiction", "young adult fiction, american", "teenagers",
                    "adolescence -- fiction"),
    "childrens": ("children's stories", "children's fiction", "children's literature", "juvenile literature", "picture books",
                  "children's books", "children's stories, english", "children's stories, american", "bedtime stories",
                  "fairy tales -- juvenile", "nursery rhymes", "easy readers", "readers (primary)", "children's poetry",
                  "stories in rhyme", "picture books for children", "juvenile works", "children -- fiction", "juvenile fiction"),
    "humor": ("humor", "humour", "humorous stories", "humorous fiction", "comedy", "satire", "wit and humor",
              "american wit and humor", "english wit and humor", "wit and humor, juvenile", "humorous poetry", "parodies",
              "funny stories", "joke books"),
    "poetry": ("poetry", "poems", "english poetry", "american poetry", "poetry (poetic works by one author)", "poetry, american",
               "poetry, english", "love poetry", "haiku", "sonnets", "epic poetry", "verse", "russian poetry", "poetry collections",
               "anthologies (poetry)", "ballads"),
    "drama": ("drama", "plays", "play", "english drama", "american drama", "tragedies", "tragedy", "comedies", "one-act plays",
              "plays -- texts", "stage plays", "greek drama (tragedy)", "drama in english", "dramatic works", "musicals"),
    "short_stories": ("short stories", "short stories, american", "short stories, english", "short story", "short fiction",
                      "american short stories", "english short stories", "short stories, collections",
                      "short stories -- collections", "novellas", "fables", "flash fiction"),
    "graphic_novels": ("graphic novels", "comics & graphic novels", "comic books", "comic books, strips, etc.", "manga", "comics",
                       "graphic novel", "superheroes", "cartoons and comics", "webcomics", "comic strips", "graphic novels, fiction",
                       "manga (comic books)", "comics (graphic works)", "caricatures and cartoons"),
    "biography_memoir": ("biography", "biographies", "autobiography", "memoir", "memoirs", "biography & autobiography",
                         "autobiographies", "personal narratives", "diaries", "biography -- autobiography", "women -- biography",
                         "presidents -- biography", "authors, english -- biography", "authors, american -- biography",
                         "celebrities -- biography", "life stories", "biographies and memoirs", "autobiographical fiction"),
    "history": ("history", "world history", "american history", "european history", "ancient history", "military history",
                "modern history", "history, modern", "history, ancient", "medieval history", "united states -- history",
                "world war, 1939-1945", "world war, 1914-1918", "great britain -- history", "civilization", "wars", "revolutions",
                "history, military", "history, medieval", "middle ages", "slavery -- united states", "social history",
                "church history", "world war, 1939-1945 -- campaigns"),
    "science_nature": ("science", "popular science", "nature", "natural history", "physics", "biology", "chemistry", "astronomy",
                       "mathematics", "evolution", "ecology", "environment", "animals", "technology", "computers", "computer science",
                       "engineering", "medicine", "health", "earth sciences", "cosmology", "genetics", "neuroscience",
                       "climate change", "science -- popular works", "birds", "oceans", "space", "artificial intelligence",
                       "programming (computers)", "mathematics -- popular works", "zoology", "botany", "geology"),
    "business_money": ("business", "management", "economics", "finance", "investing", "entrepreneurship", "marketing", "money",
                       "leadership", "business & economics", "personal finance", "success in business", "accounting", "careers",
                       "small business", "stocks", "real estate", "organizational behavior", "negotiation", "sales", "capitalism",
                       "business enterprises", "corporations", "industrial management", "wealth", "retirement"),
    "self_help": ("self-help", "self help", "self-improvement", "self-actualization", "motivation", "personal development",
                  "habit", "habits", "happiness", "success", "self-help techniques", "conduct of life", "time management",
                  "mindfulness", "stress management", "self-esteem", "self-care", "productivity", "meditation", "decision making",
                  "anxiety", "self-realization", "creative ability", "inspiration", "confidence", "goal setting"),
    "psychology": ("psychology", "psychotherapy", "mental health", "cognitive psychology", "social psychology", "behavior",
                   "psychoanalysis", "personality", "emotions", "child psychology", "human behavior", "cognition", "psychiatry",
                   "developmental psychology", "positive psychology", "behavioral economics", "mind and body",
                   "thought and thinking", "intelligence", "memory", "consciousness", "trauma", "depression"),
    "philosophy_religion": ("philosophy", "religion", "religions", "ethics", "metaphysics", "buddhism", "islam", "judaism",
                            "hinduism", "spirituality", "theology", "stoicism", "existentialism", "philosophy, modern",
                            "philosophy, ancient", "mythology", "atheism", "eastern philosophy", "taoism", "mysticism",
                            "occultism", "logic", "epistemology", "political philosophy", "religion -- philosophy",
                            "comparative religion", "new age movement"),
    "christian_faith": ("christianity", "christian life", "bible", "christian fiction", "christian living", "jesus christ", "prayer",
                        "catholic church", "church", "devotional literature", "faith", "christian biography", "evangelicalism",
                        "christian ethics", "spiritual life -- christianity", "bible -- criticism, interpretation, etc.", "god",
                        "christian theology", "devotional", "christian education", "protestant churches", "christians",
                        "inspirational fiction", "bible stories", "sermons"),
    "politics_society": ("politics", "political science", "politics and government", "sociology", "social science", "society",
                         "government", "democracy", "human rights", "feminism", "race relations", "social conditions", "education",
                         "law", "war", "culture", "poverty", "immigration", "international relations", "journalism", "propaganda",
                         "civil rights", "social problems", "gender", "social classes", "communication", "globalization",
                         "terrorism", "totalitarianism", "political ideologies", "anthropology"),
    "travel": ("travel", "travel writing", "voyages and travels", "description and travel", "adventure and adventurers", "guidebooks",
               "travelers", "tourism", "explorers", "travel -- guidebooks", "voyages around the world", "mountaineering",
               "travel and exploration", "expeditions", "pilgrims and pilgrimages", "trails", "walking", "backpacking"),
    "food_cooking": ("cooking", "cookbooks", "cookery", "food", "recipes", "baking", "nutrition", "diet", "cooking, american",
                     "cookery (vegetarian)", "wine and wine making", "beverages", "desserts", "vegetarian cooking", "food habits",
                     "gastronomy", "cooking, international", "bread", "chefs", "restaurants", "coffee", "tea"),
    "art_music": ("art", "arts", "music", "painting", "photography", "architecture", "design", "art history", "sculpture",
                  "musicians", "composers", "popular music", "jazz", "rock music", "art, modern", "drawing", "film", "cinema",
                  "motion pictures", "dance", "fashion", "performing arts", "visual arts", "artists", "illustration",
                  "art -- history", "classical music", "opera", "art appreciation", "graphic arts", "museums"),
}
assert set(SUBJECT_ALIASES) == set(GENRE_KEYS)

# Partial hits: a subject that contains one of these WHOLE WORDS or phrases (plural -s/-es is allowed; no stems, so "invest" can
# never match "investigators" and "alien" never matches "alienation"). Two different such subjects give the genre.
PARTIAL_KEYWORDS: dict[str, tuple[str, ...]] = {
    "fantasy": ("fantasy", "fantasies", "wizard", "dragon", "fairy", "fairies", "magic", "magical", "sorcery", "sorcerer",
                "elves", "elf", "mythical"),
    "science_fiction": ("science fiction", "sci fi", "dystopia", "dystopian", "alien", "robot", "cyborg", "time travel",
                        "futuristic"),
    "mystery_crime": ("mystery", "mysteries", "detective", "murder", "crime", "private investigator", "whodunit", "sleuth",
                      "police"),
    "thriller": ("thriller", "suspense", "spy", "spies", "espionage", "conspiracy", "conspiracies", "terrorism", "terrorist"),
    "horror": ("horror", "ghost", "vampire", "haunted", "zombie", "occult", "gothic", "supernatural", "monster"),
    "romance": ("romance", "love stories", "love story", "man woman relationships", "dating"),
    "historical_fiction": ("historical fiction", "history fiction", "war fiction"),
    "literary_fiction": ("literary", "psychological fiction", "family life fiction", "domestic fiction"),
    "classics": ("classic", "19th century fiction", "early modern"),
    "young_adult": ("young adult", "teenage", "teenager", "teen", "high school"),
    "childrens": ("children", "juvenile", "picture book", "nursery"),
    "humor": ("humor", "humour", "humorous", "comedy", "funny", "satire", "parody", "parodies"),
    "poetry": ("poetry", "poems", "poet", "verse"),
    "drama": ("drama", "plays", "theatre", "theater", "tragedies"),
    "short_stories": ("short stories", "short story", "short fiction", "novella"),
    "graphic_novels": ("graphic novel", "comic", "manga", "superhero"),
    "biography_memoir": ("biography", "biographies", "biographical", "autobiography", "autobiographies", "autobiographical",
                         "memoir", "personal narrative", "diaries"),
    "history": ("history", "histories", "ancient", "medieval", "empire", "civilization"),
    "science_nature": ("science", "nature", "physics", "biology", "chemistry", "astronomy", "mathematics", "mathematical",
                       "animal", "technology", "computer", "engineering", "medicine", "environment", "environmental"),
    "business_money": ("business", "management", "economics", "finance", "invest", "investing", "investment", "investor",
                       "entrepreneur", "entrepreneurship", "marketing", "leadership"),
    "self_help": ("self help", "self improvement", "personal development", "motivation", "happiness", "habit", "mindfulness"),
    "psychology": ("psychology", "psychological", "psychiatry", "psychiatric", "mental health", "behavior", "therapy"),
    "philosophy_religion": ("philosophy", "philosophical", "religion", "ethics", "buddhism", "buddhist", "islam", "judaism",
                            "hindu", "hinduism", "theology", "theological", "spiritual", "spirituality"),
    "christian_faith": ("christian", "bible", "jesus", "church", "prayer", "devotion", "devotional"),
    "politics_society": ("politics", "political", "government", "sociology", "social science", "human rights", "feminism",
                         "feminist", "democracy", "democracies", "civil rights"),
    "travel": ("travel", "voyage", "guidebook", "tourism", "expedition"),
    "food_cooking": ("cook", "cooking", "cookery", "cookbook", "cuisine", "recipe", "baking", "food", "nutrition", "diet"),
    "art_music": ("music", "painting", "photograph", "photography", "architecture", "musician", "sculpture", "film",
                  "art history"),
}
assert set(PARTIAL_KEYWORDS) == set(GENRE_KEYS)

# Bare subjects that Open Library users add to almost anything (T57): together they count as at most ONE partial hit for a genre,
# never as an exact alias, and never carry a genre without another, non-weak hit. Strong forms ("travel writing", "humorous stories", "picture books"...) stay exact aliases.
WEAK_SUBJECTS = frozenset({"travel", "humor", "humour", "juvenile", "juvenile fiction"})
# Words that mark a book as fiction. A nonfiction genre then needs a strong exact alias behind it, not only partial hits.
FICTION_WORDS = frozenset({"fiction", "novel", "novels", "novella", "novellas", "stories"})
GUARD_EXEMPT = frozenset({"graphic_novels"})  # listed under nonfiction for the picker, but its books are often fiction

CATEGORY_TYPES = {key: "genre" for key in GENRE_KEYS}
MAX_GENRES_PER_BOOK = 3

# Mood and theme tags stay as tags and never appear in the genre picker.
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

# The pre-T46 tags and where each goes (used by the migration). None: the tag stays as a plain, non-picker topic.
OLD_TAGS: dict[str, str | None] = {
    "fantasy": "fantasy", "mystery": "mystery_crime", "horror": "horror", "romance": "romance",
    "science_fiction": "science_fiction", "thriller": "thriller", "biography": "biography_memoir", "poetry": "poetry",
    "history": "history", "historical_fiction": "historical_fiction", "drama": "drama", "adventure": None, "humor": "humor",
    "classics": "classics", "young_adult": "young_adult", "philosophy": "philosophy_religion", "science": "science_nature",
    "technology": "science_nature", "business": "business_money", "art": "art_music", "music": "art_music",
    "cooking": "food_cooking", "travel": "travel", "health": None, "nature": "science_nature", "sports": None,
    "psychology": "psychology", "religion": "philosophy_religion", "politics": "politics_society", "education": None,
}


def _subject_key(value: str) -> str:
    return re.sub(r"[\s_-]+", " ", value.casefold()).strip()


def subject_map() -> dict[str, str]:
    return {_subject_key(alias): label for label, aliases in SUBJECT_ALIASES.items() for alias in aliases}


SUBJECT_MAP = subject_map()
MOOD_THEME_MAP = {_subject_key(alias): target for alias, target in MOOD_THEME_ALIASES.items()}
def _phrase(words) -> re.Pattern:
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(re.escape(word) for word in sorted(words, key=len, reverse=True))
                      + r")(?:s|es)?(?![a-z0-9])")


_PARTIAL = {key: _phrase(_subject_key(word) for word in words) for key, words in PARTIAL_KEYWORDS.items()}
STRONG_MAP = {key: genre for key, genre in SUBJECT_MAP.items() if key not in WEAK_SUBJECTS}
_NONFICTION = {key for key, _, group in GENRES if group == "nonfiction"} - GUARD_EXEMPT


def _is_fiction(key: str) -> bool:
    key = re.sub(r"\bnon fiction\b", " ", key)
    return "graphic novel" not in key and "bible" not in key and any(word in FICTION_WORDS for word in key.split())


def genres_for_subjects(subjects, mapping: dict[str, str] | None = None) -> list[str]:
    """The genres of one book from its Open Library subjects: a genre needs one strong exact alias or two partial hits
    (whole words only). Bare noisy subjects (WEAK_SUBJECTS) add at most one hit per genre between them and never carry a genre
    alone: it also needs one non-weak partial hit. On a fiction book a nonfiction genre needs a strong exact alias, partial
    hits are not enough. Best-supported first (an exact alias counts double), at most three. A custom `mapping` (tests,
    reviewed overrides) is exact-only."""
    exact_map = STRONG_MAP if mapping is None else mapping
    keys = list(dict.fromkeys(_subject_key(item) for item in subjects or [] if isinstance(item, str)))
    score: dict[str, int] = {}
    exact: set[str] = set()
    for key in keys:
        if key in exact_map:
            score[exact_map[key]] = score.get(exact_map[key], 0) + 2
            exact.add(exact_map[key])
    if mapping is None:
        strong: dict[str, set] = {}
        weak_genres: set[str] = set()
        for key in keys:
            for genre, pattern in _PARTIAL.items():
                if pattern.search(key):
                    if key in WEAK_SUBJECTS:
                        weak_genres.add(genre)
                    else:
                        strong.setdefault(genre, set()).add(key)
        for genre, hits in strong.items():
            count = len(hits) + (1 if genre in weak_genres else 0)  # all weak subjects together are one hit
            if count >= 2:
                score[genre] = score.get(genre, 0) + count
        if any(_is_fiction(key) for key in keys):
            for genre in list(score):
                if genre in _NONFICTION and genre not in exact:
                    del score[genre]
    order = {key: index for index, key in enumerate(GENRE_KEYS)}
    return [genre for genre, _ in sorted(score.items(), key=lambda item: (-item[1], order.get(item[0], 99)))][:MAX_GENRES_PER_BOOK]


def genre_for_label(label: str) -> str | None:
    """A reader's own shelf or tag name ("sci-fi", "Fantasy") counts as that genre for that reader only."""
    key = _subject_key(label or "")
    return SUBJECT_MAP.get(key) if key else None
