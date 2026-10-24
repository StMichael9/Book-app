# V3 release fix 4c: library CSV download on My Data

23 October 2026. Branch `ui/v3-my-data-export` from `v3` (2283e0e, which includes #36 and #47). This is fix 4c from `.local-dev/V3-RELEASE-FIXES-PLAN.md`.

## Change

My Data (`/my-data`) now offers two downloads under "Download my data", each labelled in plain language.

**Library spreadsheet (CSV): Download library (CSV)**
- "Your books with Want to read and Owned, reading statuses, dates, page details and reading notes, in one table. Opens in Excel, Numbers or Google Sheets."
- It uses #36's `getLibraryCsvExport()` (`GET /me/library/export.csv`) and is gated only on `library.libraryExport`, so it works with the import pilot switched off.
- The file name comes from `Content-Disposition` (`bookvane-library-v1.csv`). An empty file is treated as a failure.
- It has its own pending, status and error states, separate from the JSON download.

**Complete private copy (JSON): Download complete copy (JSON)**
- This is the existing JSON Lines backup with unchanged behaviour (footer check, truncation rejected).
- It is relabelled from "Download my data" so the two choices are distinct.

**Access:**
- My Data and the Account page's "Your reading data" row are now reachable when only `library_export` is on.
- Both download buttons are secondary, so neither format is presented as the default.

## Verification (executed)

| Check | Result |
|---|---|
| New test: `4c library CSV downloads from My Data with import switched off, and failures are explained` | Passed. Account → Manage my data works with only `library_export` on. The JSON button is absent. A 503 shows the alert with no download. A retry downloads `bookvane-library-v1.csv` with a status message. No import endpoints are called. |
| Existing JSON export tests (renamed button) | Passed |
| Full mocked suite (Edge), holding the 5189 lock | **304 passed, 0 failed** |
| Lint / build | Exit 0, 12 warnings (unchanged) / passed |

The mocked CSV body is a fixture; the real export's columns are #36's responsibility. **Not run:** the real API journey, WebKit, devices.
