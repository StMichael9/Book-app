"""Error reporting that is off unless SENTRY_DSN is set, and that never carries personal data.

Sentry is told not to attach personal data, request bodies or local variables, and every event passes through
scrub_event before it leaves: no cookies, no credentials, no request headers beyond a short allow-list, no query
string (library searches are private) and no user, breadcrumb or address details. The error itself (its type,
message and stack) is what we need and is kept.
"""
import sentry_sdk

SAFE_HEADERS = {"user-agent", "content-type", "accept", "accept-language", "content-length", "host"}


def _without_query(url):
    return url.split("?", 1)[0].split("#", 1)[0] if isinstance(url, str) else url


def scrub_event(event, hint=None):
    request = event.get("request")
    if isinstance(request, dict):
        for field in ("cookies", "data", "query_string", "env"):
            request.pop(field, None)
        if "url" in request:
            request["url"] = _without_query(request["url"])
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {name: value for name, value in headers.items() if name.lower() in SAFE_HEADERS}
    for field in ("user", "breadcrumbs", "extra"):
        event.pop(field, None)
    return event


def environment_name(settings):
    return settings.sentry_environment or ("development" if settings.is_dev else "production")


def init_sentry(dsn, environment, **overrides):
    """Start reporting when a DSN is configured; with none, nothing is initialised or sent. Returns whether it started."""
    if not dsn:
        return False
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        send_default_pii=False,
        traces_sample_rate=0.1,
        max_request_body_size="never",
        include_local_variables=False,
        before_send=scrub_event,
        before_send_transaction=scrub_event,
        **overrides,
    )
    return True
