import logging


def test_private_search_values_are_redacted_from_access_logs(app_modules):
    filter_record = app_modules["main"].PrivateQueryLogFilter()
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1", "GET", "/me/library?q=private-reader-context&facet=want", "1.1", 200), None)
    assert filter_record.filter(record)
    assert "private-reader-context" not in record.getMessage()
    assert '/me/library HTTP/1.1' in record.getMessage()
    public = logging.LogRecord("uvicorn.access", logging.INFO, "", 0,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1", "GET", "/books?page=2", "1.1", 200), None)
    assert filter_record.filter(public)
    assert "/books?page=2" in public.getMessage()
