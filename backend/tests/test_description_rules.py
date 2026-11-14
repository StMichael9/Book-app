"""T58: description rules, Markdown to plain text with paragraphs, section trimming and credit lines. No database."""
from data import clean, cleaner

THRONES = """***A Game of Thrones*** is the first novel in *A Song of Ice and Fire*, a series of epic fantasy novels.

### Plot Summary
Eddard Stark, Lord of Winterfell, is asked to serve the king as Hand. Winter is coming and the realm is at war with itself.

### Key Characters
- **Eddard Stark**: Lord of Winterfell
- **Jon Snow**: his bastard son

### Awards
Won the Locus Award for best novel.

Followed by [***A Clash of Kings***][1]

[1]: https://openlibrary.org/works/OL257943W
"""


def test_game_of_thrones_becomes_plain_text_with_its_intro_and_plot_only():
    result = cleaner.clean_description(THRONES)
    assert result == ("A Game of Thrones is the first novel in A Song of Ice and Fire, a series of epic fantasy novels.\n\n"
                      "Eddard Stark, Lord of Winterfell, is asked to serve the king as Hand. Winter is coming and the realm "
                      "is at war with itself.")
    for junk in ("*", "#", "[1]", "openlibrary.org", "Key Characters", "Locus", "Followed by"):
        assert junk not in result


def test_the_result_is_stable_when_cleaned_again():
    once = cleaner.clean_description(THRONES)
    assert cleaner.clean_description(once) == once


def test_links_keep_their_text_and_bare_open_library_urls_go():
    raw = ("Read [the first chapter](https://example.org/a) and the [sequel][2] today, see https://openlibrary.org/works/OL1W "
           "for more about this long and winding story of a family.\n\n[2]: https://openlibrary.org/works/OL2W")
    assert cleaner.clean_description(raw) == "Read the first chapter and the sequel today, see for more about this long and winding story of a family."
    assert cleaner.markdown_to_text("a **bold** and __also__ and *it* word_with_underscores") == "a bold and also and it word_with_underscores"


def test_a_definition_left_inside_collapsed_text_is_removed():
    assert cleaner.clean_description("A long enough story about a family and a house. [1]: https://openlibrary.org/works/OL9W") == \
        "A long enough story about a family and a house."


def test_paragraphs_are_kept_and_lines_inside_one_are_joined():
    raw = "First line of the first paragraph\ncontinues here on the next line.\n\n\n\nSecond paragraph is a different thought entirely."
    assert cleaner.clean_description(raw) == ("First line of the first paragraph continues here on the next line.\n\n"
                                             "Second paragraph is a different thought entirely.")


def test_list_items_become_lines():
    raw = "The book covers these things in a very clear way:\n\n- Money and how to save it wisely\n- Time and how to spend it\n* Habits that last"
    assert cleaner.clean_description(raw) == ("The book covers these things in a very clear way:\n\n"
                                             "Money and how to save it wisely\nTime and how to spend it\nHabits that last")


def test_sections_keep_intro_and_plot_and_drop_the_rest_even_with_bold_headings():
    raw = ("An old lighthouse keeper finds a message in a bottle and sets out to answer it.\n\n**Themes**\nLoneliness and hope.\n\n"
           "**Synopsis**\nHe rows to the mainland and meets the sender, who is not at all what he expected.\n\n**Awards**\nNone.")
    result = cleaner.clean_description(raw)
    assert "lighthouse keeper" in result and "mainland" in result
    assert "Loneliness" not in result and "None." not in result


def test_unknown_headings_only_are_not_thrown_away_entirely():
    raw = "### Background\nA long story of a family that moves to the coast and learns to fish and to love the sea."
    assert "family that moves" in cleaner.clean_description(raw)


def test_credit_only_text_is_dropped_but_a_credit_inside_prose_goes_alone():
    assert cleaner.clean_description("Written and edited by Leonard Wolf ; notes, bibliography, and filmography") is None
    assert cleaner.clean_description("Translation of: Les miserables, by Victor Hugo") is None
    kept = cleaner.clean_description("A count moves to London and trouble follows him there. Written and edited by Leonard Wolf.")
    assert kept == "A count moves to London and trouble follows him there."


def test_a_real_sentence_that_starts_like_a_credit_is_kept():
    text = "Written by a master of suspense, this novel follows a detective through one long night in the city."
    assert cleaner.clean_description(text) == text


def test_the_old_rules_still_apply():
    assert cleaner.clean_description("Por fin una edicion completa de la novela de Bram Stoker. El conde Dracula llega a Inglaterra y los amigos de Jonathan Harker deben detenerlo antes de que sea demasiado tarde.") is None
    assert cleaner.clean_description("A lovely story of a girl and a horse in the hills. This edition is a reprint with new cover design.") == \
        "A lovely story of a girl and a horse in the hills."
    assert cleaner.clean_description("A good story of a girl and a horse in the hills and the long road home. ---------- Source: someone") == \
        "A good story of a girl and a horse in the hills and the long road home."


def test_the_import_step_keeps_line_breaks_and_the_quality_score_ignores_them():
    assert clean.description({"value": "  One  line\r\n\r\n\r\n\r\nTwo   line "}) == "One line\n\nTwo line"
    text = ("A young solicitor travels to Transylvania to help a nobleman buy a house in London.\n\nHe soon learns that the count "
            "is not what he seems, and that the people of the village fear what lives in the castle.")
    score = cleaner.quality_score(title="Dracula", authors=["Bram Stoker"], description=text, cover="c", pages=1, year=1897)
    assert score == 15 + 20 + 20 + 10 + 10 + 15
