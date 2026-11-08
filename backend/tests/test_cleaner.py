"""T47: the book cleaner's pure rules. No database."""
import pytest

from data import cleaner

DRACULA_AUTHORS = ["Bram Stoker", "Mary Wollstonecraft Shelley", "Robert Louis Stevenson", "R. L. Stevenson", "Bram Stoke",
                   "Bram Stroker", "BRAM STOCKER", "Bram Stoker.", "Destinyalready Creative Writing Ink", "ClassyBookRead",
                   "Penguin Classics", "Various"]
SPANISH = ("Por fin una edición completa de la novela de Bram Stoker. El conde Drácula llega a Inglaterra y los amigos de "
           "Jonathan Harker deben detenerlo antes de que sea demasiado tarde para todos.")


def test_dracula_comes_out_with_one_author_a_clean_title_and_no_spanish_blurb():
    assert cleaner.clean_authors(DRACULA_AUTHORS) == ["Bram Stoker"]
    assert cleaner.clean_title("Bram Stoker's Dracula omnibus", ["Bram Stoker"]) == "Dracula"
    assert cleaner.clean_description(SPANISH) is None


def test_variant_spellings_fold_into_the_first_listed_author_and_initials_into_the_full_name():
    assert cleaner.clean_authors(["James Joyce", "james joyce", "J Joyce", "James Joyce.", "Jame Joyce"]) == ["James Joyce"]
    assert cleaner.clean_authors(["Robert Louis Stevenson", "R. L. Stevenson", "R L Stevenson"]) == ["Robert Louis Stevenson"]
    assert cleaner.clean_authors(["JANE AUSTEN"]) == ["Jane Austen"] and cleaner.clean_authors(["jane austen"]) == ["Jane Austen"]


def test_different_people_with_similar_names_are_not_folded():
    assert cleaner.clean_authors(["Ann Lee", "Ann Leo"]) == ["Ann Lee", "Ann Leo"]
    assert cleaner.clean_authors(["John Smith", "Jane Smith"]) == ["John Smith", "Jane Smith"]


def test_publisher_and_brand_names_are_dropped_but_never_the_only_author_silently_kept():
    assert cleaner.clean_authors(["Penguin Books", "Jane Austen", "Oxford University Press", "Classic Reads"]) == ["Jane Austen"]
    assert cleaner.clean_authors(["Destinyalready Creative Writing Ink", "ClassyBookRead"]) == []
    for name in ("Jane Austen", "Neil Gaiman", "Haruki Murakami", "N. K. Jemisin", "bell hooks"):
        assert not cleaner.looks_like_publisher(name)


def test_co_authors_need_edition_consensus_and_are_capped_at_three():
    team = ["Terry Pratchett", "Neil Gaiman", "Someone Translator", "Another Illustrator"]
    assert cleaner.clean_authors(team, support={"Terry Pratchett": 1.0, "Neil Gaiman": 0.9, "Someone Translator": 0.1}) == [
        "Terry Pratchett", "Neil Gaiman"]
    many = ["A One", "B Two", "C Three", "D Four", "E Five"]
    assert cleaner.clean_authors(many, support={n: 1.0 for n in many}) == ["A One", "B Two", "C Three"]
    assert cleaner.clean_authors(many) == ["A One"]                                   # more than two people and no edition data
    assert cleaner.clean_authors(["Good Omens One", "Co Author"]) == ["Good Omens One", "Co Author"]   # few people, no data: keep


@pytest.mark.parametrize("title", ["Harry Potter Box Set", "The Complete Works of Shakespeare", "Sherlock Holmes Omnibus",
                                   "Dracula and Other Collections", "Three Novels in One", "Hunger Games Trilogy Set",
                                   "Best Short Stories: An Anthology", "Summary of Atomic Habits"])
def test_derivative_titles_are_recognised(title):
    assert cleaner.is_derivative(title)


@pytest.mark.parametrize("title", ["Dracula", "Atomic Habits", "The Collector", "Frankenstein; or, The Modern Prometheus"])
def test_ordinary_titles_are_not_derivatives(title):
    assert not cleaner.is_derivative(title)


def test_title_cleaning_removes_the_possessive_edition_words_and_series_tags():
    assert cleaner.clean_title("Jane Austen's Pride and Prejudice", ["Jane Austen"]) == "Pride and Prejudice"
    assert cleaner.clean_title("Pride and Prejudice (Penguin Classics)", ["Jane Austen"]) == "Pride and Prejudice"
    assert cleaner.clean_title("Dracula: Annotated Edition", None) == "Dracula"
    assert cleaner.clean_title("Death on the Nile (Hercule Poirot, #18)", None) == "Death on the Nile"
    assert cleaner.clean_title("Sherlock Holmes Omnibus", None) == "Sherlock Holmes Omnibus"      # stays, and is a derivative
    assert cleaner.clean_title("Mrs Dalloway's Party", ["Virginia Woolf"]) == "Mrs Dalloway's Party"   # not the author's possessive


def test_the_most_common_edition_title_wins():
    editions = ["Dracula", "Dracula", "Bram Stoker's Dracula", "Dracula omnibus", "Drácula"]
    assert cleaner.clean_title("Bram Stoker's Dracula omnibus", ["Bram Stoker"], edition_titles=editions) == "Dracula"


def test_descriptions_must_be_english_and_lose_edition_and_seller_sentences():
    english = ("A young solicitor travels to Transylvania to help a nobleman buy a house in London. He soon learns that the "
               "count is not what he seems, and that the people of the village fear what lives in the castle.")
    assert cleaner.clean_description(english) == english
    noisy = english + " This edition includes an introduction by a famous scholar. Available now as an e-book for Kindle."
    assert cleaner.clean_description(noisy) == english
    assert cleaner.clean_description(english + " -- Source: some publisher page") == english
    assert cleaner.clean_description(english + "\n\n----\n[Source][1]") == english
    assert cleaner.clean_description(SPANISH) is None
    assert cleaner.clean_description("Short.") is None and cleaner.clean_description(None) is None
    assert cleaner.clean_description("This edition is a reprint. Translated by someone. Free download of the ebook.") is None


def test_quality_score_hides_messy_books_and_never_scores_a_clean_one_low():
    good = dict(title="Dracula", authors=["Bram Stoker"], description="A young solicitor travels to a castle in the mountains and "
                "learns what the count is, and the people of the village fear what lives there.", cover="https://x/c.jpg", pages=418,
                year=1897, popularity=9.0, genres=2)
    assert cleaner.quality_score(**good) == 100
    assert cleaner.quality_score(**{**good, "description": None, "popularity": None, "genres": 0}) >= 60
    assert cleaner.quality_score(**{**good, "title": "Dracula Omnibus"}) <= 40
    messy = {**good, "title": "Bram Stoker's Dracula omnibus", "authors": DRACULA_AUTHORS, "description": SPANISH, "genres": 0, "popularity": None}
    assert cleaner.quality_score(**messy) < cleaner.LISTING_THRESHOLD
    assert cleaner.quality_score(**{**good, "authors": []}) < 100
