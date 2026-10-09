def test_batch_tag_resolution_returns_unique_exact_visible_matches(client, app_modules, db_session):
    models = app_modules["models"]
    db_session.add(models.Tag(name="fantasy_hidden", type=models.TagType.topic, visible_in_v2=False))
    db_session.commit()
    response = client.get("/autocomplete/tags/batch", params=[("name", "fantasy"), ("name", "fantasy"), ("name", "fantasy_hidden"), ("name", "fant")])
    assert response.status_code == 200
    assert [tag["name"] for tag in response.json()] == ["fantasy"]


def test_batch_tag_resolution_rejects_missing_or_oversized_lists(client):
    assert client.get("/autocomplete/tags/batch").status_code == 422
    assert client.get("/autocomplete/tags/batch", params=[("name", str(index)) for index in range(31)]).status_code == 422
