"""T64: genre rules, pass 2. Each wrong genre the T57 dry run showed is a test on the book's real Open Library subjects
(`real_subjects.py`), next to genuine cases that must keep their genre. No database needed."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import real_subjects as real  # noqa: E402

from data.taxonomy import genres_for_subjects as genres  # noqa: E402


# --- the examples ---------------------------------------------------------------------------------------------------------

def test_dune_is_science_fiction_not_science_nature_or_fantasy():
    # "Ecology" is one theme tag, and "Science fiction" subjects no longer count as science; a lone "Fantasy fiction" loses to
    # seven science fiction subjects.
    assert genres(real.DUNE) == ["science_fiction"]


def test_a_game_of_thrones_is_fantasy_without_science_fiction_or_horror():
    # One stray "Science Fiction" among a dozen fantasy subjects, and "Supernatural" (with Magic, Dragons) as plain themes.
    assert genres(real.GAME_OF_THRONES) == ["fantasy"]


def test_dracula_keeps_horror_and_loses_graphic_novels_and_literary_fiction():
    result = genres(real.DRACULA)
    assert result[0] == "horror" and not {"graphic_novels", "literary_fiction"} & set(result)


def test_good_to_great_is_business_not_science():
    assert genres(real.GOOD_TO_GREAT) == ["business_money"]


def test_the_gruffalo_is_a_childrens_book_not_horror_or_science():
    result = genres(real.GRUFFALO)
    assert "childrens" in result and not {"horror", "science_nature"} & set(result)


def test_english_miracle_plays_are_drama_not_a_mystery():
    result = genres(real.MIRACLE_PLAYS)
    assert "drama" in result and "mystery_crime" not in result


def test_the_societys_traitor_is_not_travel():
    assert genres(real.SOCIETYS_TRAITOR) == ["fantasy", "childrens"]


# --- genuine cases that must keep their genre -----------------------------------------------------------------------------

def test_a_real_horror_novel_stays_horror():
    assert genres(real.THE_SHINING)[0] == "horror"
    assert genres(real.DRACULA)[0] == "horror"


def test_a_real_graphic_novel_stays_a_graphic_novel():
    assert genres(real.MAUS)[0] == "graphic_novels"


def test_a_real_science_book_stays_science():
    assert genres(real.BRIEF_HISTORY)[0] == "science_nature"
    assert genres(["Ecology", "Environment", "Climate change"]) == ["science_nature"]      # a nonfiction ecology book


# --- the rules themselves -------------------------------------------------------------------------------------------------

def test_monsters_ghosts_magic_and_supernatural_are_weak_but_still_add_to_a_real_signal():
    for subject in ("Monsters", "Ghosts", "Magic", "Supernatural"):
        assert genres([subject]) == [], subject
    assert genres(["Monsters, fiction", "Animals, fiction"]) == []                           # the same words with a form tail
    assert genres(["Monsters", "Horror fiction"]) == ["horror"]
    assert genres(["Magic", "Fantasy fiction"]) == ["fantasy"]


def test_mystery_and_miracle_plays_are_not_crime():
    assert "mystery_crime" not in genres(["Mystery plays", "Miracle plays", "Mysteries and miracle-plays, English"])
    assert genres(["Mystery fiction", "Detective and mystery stories"]) == ["mystery_crime"]


def test_a_nonfiction_genre_on_a_fiction_book_needs_a_strong_alias_and_a_second_subject():
    assert genres(["Fiction", "Politics"]) == [] and genres(["Fiction", "Voyages and travels"]) == []
    assert genres(["Fiction", "Biography", "Autobiography"]) == ["biography_memoir"]


def test_a_subject_about_fiction_is_never_a_partial_hit_for_a_nonfiction_genre():
    assert genres(["Fiction", "Ecology"]) == []                                              # a theme tag is not a genre
    assert genres(["Science fiction", "Fiction, science fiction, general"]) == ["science_fiction"]   # not "science"


def test_graphic_novels_need_a_format_subject():
    assert genres(["Superhero fiction", "Comic strip characters"]) == []
    assert genres(["Superheroes", "Comic book characters"]) == []
    assert genres(["Comics"]) == ["graphic_novels"]
    assert genres(["Fiction", "Graphic novels"]) == ["graphic_novels"]


def test_psychological_fiction_alone_does_not_make_a_book_literary_fiction():
    assert "literary_fiction" not in genres(["Psychological fiction", "Fiction, psychological", "Literary criticism"])
    assert genres(["Literary fiction"]) == ["literary_fiction"]


def test_rival_genres_keep_both_when_both_are_well_supported():
    both = ["Fantasy", "High fantasy", "Epic fantasy", "Science fiction", "Space opera", "Dystopias"]
    assert set(genres(both)) == {"fantasy", "science_fiction"}
    assert genres(["Fantasy", "High fantasy", "Epic fantasy", "Science fiction"]) == ["fantasy"]     # one lone subject loses
