"""F9 (generic theme subjects give a fantasy book Horror and Mystery), F15 (a typo search must not pass off loose matches as the book)
and F16 (all-caps publisher blurbs)."""
import uuid

import pytest
from sqlalchemy import delete

from data import cleaner, taxonomy

# What readers piled onto Harry Potter and the Philosopher's Stone on Open Library (cut down).
HARRY_POTTER = ["series:Harry_Potter", "Ghosts", "Monsters", "Vampires", "Witches", "Magic and Supernatural", "Wizards", "Magic", "Juvenile fiction",
                "Fiction", "Schools", "orphans", "fantasy fiction", "Wizards in fiction", "Magic in fiction", "Juvenile literature",
                "Children's stories", "Fantasy", "Children's fiction", "Mystery", "Adventure", "Supernatural", "Young Adult", "Children's Books"]


# --- F9 ----------------------------------------------------------------------------------------------------------------------

def test_a_childrens_fantasy_does_not_get_horror_or_mystery_from_generic_theme_subjects():
    found = taxonomy.genres_for_subjects(HARRY_POTTER)
    assert "fantasy" in found and "horror" not in found and "mystery_crime" not in found and "thriller" not in found


def test_real_horror_and_mystery_labels_still_count_beside_a_fantasy_label():
    assert "horror" in taxonomy.genres_for_subjects(["Fantasy fiction", "Horror fiction", "Monsters"])
    assert "mystery_crime" in taxonomy.genres_for_subjects(["Fantasy fiction", "Detective and mystery stories", "Mystery"])
    assert "horror" in taxonomy.genres_for_subjects(["Vampires -- Fiction", "Gothic fiction", "Monsters"])


def test_a_generic_theme_subject_is_still_a_genre_when_the_book_has_nothing_else():
    assert taxonomy.genres_for_subjects(["Mystery"]) == ["mystery_crime"]
    assert taxonomy.genres_for_subjects(["Vampires", "Fiction"]) == ["horror"]
    assert taxonomy.genres_for_subjects(["Supernatural", "Monsters"]) == ["horror"]


# --- F16 ---------------------------------------------------------------------------------------------------------------------

SHOUTING = ("HARRY POTTER HAS NEVER BEEN A TYPICAL BOY. HE LIVES WITH THE DURSLEYS AND DISCOVERS THAT HE IS A WIZARD. "
            "Hogwarts is waiting for him, and so is Harry's destiny.")


def test_an_all_caps_sentence_is_set_in_sentence_case_and_the_rest_is_left_alone():
    result = cleaner.clean_description(SHOUTING)
    assert result.startswith("Harry potter has never been a typical boy. He lives with the dursleys and discovers that he is a wizard.")
    assert result.endswith("Hogwarts is waiting for him, and so is Harry's destiny.")
    assert "HARRY" not in result and "WIZARD" not in result


def test_names_that_appear_capitalised_elsewhere_keep_their_capitals():
    result = cleaner.clean_description(SHOUTING)
    assert "Hogwarts" in result
    text = "ALL THE WORLD LOVES HOGWARTS AND ITS WIZARDS. Hogwarts is a school for young wizards and witches."
    assert cleaner.clean_description(text).startswith("All the world loves Hogwarts and its wizards.")


def test_acronyms_and_the_pronoun_i_survive_and_normal_text_is_untouched():
    assert cleaner.clean_description("THE FBI AND NASA WERE THERE, AND I SAW IT ALL HAPPEN TODAY.") == "The FBI and NASA were there, and I saw it all happen today."
    plain = "A quiet novel about a lighthouse keeper and the NASA engineer who writes to him each winter."
    assert cleaner.clean_description(plain) == plain
    assert cleaner.clean_description("A short NOTE ON THE TEXT is added at the end of this unusual edition of the novel.").count("NOTE") == 1   # a few capitals are not shouting


# --- F15 ---------------------------------------------------------------------------------------------------------------------

@pytest.fixture()
def catalogue(client, db_session, app_modules):
    models = app_modules["models"]
    made = []

    def book(title):
        item = models.Book(title=title, description="d", page_count=300, published_year=1999, cover_image_url="https://covers.example/x.jpg",
                           source_id=f"/works/OL9{uuid.uuid4().int % 10**6:06d}W")
        db_session.add(item)
        db_session.commit()
        made.append(item.id)
        return item

    for title in ("Wings of Fire", "The Golden Goblet", "Harry Potter and the Philosopher's Stone", "Pride and Prejudice", "The Hobbit"):
        book(title)
    yield client
    db_session.rollback()
    db_session.execute(delete(models.Book).where(models.Book.id.in_(made)))
    db_session.commit()


def titles(client, text):
    response = client.get("/books", params={"book": text})
    assert response.status_code == 200, response.text
    return [item["title"] for item in response.json()["items"]], response.json()["total"]


def test_a_missing_book_is_not_disguised_by_titles_that_share_one_word_with_it(catalogue):
    assert titles(catalogue, "goblet of fire") == ([], 0)
    assert titles(catalogue, "fire and blood")[1] == 0


def test_typos_still_find_the_book(catalogue):
    assert any("Harry Potter" in t for t in titles(catalogue, "hary poter")[0])
    assert titles(catalogue, "pride and prejudise")[0] == ["Pride and Prejudice"]
    assert titles(catalogue, "the hobit")[0] == ["The Hobbit"]


def test_exact_and_partial_searches_are_unchanged(catalogue):
    assert titles(catalogue, "goblet")[0] == ["The Golden Goblet"]
    assert titles(catalogue, "wings of fire")[0] == ["Wings of Fire"]
