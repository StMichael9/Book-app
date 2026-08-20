def _book_titles(payload: dict) -> list[str]:
    return [item["title"] for item in payload["items"]]


def test_default_page_and_size_are_returned(client, seeded_books):
    response = client.get("/books")

    assert response.status_code == 200
    payload = response.json()
    assert payload["page"] == 1
    assert payload["size"] == 50
    assert payload["total"] == len(seeded_books)
    assert len(payload["items"]) == len(seeded_books)


def test_total_is_not_inflated_by_join_duplicates(client):
    response = client.get("/books", params={"tag": "fantasy"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 3
    assert len(_book_titles(payload)) == len(set(_book_titles(payload)))


def test_multi_tag_book_appears_once_and_keeps_all_tags(client):
    response = client.get("/books", params={"book": "Dracula"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert len(payload["items"]) == 1

    book = payload["items"][0]
    assert book["title"] == "Dracula"
    assert {tag["name"] for tag in book["tags"]} == {"horror", "gothic"}


def test_requesting_page_beyond_last_page_returns_empty_items(client):
    response = client.get("/books", params={"page": 999, "size": 2})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"] == []
    assert payload["total"] > 0
    assert payload["page"] == 999


def test_page_below_minimum_returns_422(client):
    response = client.get("/books", params={"page": 0})

    assert response.status_code == 422


def test_size_above_maximum_returns_422(client):
    response = client.get("/books", params={"size": 101})

    assert response.status_code == 422