"""T59: text that is not a description: a stranger's email, a reader's review, a contents list. No database."""
from data import cleaner

CHOIRBOYS = ("Written By Bernie Weisz Hiistorian Brooklyn, New York March 18th, 2013 e mail: Bernwei1@aol.com Title of Review: "
             "The Choirboys is a story of Los Angeles police officers, and I give this book four stars out of five.")
CONTENTS = ("Fiction. My kinsman, Major Molineux / Nathaniel Hawthorne Purloined Letter / Edgar Allan Poe The Fall of the House "
            "of Usher / Edgar Allan Poe Young Goodman Brown / Nathaniel Hawthorne The Open Boat / Stephen Crane")


def test_a_description_with_an_email_address_is_dropped_whole():
    assert cleaner.clean_description(CHOIRBOYS) is None
    assert cleaner.clean_description("A fine long story about a family by the sea. Write to someone@example.com for more.") is None
    assert cleaner.clean_description("A fine long story about a family by the sea, told by someone at example dot com.") is not None
    assert "email" in cleaner.description_flags(CHOIRBOYS)
    assert cleaner.mask_emails(CHOIRBOYS).count("@") == 0 and "[email removed]" in cleaner.mask_emails(CHOIRBOYS)


def test_a_reader_review_is_dropped():
    for text in ("Title of Review: A great read about a detective and his city in the long winter of that year.",
                 "My rating: five stars. A long and rewarding story about a detective and his city in winter.",
                 "I give this book four stars out of five because the story of the detective and his city is long.",
                 "A detective story set in a city, 4 stars out of 5 for the long and winding plot, my review follows."):
        assert cleaner.clean_description(text) is None, text
        assert "review" in cleaner.description_flags(text)


def test_ordinary_blurbs_that_mention_reviews_or_stars_are_kept():
    for text in ("A New York Times review called this the best crime novel of the decade, and the detective is its star.",
                 "The stars wheel overhead as the old astronomer counts out the long nights of his last winter on the hill.",
                 "How could it have happened that a wine was given five out of five stars, the highest rating, in one journal "
                 "and in another it was called the worst wine of the decade?"):
        assert cleaner.clean_description(text) == text, text


def test_a_contents_list_is_dropped_and_a_real_intro_before_it_is_kept():
    assert cleaner.clean_description(CONTENTS) is None
    intro = "A wonderful anthology of stories from many lands, chosen for young readers with great care by the editors."
    assert cleaner.clean_description(intro + " Contents: One / Two / Three") == intro
    longer = ("The Open Boat / Stephen Crane The Outcasts / Bret Harte Young Goodman Brown / Nathaniel Hawthorne The Luck / "
              "Bret Harte The Gift of the Magi / William Porter The Tell-Tale Heart / Edgar Poe To Build a Fire / Jack London")
    assert cleaner.clean_description(intro + " " + longer) == intro
    assert cleaner.clean_description(intro + " " + longer.split(" / ")[0] + " / Stephen Crane") == intro + " The Open Boat / Stephen Crane"
    assert "contents" in cleaner.description_flags(CONTENTS)


def test_slash_separated_word_pairs_in_a_real_description_are_kept():
    text = ("A story of love / loss, hope / despair and life / death in a small town where everyone knows everyone and "
            "secrets never stay buried for long.")
    assert cleaner.clean_description(text) == text
    assert "contents" not in cleaner.description_flags(text)
    names = ("Four friends, Ann Lee / Bob Ray, Cy Dunn / Di Fox and Ed Poe / Flo Kay, try to cross a long and very quiet "
             "country by train in the winter, and nothing goes as planned for any of them.")
    assert cleaner.clean_description(names) == names                        # fewer than four pairs


def test_slashes_in_ordinary_prose_are_not_a_contents_list():
    text = "She walked and/or ran along the road, and he wondered why she would do it every single morning of the year."
    assert cleaner.clean_description(text) == text
    long = ("He lived in the town / the village / the hamlet by the river, where the people were kind and the winters long and "
            "dark, and nobody remembered a time before the mill.")
    assert cleaner.clean_description(long) == long
