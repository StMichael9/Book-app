import pytest


@pytest.mark.parametrize("origin", ["", "*", "https://*.example.com", "null", "http://example.com", "https://example.com/path", "https://user:password@example.com", "https://"])
def test_unsafe_production_cors_configuration_is_rejected(app_modules, monkeypatch, origin):
    main = app_modules["main"]
    monkeypatch.setattr(main.settings, "is_dev", False)
    monkeypatch.setenv("CORS_ORIGINS", origin)
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        main._parse_cors_origins()


def test_production_cors_requires_explicit_origins(app_modules, monkeypatch):
    main = app_modules["main"]
    monkeypatch.setattr(main.settings, "is_dev", False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        main._parse_cors_origins()


def test_production_cors_accepts_exact_https_origins(app_modules, monkeypatch):
    main = app_modules["main"]
    monkeypatch.setattr(main.settings, "is_dev", False)
    monkeypatch.setenv("CORS_ORIGINS", " https://bookvane.example,https://www.bookvane.example ")
    assert main._parse_cors_origins() == ["https://bookvane.example", "https://www.bookvane.example"]


def test_development_cors_default_remains_localhost(app_modules, monkeypatch):
    main = app_modules["main"]
    monkeypatch.setattr(main.settings, "is_dev", True)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert main._parse_cors_origins() == ["http://localhost:5173"]
