"""T57: the corrected subject rules (no database needed)."""
from data import taxonomy
from data.taxonomy import genres_for_subjects as genres

ORIENT_EXPRESS = ["Detective and mystery stories", "Fiction", "Private investigators", "Investigation", "Murder", "Travel",
                  "Juvenile fiction", "Humour"]
# The real Open Library subjects of book 1977 (work OL471576W), fetched 2026-11-13.
ORIENT_EXPRESS_REAL = [
    "Agatha Christie", "Private investigator", "P.I.", "Hercule Poirot", "Detective", "Murder", "Mystery", "Juvenile",
    "Humour", "Fiction", "Literature", "Stories", "Private investigators", "Private investigators in fiction", "Travel",
    "Railroad", "Trains", "Express trains", "Orient Express", "Littérature anglaise", "Roman anglais",
    "Orient Express (Express train)", "Regény", "Angol irodalom", "Hercule Poirot (Fictitious character)",
    "Detective and mystery stories", "Railroad stories", "Railroad travel", "Poirot, Hercule (Personaje literario)",
    "Novela policíaca", "Ficción", "Investigation", "Juvenile fiction", "Poirot, hercule (fictitious character), fiction",
    "Private investigators, fiction", "Fiction, mystery & detective, traditional", "French imprints",
    "Translations into French", "English Detective and mystery stories", "French fiction", "English fiction",
    "English literature", "Readers", "English language, textbooks for foreign speakers",
    "Hercule Poirot (Fictional character)", "Mystery fiction", "Large type books", "Dorian. Grey (Fictitious character)",
    "Détectives", "Romans, nouvelles", "Orient-Express (Train rapide)", "Meurtre", "Enquêtes", "Spanish language materials",
    "Novela", "Detectives privados", "Comics & graphic novels, crime & mystery", "American literature"]


def test_investigators_and_investigation_no_longer_make_a_book_business():
    assert genres(["Private investigators", "Investigation"]) == []                  # one real hit for mystery, none for business
    assert "business_money" not in genres(["Private investigators", "Investigation", "Fiction"])
    assert genres(["Investing", "Stock market investment"]) == ["business_money"]  # real investing still counts


def test_partial_keywords_match_whole_words_only():
    assert genres(["Alienation", "Alienation (Social psychology)"]) == []
    assert genres(["Aliens", "Alien invasion"]) == ["science_fiction"]
    assert genres(["Walking tours", "Futuristic cities"]) == []                      # "futur" and "walk" stems are gone
    assert genres(["Robotics", "Robotic arms"]) == []                               # not the word "robot"


def test_the_orient_express_is_a_mystery_and_nothing_else():
    assert genres(ORIENT_EXPRESS) == ["mystery_crime"]
    assert genres(ORIENT_EXPRESS_REAL) == ["mystery_crime"]          # the real list: Juvenile + Juvenile fiction, Travel + Railroad travel


def test_bare_noisy_subjects_are_one_weak_hit_never_an_exact_alias():
    for subject in ("Travel", "Humour", "Humor", "Juvenile", "Juvenile fiction"):
        assert genres([subject]) == [], subject
    assert genres(["Travel", "Voyages and travels"]) == ["travel"]                  # a strong alias still counts
    assert genres(["Travel", "Travel guidebooks"]) == ["travel"]                    # weak + a second partial hit
    assert genres(["Picture books"]) == ["childrens"] and genres(["Humorous stories"]) == ["humor"]


def test_a_readers_own_shelf_called_travel_is_still_the_travel_genre():
    assert taxonomy.genre_for_label("Travel") == "travel" and taxonomy.genre_for_label("Humour") == "humor"


def test_weak_subjects_are_one_hit_in_all_and_never_carry_a_genre_alone():
    assert genres(["Juvenile", "Juvenile fiction"]) == []                           # one edition's signal, counted once
    assert genres(["Travel", "Humour", "Juvenile"]) == []
    assert genres(["Juvenile", "Children's stories"]) == ["childrens"]              # a strong exact alias plus a weak one
    assert genres(["Travel", "Guidebooks and tourism"]) == ["travel"]               # one weak + one non-weak partial hit


def test_a_fiction_book_needs_a_strong_exact_alias_for_a_nonfiction_genre():
    assert genres(["Fiction", "Business strategy", "Management techniques"]) == []   # two partial hits are not enough in a novel
    assert genres(["Business strategy", "Management techniques"]) == ["business_money"]
    assert genres(["Fiction", "Travel", "Railroad travel"]) == []
    assert genres(["Fiction", "Travel writing"]) == ["travel"]
    assert genres(["Fiction", "Economics"]) == ["business_money"]
    assert genres(["Non-fiction", "Business strategy", "Management techniques"]) == ["business_money"]  # not fiction
    assert genres(["Fantasy fiction", "History"]) == ["fantasy", "history"]          # an exact alias still counts
    assert genres(["Fantasy fiction", "Ancient Rome", "Medieval empires"]) == ["fantasy"]


def test_graphic_novels_are_exempt_from_the_guard_and_fiction_genres_are_not_guarded():
    assert genres(["Fiction", "Graphic novels"]) == ["graphic_novels"]
    assert genres(["Fiction", "Mystery fiction"]) == ["mystery_crime"]


def test_the_cap_of_three_still_holds_and_a_custom_mapping_is_exact_only():
    many = ["Fantasy fiction", "Mystery fiction", "Horror fiction", "Romance fiction", "Humorous fiction"]
    assert len(genres(many)) == 3
    assert genres(["Anything"], {"anything": "poetry"}) == ["poetry"]
