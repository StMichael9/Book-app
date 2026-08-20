def test_valid_book_id_returns_book(client, seeded_books):
    book = seeded_books["Dracula"]

    response = client.get(f"/books/{book.id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == book.id
    assert payload["title"] == "Dracula"
    assert {author["name"] for author in payload["authors"]} == {"Bram Stoker"}


def test_multi_author_book_is_returned_once_with_all_authors(client, seeded_books):
    book = seeded_books["Good Omens"]

    response = client.get(f"/books/{book.id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == book.id
    assert payload["title"] == "Good Omens"
    assert {author["name"] for author in payload["authors"]} == {
        "Neil Gaiman",
        "Terry Pratchett",
    }
    assert len(payload["authors"]) == 2


def test_missing_book_id_returns_404(client):
    response = client.get("/books/999999")

    assert response.status_code == 404
    assert response.json()["detail"] == "Book not found"


def test_non_integer_book_id_returns_422(client):
    response = client.get("/books/abc")

    assert response.status_code == 422
    payload = response.json()
    assert payload["detail"]


def test_empty_collection_returns_200_not_404(client):
    response = client.get("/books", params={"author": "No Such Author"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"] == []
    assert payload["total"] == 0


def test_author_filter_returns_both_stoker_books_and_null_year_serializes(client):
    response = client.get("/books", params={"author": "Stoker"})

    assert response.status_code == 200
    payload = response.json()
    titles = {item["title"] for item in payload["items"]}

    assert titles == {"Dracula", "The Lost Codex"}

    lost_codex = next(item for item in payload["items"] if item["title"] == "The Lost Codex")
    assert lost_codex["published_year"] is None