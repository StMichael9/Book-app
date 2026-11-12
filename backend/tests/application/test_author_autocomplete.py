def names(response):
    return [item["name"] for item in response.json()]


def test_like_wildcards_in_an_author_suggestion_are_literal(client, db_session, app_modules):
    models = app_modules["models"]
    db_session.add_all(models.Author(name=name) for name in ("A_B Writer", "AxB Writer", "100% Writer", "Back\\slash Writer"))
    db_session.commit()
    assert names(client.get("/autocomplete/authors", params={"q": "A_B"})) == ["A_B Writer"]
    assert names(client.get("/autocomplete/authors", params={"q": "100%"})) == ["100% Writer"]
    assert names(client.get("/autocomplete/authors", params={"q": "k\\s"})) == ["Back\\slash Writer"]
    assert names(client.get("/autocomplete/authors", params={"q": "%"})) == ["100% Writer"]
    assert names(client.get("/autocomplete/authors", params={"q": "_"})) == ["A_B Writer"]
    assert len(names(client.get("/autocomplete/authors", params={"q": "writer"}))) == 4


def test_like_wildcards_in_a_tag_suggestion_are_literal(client, db_session, app_modules):
    models = app_modules["models"]
    db_session.add_all(models.Tag(name=name, type=models.TagType.topic) for name in ("zq_tag", "zqxtag", "zq100%tag", "zq\\tag"))
    db_session.commit()
    assert names(client.get("/autocomplete/tags", params={"q": "zq_t"})) == ["zq_tag"]
    assert names(client.get("/autocomplete/tags", params={"q": "100%t"})) == ["zq100%tag"]
    assert names(client.get("/autocomplete/tags", params={"q": "q\\t"})) == ["zq\\tag"]
    assert names(client.get("/autocomplete/tags", params={"q": "%"})) == ["zq100%tag"]
    assert all("_" in name for name in names(client.get("/autocomplete/tags", params={"q": "_"})))
    assert len(names(client.get("/autocomplete/tags", params={"q": "zq"}))) == 4
