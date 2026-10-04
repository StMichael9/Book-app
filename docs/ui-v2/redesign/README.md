# Bookvane V2 · Full reader experience redesign

Open **gallery.html** for the design review or **index.html** for the responsive clickable prototype. Both work as local files in a normal browser. For local serving, run `python -m http.server 4175` in this folder and visit http://localhost:4175.

This is a design deliverable, not the deployed application. No React, API, account, catalogue, database, or reserved main file was changed. The working branch is `codex-ui`, based on the audited V2 code at `39ca688`. The other chat’s backend/authentication/library fixes remain intact.

## Review the core journey

1. Explore books from the welcome page.
2. Open a book, or choose Want directly on its card.
3. Create an account or sign in. Enter a sample email and password; this demo makes no network request and creates no real account.
4. The selected book appears on its chosen shelf. Move it between Want and Own, remove it, and open My Books.
5. Return to discovery, try Title/Author search, apply subjects, and change discovery preferences.

The top prototype controls jump between screens, switch themes, and reset demo state. The controls are outside the proposed product. `?capture=1` hides them. Prototype state lasts only for the current page session; do not enter real credentials. Share-image placement is a preview and does not generate or send an image.

## What is delivered

- 25 views/states at desktop and mobile sizes, in light and dark themes: 100 full-page PNGs and SVGs under `screens/`.
- Main-view viewport previews for comparing what users see first.
- Real published-edition reference cover compositions, the existing Bookvane mark, and bundled reading/UI fonts.
- Research, rationale, API constraints, and a proposed short reader test in `research-and-direction.md`.
- Offline native-layer import helper and scene data in `figma-import/`. This helper is syntactically checked but **has not run in Figma**; native wrapping, scrolling, and prototype reactions need verification there.
- Browser validation results in `visual-checks.json` and `interaction-checks.json`.

## Figma status

New file: https://www.figma.com/design/FvUVaxox6bprYbWozX5JUP

The file is currently **empty**. Creation succeeded, then Figma reported: “You've reached the Figma MCP tool call limit on the Starter plan.” Neither installation of another plugin nor retrying the same tools resolves that account limit. The verified design reference is this browser prototype and its PNG exports.

When access is restored, use the scene data to build and verify the native file. Alternatively, Figma desktop’s Development menu can create a local plugin. Keep the ID that Figma assigns, use this package’s `code.js` and `ui.html` as its main/UI files, and retain the other manifest settings. Run it in the design file, select `scenes.json`, choose devices/themes, and import. The provided manifest’s ID is a placeholder; do not treat it as a registered plugin ID. Import into a blank page, check the layouts, scroll behaviour, and links before sharing. The SVGs can also be dragged onto a Figma canvas as layout references; they are not a finished component library or wired prototype.

## Validation and limits

Browser checks covered 320, 390, 768, and 1440 pixels, all routes, missing images, page overflow, account/book context, exclusive Own/Want state, removing a saved book, author search, AND subject filters, preference-load failure, and password recovery. All passed. The render check covers 100 screen/theme/device combinations with no recorded script errors or horizontal page overflow.

Contrast tokens were checked numerically; this is not a claim of full WCAG compliance. Keyboard use, real screen readers, operating-system keyboards/safe areas, catalogue edge cases, actual authentication, live hosted performance, and native mobile packaging still need implementation-time validation. No prospective readers have tested this redesign yet.

To regenerate the scene exports: serve this folder on localhost:4175 and run `node export.cjs`. The exporter uses the workspace’s Playwright installation and Chromium; neither is required to use the prototype.
