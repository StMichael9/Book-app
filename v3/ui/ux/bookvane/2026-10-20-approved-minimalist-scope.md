# V3 minimalist refinement — approved scope and decisions

20 October 2026. This records approved implementation scope, not a new proposal.

Michael authorized the October 20 minimalist plan with final amendments and explicitly retained UI ownership of frontend files. The lead's active guarded catalogue import is a separate repository/workstream. Coordination was recorded in [issue #21](https://github.com/StMichael9/Book-app/issues/21#issuecomment-6306497223).

## Decisions that govern this implementation

- Preserve colours, typefaces, editorial style, logo and the existing app destinations. Refine the active V3 frontend rather than redesigning it or editing retained legacy App.jsx.
- Guests see the public landing at `/`. Signed-in reading-enabled accounts go directly to `/home`. Wait for authentication and capabilities before deciding, so returning readers do not see a marketing flash. Existing safe book/save/import return intents take priority after authentication. The earlier research recommendation to show marketing to everyone at `/` is **superseded**.
- Close note/progress forms locally. Keep unsaved values in memory through internal navigation, keyed by authentication generation, library entry, reading attempt and field type. Clear on session/account departure and document refresh. Save remains explicit; original versions are retained. No local/session storage, autosave or version rebasing.
- Warn through native beforeunload only when document exit risks losing unsaved work. Ordinary internal navigation and Close do not prompt. Pending saves cannot be hidden by Close. Failed/conflicting writes preserve the draft; only explicit saved-version recovery replaces it. Confirmed book/reading deletion clears only the affected drafts; failures retain them.
- Progress edits belong in My reading; notes belong in My note. Historical editors retain captured dates/state identity. Direct Own/Want flags remain independent of reading state. Existing deletion, reread, privacy and read-only guards remain.
- Home leads with current reading and offers a quiet next-read preview; full choices are disclosed on request or after a saved Finish. My Books retains collection search, four visible filters (All, Reading, Want, Finished) and additional filters. These defaults remain hypotheses for reader feedback.
- Preserve existing discovery API semantics. A unified title/author search or automatic external lookup is not silently implemented through a misleading placeholder. External matching/persistence and bulk-import lookups remain separate contracts.
- Present import as Choose file → Review → Import → Results. Preserve source inspection, mapping, uncertainty, consent, existing-data preservation, limits, seven-day resumption and partial cancellation semantics. Rename the ordinary cancellation action to Cancel import without changing its behavior.
- Prefer CSS colour/shadow/opacity transitions. Respect reduced motion and retain native disclosures, DOM identity, focus and stable layout. No framework or dependency additions.
- Verify the final frozen application commit; distinguish real executed checks from unavailable engines and physical-device acceptance.

## Deliberate landing implementation choices

The existing real-cover hero is retained rather than replaced with a fabricated dashboard or an inert interactive-looking mockup. Clear V3 copy, a short book selection, three reader benefits and a final registration invitation communicate the experience. Landing cards open books without a repeated Own/Want toolbar; those actions remain in Discover and book details. Guest navigation stays small, and account-free exploration remains available. Existing signed-in app navigation and brand destination are preserved.

The page does not promise native apps, social features, AI, a full-text ebook reader, unverified migration formats, user counts or testimonials. Import remains findable through existing capability-gated account/library actions; no public import promise is added before its remaining acceptance gates are satisfied.

## Boundaries

No backend, database, schema, auth-context, main.jsx, hosting, production or catalogue-import changes. No merge authorization is inferred from this UI implementation. No private real-account data, notes or files enter previews or screenshots. New reports go here; historical reports are not relocated.
