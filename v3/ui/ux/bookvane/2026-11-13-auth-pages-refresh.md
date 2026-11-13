# November 13: Auth pages refresh

Sign-in, sign-up and password recovery (`AccountPages.jsx`). Frontend only; the approved wording table only.

- **Cover shelf:** the story panel is the landing hero's three covers on the same ink baseline (`.bv-hero-covers`, `.bv-shelf-rule`), from the snapshot or this browser's copy (no request). Decorative (`aria-hidden`, `alt=""`, new `decorative` prop on `BookCover`). A pending book stands alone, centred. One text line under the shelf, a paragraph, not a heading. Under 700 px a slim strip of the three covers (52 px) sits above the heading.
- **Flat form:** the shadow on `.bv-auth-card` is gone. One left edge; links inside sentences get their 44 px target from padding and negative margin.
- **Errors at the field:** own validation (`noValidate`); field errors under the field with `aria-invalid` and `aria-describedby`, focus to the first invalid field, typed values kept, an edit clears that field's error. Register 409 is an email error with Sign in and reset links that keep the query; login 401 is one message above the fields with a reset link; 422 is a password error on register and on reset; server `detail` strings are never shown. On reset only 400, 404 and 410 mean an expired link.
- **Small:** the email typed on sign-in reaches Forgot password through router state (not the URL); the mail medallion is gone.
- **Wording:** exactly the table Michael approved. Two judgement calls, flagged to the lead: an empty password on sign-in shows the approved "Use at least 8 characters."; the reset button still says "Working…" while pending (only the forgot-password button changed to "Sending…").
- **Known gap:** at 375 x 812 the submit button sits about 534 px (sign-in) and 523 px (sign-up) from the top with the strip, against the brief's 520. The spec guards 540.
