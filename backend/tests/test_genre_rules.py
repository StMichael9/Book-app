"""T57: the corrected subject rules (no database needed)."""
from data import taxonomy
from data.taxonomy import genres_for_subjects as genres

ORIENT_EXPRESS = ["Detective and mystery stories", "Fiction", "Private investigators", "Investigation", "Murder", "Travel",
                  "Juvenile fiction", "Humour", "Business"]


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


def test_bare_noisy_subjects_are_one_weak_hit_never_an_exact_alias():
    for subject in ("Travel", "Humour", "Humor", "Juvenile", "Juvenile fiction"):
        assert genres([subject]) == [], subject
    assert genres(["Travel", "Voyages and travels"]) == ["travel"]                  # a strong alias still counts
    assert genres(["Travel", "Travel guidebooks"]) == ["travel"]                    # weak + a second partial hit
    assert genres(["Picture books"]) == ["childrens"] and genres(["Humorous stories"]) == ["humor"]


def test_a_readers_own_shelf_called_travel_is_still_the_travel_genre():
    assert taxonomy.genre_for_label("Travel") == "travel" and taxonomy.genre_for_label("Humour") == "humor"


def test_fiction_needs_two_subjects_behind_a_nonfiction_genre():
    assert genres(["Fiction", "Economics"]) == []                                    # one exact hit is not enough in a novel
    assert genres(["Economics"]) == ["business_money"]
    assert genres(["Fiction", "Economics", "Business enterprises"]) == ["business_money"]
    assert genres(["Non-fiction", "Economics"]) == ["business_money"]               # "non-fiction" is not fiction
    assert genres(["Fantasy fiction", "History"]) == ["fantasy"]


def test_graphic_novels_are_exempt_from_the_guard_and_fiction_genres_are_not_guarded():
    assert genres(["Fiction", "Graphic novels"]) == ["graphic_novels"]
    assert genres(["Fiction", "Mystery fiction"]) == ["mystery_crime"]


def test_the_cap_of_three_still_holds_and_a_custom_mapping_is_exact_only():
    many = ["Fantasy fiction", "Mystery fiction", "Horror fiction", "Romance fiction", "Humorous fiction"]
    assert len(genres(many)) == 3
    assert genres(["Anything"], {"anything": "poetry"}) == ["poetry"]
