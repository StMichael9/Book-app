# Phase 0: anonymous event counters (frontend)

30 October 2026. Branch `ui/v3-event-beacons`, rebased on `origin/v3` (c915c6a, which has the server's `POST /events`). **Merges only after the Lead confirms T18 (the events endpoint) is live.**

- **Helper:** `trackEvent(name, { src, placement })` in `ui-v2/events.js` sends `navigator.sendBeacon(<API>/events, text/plain JSON)` inside a try/catch, and does nothing when sendBeacon is missing. It sends only the name plus, when the server knows it, a `src` (landing, noresults, saveprompt, share, import) or `placement` (book_page, want_card); the server drops a whole event with an unknown value. No cookies, IDs or account data. It always fires, with no flag.
- **Events:** `register_started` (first submit of the register form, with the URL's `src`); `save_prompt_shown` (guest save dialog opens); `guest_search_empty` (guest no-results panel, once per search); `get_copy_click` (book page link → `book_page`; Want cards and next-read links → `want_card`); `share_click`; `share_visit` (book page opened with `?src=share`).
- **Not done:** the register request does not pass `src` to the API (it sends only email and password), so the server can only count `register_completed` without a source unless it learns it another way. Left alone: that's an API contract question for the Lead.
- **Tests:** `tests/event-beacons.spec.js` (bodies, once-only, no failure when sendBeacon is missing or throws) and a `get_copy_click` placement test in `tests/get-a-copy.spec.js`. Lint 12 warnings.
