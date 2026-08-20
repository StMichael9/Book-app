def _titles(response_json: dict) -> set[str]:
    return {item["title"] for item in response_json["items"]}


def test_get_books_without_filters_returns_all_books(client, seeded_books):
    response = client.get("/books")

    assert response.status_code == 200
    payload = response.json()
    assert payload["page"] == 1
    assert payload["size"] == 50
    assert payload["total"] == len(seeded_books)
    assert _titles(payload) == set(seeded_books)


def test_book_filter_matches_partial_title(client):
    response = client.get("/books", params={"book": "Harry"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert _titles(payload) == {"Harry Potter and the Sorcerer's Stone"}


def test_author_filter_matches_partial_author_name(client):
    response = client.get("/books", params={"author": "Tolkien"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert _titles(payload) == {"The Fellowship of the Ring"}


def test_tag_filter_requires_exact_tag_name(client):
    exact_response = client.get("/books", params={"tag": "fantasy"})
    partial_response = client.get("/books", params={"tag": "fant"})

    assert exact_response.status_code == 200
    assert partial_response.status_code == 200
    assert exact_response.json()["total"] == 3
    assert partial_response.json()["items"] == []


def test_book_and_author_filters_can_be_combined(client):
    response = client.get("/books", params={"book": "Fellowship", "author": "Tolkien"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert _titles(payload) == {"The Fellowship of the Ring"}


def test_book_and_tag_filters_can_be_combined(client):
    response = client.get("/books", params={"book": "Harry", "tag": "fantasy"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert _titles(payload) == {"Harry Potter and the Sorcerer's Stone"}


def test_author_and_tag_filters_can_be_combined(client):
    response = client.get("/books", params={"author": "Stoker", "tag": "horror"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert _titles(payload) == {"Dracula"}


def test_all_three_filters_can_be_combined(client):
    response = client.get(
        "/books",
        params={"book": "Harry", "author": "rowling", "tag": "magic"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert _titles(payload) == {"Harry Potter and the Sorcerer's Stone"}


def test_unknown_author_returns_empty_result(client):
    response = client.get("/books", params={"author": "Nobody Known"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 0
    assert payload["items"] == []


def test_unknown_tag_returns_empty_result(client):
    response = client.get("/books", params={"tag": "nonexistent"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 0
    assert payload["items"] == []


def test_author_filter_is_case_insensitive(client):
    response = client.get("/books", params={"author": "tolkien"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert _titles(payload) == {"The Fellowship of the Ring"}