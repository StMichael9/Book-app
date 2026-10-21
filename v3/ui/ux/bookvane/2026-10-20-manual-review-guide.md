# V3 manual UI review

Use `codex/v3-ux-simplification` / draft PR #22 against an isolated development backend. This guide does not authorize production deployment or database changes. Final application SHA and executed results are in the implementation report.

1. **Landing and return:** signed out or in a private window, open `/`. Expect Your personal reading home, Explore books and optional registration. Sign in to a reading-enabled account and open `/`: expect `/home`, without briefly seeing marketing. On an older/disabled V3 backend, verify the existing library fallback. Direct book and import links must retain their intended destination through sign-in.
2. **A note, without friction:** open a current book, Add a note, type a temporary thought and Close. Expect no dialog, request, skeleton or document reload. Continue draft should restore it. Go to My Books, open another book, then return: only the original book has that draft. Save should persist it; a failed save should retain it.
3. **Progress and versions:** edit one progress value, Close and reopen. Change Own/Want while editing; values must remain. If this makes the saved version newer, Save must refuse an overwrite and keep the draft. Load saved version is an explicit replacement action; preserve text before using it. Zero and 100% must not automatically Finish.
4. **Session safety:** do not enter real private writing for this check. Logout/account expiry and a different login must clear session drafts, even if entry IDs coincide. Refresh with an unsaved draft should offer a native exit warning; accepting loses the temporary draft, cancelling keeps it. Ordinary internal navigation must not warn.
5. **Reading desk versus collection:** Home leads with current reads. Choose next reveals the optional full chooser; after Finish the saved finish remains valid even if choices fail. My Books has search and All/Reading/Want/Finished, plus additional filters. Own/Want stay independently accessible in the workspace. Check a paused reading, past reading and private entry.
6. **Phone/Safari:** on a physical iPhone, test the first book tap on both landing and Discover, including a slow detail response. Expect the correct detail and visible title, not the page bottom. Test note/progress focus, the keyboard, bottom navigation and both themes. Automated Chromium touch emulation is not a substitute for this check.
7. **Import:** use a synthetic or explicitly approved file in development. Verify the four-stage presentation, mapping/review exceptions, consent, resume and cancellation truthfulness. Already committed books must survive cancellation. Fresh native-export acceptance remains a separate release gate; this guide does not waive it.
8. **Comfort and accessibility:** try 320/390/768/1440 widths, enlarged text and OS Reduce Motion. Navigate with Tab/Shift+Tab/Enter/Escape. Inputs, Close/Save, dialogs and navigation must stay visible and understandable. Check a missing cover, long title, empty library, failed catalogue request and slow startup.

Collect what the reader attempted, where they hesitated, whether they completed it unassisted, and their actual words. Do not coach before observing. This is reader feedback, not a conversion-rate experiment or a release certification.

## October 21 collection follow-up

- On a phone, find the first saved book without scrolling past a large introduction. Search and import should remain easy to find; the four primary filters share a row at normal text size and reflow to wider controls at enlarged text size.
- Search/filter an existing library, move to a later page, open a title or cover and use Back to My Books. Expect the same query/filter/label/page. Open older reading history and verify the return still works.
- Previous page selects a known library page, rather than sending you into the workspace. Direct or refreshed later-page URLs have Return to first page; they cannot reconstruct an unknown previous cursor. Search/filter context must remain when returning to the first page.
- Click Next from the bottom of a long library: expect the collection heading and the new books to be visible, rather than the footer. Move focus while a response is pending; completion must not steal it.
- Check missing/broken covers and private entries: one visible title/author, understandable cover-unavailable label, unchanged access to the workspace.
- Sign out/expire the session and sign into a different test account: old navigation metadata must not recover the former account's query/cursor.

The grid and filter names remain available for comparative reader testing; no row-layout preference is imposed by this patch.
