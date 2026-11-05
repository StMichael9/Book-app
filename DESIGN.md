---
name: Bookvane
description: A calm, private reading home on ivory paper, with book spines as the shared unit.
colors:
  paper: "#faf8f2"
  panel: "#ffffff"
  wash: "#f0eee5"
  hero: "#e8ebe0"
  ink: "#202e28"
  muted: "#59675e"
  line: "#d8ddd3"
  control: "#7e8c80"
  green: "#28513f"
  on-green: "#fffdf5"
  soft-green: "#e7ede3"
  rust: "#9c432d"
  danger: "#9b2f32"
  paper-dark: "#1e1d1b"
  panel-dark: "#262523"
  wash-dark: "#2e2c29"
  hero-dark: "#2b2926"
  ink-dark: "#ebe8e1"
  muted-dark: "#b6b1a9"
  line-dark: "#4b4741"
  control-dark: "#8c867d"
  green-dark: "#a9c9b3"
  on-green-dark: "#1e1d1b"
  soft-green-dark: "#30332f"
  rust-dark: "#d9826c"
  danger-dark: "#f0a39e"
  cloth-green: "#28513f"
  cloth-rust: "#9c432d"
  cloth-ink-blue: "#2f4a6b"
  cloth-mustard: "#b8862b"
  cloth-plum: "#6b3f5e"
  cloth-sage: "#5f7d66"
  cloth-ink-light: "#fffdf5"
  cloth-ink-white: "#ffffff"
  cloth-ink-dark: "#1a251f"
typography:
  page:
    fontFamily: "Bookvane Lora, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 500
    lineHeight: 1.2
  section:
    fontFamily: "Bookvane Lora, Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 500
    lineHeight: 1.2
  card:
    fontFamily: "Bookvane Lora, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 500
    lineHeight: 1.25
  body:
    fontFamily: "Bookvane Sans, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Bookvane Sans, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.3
  helper:
    fontFamily: "Bookvane Sans, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  spine: "1px"
  slot: "3px"
  cover: "4px"
  control: "6px"
  panel: "8px"
  card: "10px"
  sheet: "16px"
  pill: "24px"
  full: "50%"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "28px"
  "8": "32px"
  "9": "36px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.on-green}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 22px"
    height: "48px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 22px"
    height: "48px"
  button-secondary-hover:
    backgroundColor: "{colors.wash}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "48px"
  button-saved:
    backgroundColor: "{colors.soft-green}"
    textColor: "{colors.green}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 22px"
    height: "48px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 22px"
    height: "48px"
  button-danger-outline:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 22px"
    height: "48px"
  link-tertiary:
    textColor: "{colors.green}"
    typography: "{typography.label}"
    height: "44px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "11px 13px"
    height: "50px"
  list-card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "10px"
  privacy-pill:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.muted}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "4px 8px 4px 16px"
  dialog:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "28px"
  avatar:
    backgroundColor: "{colors.cloth-green}"
    textColor: "{colors.cloth-ink-light}"
    rounded: "{rounded.full}"
    size: "96px"
  book-cover:
    backgroundColor: "{colors.wash}"
    rounded: "{rounded.cover}"
---

# Design System: Bookvane

## Overview

**Creative North Star: "The Bookcloth Shelf"**

Bookvane is a reading home printed on ivory paper. The page is quiet: warm off-white grounds, a deep green-black ink, hairline rules in a pale sage grey, and one restrained green for the action that matters. The only saturated material is bookcloth: six cloth colours that dress avatars, spines and coverless books, so colour always means "a book" or "a reader", never decoration for its own sake.

The shared unit is the book spine. A book with artwork sits in a 2:3 frame; a book without it becomes a typographic jacket with a spine stripe down its left edge, a bookcloth spine block in list artwork, or a single spine standing on the year shelf. Wherever a book appears, it is never a blank tile or a letter tile.

Density is calm and one-handed: a single reading column on phones with a 20px gutter and 44px+ tap targets, with the profile as one centred 720px column (header, tabs, panels and account rows) and a 1240px container elsewhere. Lora carries names and headings at three sizes; Source Sans carries everything else. Light and dark themes share every rule; dark mode swaps the paper for warm charcoal and lifts the greens to a pale sage.

**Key Characteristics:**
- Ivory paper (light) and warm charcoal (dark), with ink-green text and hairline sage rules.
- Six bookcloth colours as the only saturated material, each paired with a contrast-checked ink.
- The book spine as the signature: jacket stripe, list-art spine block, year-shelf spine.
- Lora at three sizes for names and headings; Source Sans for body, labels and helper text.
- One filled action per view; everything else is outlined, quiet, or a single underlined green link.
- Motion is a 140–240ms acknowledgement, never a performance, and is removed under reduced motion.

## Colors

A paper-and-ink palette with one working green, one rust for focus and warmth, and six bookcloth colours reserved for books and readers.

### Primary
- **Bookbinder Green** (`green`; pale sage `green-dark` in dark mode): the action colour. Filled primary buttons, the tertiary link, the active nav tab, checked picker tiles, the saved-shelf state, checkbox accents. Its partner `on-green` is the warm ivory text on a filled green button.
- **Soft Green Wash** (`soft-green`): the tint behind a saved toggle, a notice, the guest join panel and checked tiles.

### Secondary
- **Rust** (`rust`; `rust-dark` in dark mode): the focus ring (3px solid, 4px offset) on every interactive element, and the rust jacket tint. It is a signal colour, not a fill.

### Tertiary: Bookcloth
The six cloths, fixed hex values that do not change between themes:
- **Green cloth** (`cloth-green`, the default avatar), **Rust cloth** (`cloth-rust`), **Ink Blue cloth** (`cloth-ink-blue`), **Mustard cloth** (`cloth-mustard`), **Plum cloth** (`cloth-plum`), **Sage cloth** (`cloth-sage`).

Each cloth's ink is chosen by measured contrast, in a fixed order: the warm light ink (`cloth-ink-light`) if it reaches 4.5:1 on the cloth, otherwise plain white (`cloth-ink-white`), otherwise the dark ink (`cloth-ink-dark`). In practice green, rust, ink blue and plum take the warm light ink, sage takes plain white (warm light falls just short of 4.5:1), and mustard takes the dark ink.

### Neutral
- **Ivory Paper** (`paper` / `paper-dark` charcoal): the page ground, header and fixed mobile nav.
- **Panel White** (`panel` / `panel-dark`): cards, dialogs, sheets, inputs and the search field.
- **Linen Wash** (`wash` / `wash-dark`): quiet fills: the privacy pill, tab counts, tags, skeletons, empty cover frames, hover on secondary and quiet buttons.
- **Hero Sage** (`hero` / `hero-dark`): the large display panels behind hero covers, book detail art and the auth story.
- **Ink** (`ink` / `ink-dark`): body text, the 3px shelf baselines, toasts (as a fill, with paper text).
- **Muted Ink** (`muted` / `muted-dark`): secondary text, helper lines, month initials, icons in facts lists.
- **Hairline** (`line` / `line-dark`): dividers, card borders, row rules, disabled borders.
- **Control Grey** (`control` / `control-dark`): input and secondary-button strokes, the outlined empty-list spine.
- **Danger** (`danger` / `danger-dark`): destructive actions and field errors (with a 3px left rule).

### Named Rules
**The Bookcloth Rule.** Saturated colour belongs to books and readers. The six cloths dress avatars, year-shelf spines and coverless list artwork, chosen by a stable hash so a book wears the same cloth everywhere it appears. They never fill buttons, banners or backgrounds.

**The Measured Ink Rule.** Text or glyphs on a cloth use the first ink in the order warm light, white, dark that reaches 4.5:1. Never hand-pick an ink for a cloth.

**The Charcoal Field Rule.** In dark mode, large surfaces stay charcoal (`panel-dark` with a hairline border); the pale green is kept for actions only.

## Typography

**Display Font:** Bookvane Lora (self-hosted Lora, 400–700; fallback Georgia, serif)
**Body Font:** Bookvane Sans (self-hosted Source Sans 3, 200–900; fallback Segoe UI, sans-serif)

**Character:** A bookish serif for names and headings over a plain, warm humanist sans for everything a reader acts on. The serif speaks; the sans works.

### Hierarchy
The type-scale tokens live on `:root` as `--bv-fs-page`, `--bv-fs-section`, `--bv-fs-card`, `--bv-fs-body` and `--bv-fs-helper`.
- **Page** (Lora 500, `--bv-fs-page`, 1.2): the page title, such as the reader's name on the profile.
- **Section** (Lora 500, `--bv-fs-section`, 1.2): section heads ("Your 2026", "Lists") and sheet titles.
- **Card** (Lora 500, `--bv-fs-card`, 1.25): list card titles and the guest join line.
- **Body** (Source Sans 400, `--bv-fs-body`, 1.5): all running text. The root sets 1.0625rem on desktop and 1rem under 700px. Long prose is held to 70ch.
- **Label** (Source Sans 600, `--bv-fs-body`): buttons, links, field labels, picker legends.
- **Helper** (Source Sans 400, `--bv-fs-helper`, 1.45): one helper line per control, shelf month initials, card meta, the "+N" overflow on the shelf.

The jacket title and author scale with the cover's own width (container query units): title Lora 500 `clamp(9px, 12cqi, 26px)`; author Source Sans 600 small caps `clamp(8px, 6.5cqi, 14px)`.

### Named Rules
**The Three Lora Sizes Rule.** Lora appears at page, section and card size only. Everything else is Source Sans, at body size or helper size. Sizes come from the `--bv-fs-*` tokens, never one-off rem values.

**The Word-Break Rule.** Headings and buttons wrap between words (`overflow-wrap: break-word`); running text may break anywhere so enlarged text never overflows at 320px.

## Layout

- **Containers:** the main container is 1240px with 32px side padding (28px at 701–1050px, 20px under 700px, 16px under 350px). The profile is one centred 720px column from 1024px (header, tabs, panels and account rows share its left edge); a single list page stays 640px.
- **Rhythm:** spacing runs in 4px steps (4, 8, 12, 16, 20, 24, 28, 32, 36). Sections sit 36px apart on desktop and 25px on phones; profile sections end with 24–32px bottom margins.
- **Breakpoints:** 350px (smallest phones), 700/701px (phone to tablet; the mobile nav appears and sheets become bottom sheets), 1024px (profile column and taller shelf), 1050px (tablet tightening).
- **Phones:** a fixed bottom nav (70px plus safe area) with four items; the page pads 78px plus safe area at the bottom so content clears it. The nav hides while a text input has focus. Toasts sit above the nav.
- **Lists grid:** list cards are two across, falling to one when the lists area is narrower than 20.5rem (a container query, so it also responds to enlarged text).
- **Book grid:** five across on desktop, three on tablet, two on phones.

## Elevation & Depth

Bookvane is paper-flat. Depth is carried by tone (panel on paper, wash on panel) and hairlines; a single soft shadow token marks the few things that genuinely lift off the page. Small shadows exist only as state acknowledgements (hover, press, focus).

### Shadow Vocabulary
- **Lift** (`--bv-shadow`: `0 12px 24px #172e2219`; `0 12px 24px #0005` in dark): covers in hero and detail panels, dialogs and sheets, toasts.
- **Spine stripe** (`inset 5cqi 0 0` of the jacket ink at 14%): the jacket's spine; on list art `inset 5px 0 0` black at 20%; on shelf spines `inset 1.5px 0 0` warm light at 30%. These are the signature, not elevation.
- **Hover lift** (`0 2px 6px` ink at 8%): buttons on fine-pointer hover. Cover links take `0 10px 22px` ink at 14% on hover.
- **Press** (`inset 0 2px 3px #00000018`): a button while pressed.
- **Input focus halo** (`0 0 0 3px` green at 14%): alongside the rust focus ring on fields.
- **Selected** (`inset 0 0 0 2px green`): a checked picker tile; `inset 0 0 0 1px green` for the saved shelf button.

### Named Rules
**The Paper-Flat Rule.** Surfaces are flat at rest. Only covers on display, dialogs, sheets and toasts carry the lift shadow; everything else separates by tone and hairline.

## Shapes

Corners are gently rounded, and the radius grows with the size of the object: shelf spines 1px at the top only, list-art slots 3px, covers 4px, buttons and inputs 6px, panels and picker tiles 8px, list cards and dialogs 10px, phone bottom sheets 16px on the top corners only, the privacy pill 24px (20px on phones), chips 40px, and avatars fully round. Borders are 1px hairlines; the shelf baseline and the empty-list baseline are a deliberate 3px ink rule.

## Components

### Buttons
Tactile but quiet: solid shapes, no gradients, a single filled action per view.
- **Shape:** gently rounded (6px), at least 48px tall (44px in the header, pagination and compact shelf controls), 600 weight label with an optional 20px line icon.
- **Primary:** green fill, warm ivory label. Hover mixes 12% ink into the green.
- **Secondary:** transparent with a control-grey stroke; hover fills with wash.
- **Quiet:** text-only with tighter padding; hover fills with wash. Icon-only quiet buttons are at least 44px square.
- **Saved:** a chosen toggle: soft-green fill, green stroke plus a 1px inset green ring, green label (ink label in dark mode).
- **Danger / Danger outline:** outlined in management views; filled only on the final confirmation.
- **Disabled:** flat, transparent, muted label and hairline border, so it never resembles an available primary.
- **Motion:** background, border, colour and shadow transition over 150ms.

### Links
**The One Link Rule.** There is one tertiary link style: green, 600 weight, underlined with a 3px offset, at least 44px tall. Text-style buttons ("Edit profile", "Make public", "New list") and account rows use the same treatment.

### Inputs / Fields
- **Style:** panel fill, 1px control-grey stroke, 6px radius, at least 50px tall, 11px 13px padding. Label above in 600 weight; one helper line below in helper size and muted ink.
- **Focus:** the 3px rust focus ring plus a 3px green halo at 14%; border and halo transition over 150ms.
- **Error:** a danger message with a 3px danger left rule on a wash fill.

### Chips and Pills
- **Privacy pill:** a wash pill (24px) holding a muted 18px line icon, a muted sentence that wraps inside the pill, and a single tertiary link action. At 700px and below it becomes a two-row grid: the sentence on one line, the action centred on its own line. On desktop it is a single line with 16px padding on both sides.
- **Subject chips:** fully rounded, 44px tall; on phones they scroll horizontally behind a soft right-edge fade rather than wrapping.

### Cards / Containers
- **List card:** panel fill, 1px hairline, 10px radius, 10px padding (16px from 1024px); hover darkens the border to control grey. List artwork on top, card-size Lora title, helper-size meta with a 14px icon.
- **Panels:** 8px radius with a hairline border (preference panels, import confirmation, reading desk).

### Sheets and Dialogs
Native modal dialogs on panel fill with a hairline border, 10px radius, 28px padding (22px on phones) and the lift shadow; they fade up 6px over 180ms. The backdrop is a translucent deep green (near-black in dark). Under 700px a profile sheet becomes a full-width bottom sheet with 16px top corners and safe-area padding; its actions pin to the bottom as a sticky bar with a hairline top rule, so they sit in the thumb zone.

### Navigation
- **Desktop:** a 84px header on paper with a hairline bottom rule; Lora wordmark with the logo; 600-weight nav links, the active one green with a 2px green underline.
- **Phones:** a fixed four-item bottom nav (Home, Discover, My Books, You), 12px labels under 21px icons, muted at rest and green and bold when active. The You item shows the reader's avatar; labels wrap between words rather than truncating.

### Tabs
The profile's Overview · Lists · Year switcher. A wash track with equal segments (`flex: 1 1 0`, never narrower than the label), the selected segment raised as a pill: panel white in light, a lift of 12% ink over the wash in dark, so it always reads above the track. It is a real ARIA tablist: arrow keys move, Home/End jump, and the selection lives in `?tab=` so Back and links work. Labels never wrap or truncate, at 320px or 200% text. The incoming panel settles over 160ms on a switch, never on first load.

### Avatar
A round bookcloth disc with a single line icon, chosen from twelve (open book, coffee cup, cat, feather, moon, leaf, lamp, glasses, bird, mountain, sun, library). The glyph is 44% of the diameter, with a 2px stroke at 32px and below and 1.75px above. The disc's ink follows the Measured Ink Rule. Sizes: 96px in the centred profile header and the edit-sheet preview, small in the header and mobile nav. With no icon chosen it shows the reader's initials, else an open book. It is decorative; the name beside it identifies the reader. A changed avatar crossfades over 200ms; the first paint never animates. The picker is a four-column icon grid and a two-column colour grid of 48px tiles; the checked tile gets a green stroke and 2px inset ring.

### Book Cover and Typographic Jacket (signature)
Every book image sits in a 2:3 frame with a 4px radius on a wash ground. While artwork loads, or when none exists, the cover is a typographic jacket: one of five tints derived from the palette (sage, ivory, rust, forest, ink) chosen by a stable hash of the title, a spine stripe down the left edge (an inset band at 14% of the jacket ink plus a 1px hairline at 22%), the title in Lora and the author in small caps above a hairline. Type scales with the cover's own width; under 96px the author drops, under 48px only tint and spine remain. The jacket under loading art waits 180ms then fades in over 160ms, so fast covers never flash text; cached covers paint at once.

### List Artwork
Up to four covers side by side in 2:3 slots (3px radius, 2px gaps) on a 64px strip (96px on a list page, 120px on the desktop hub). A slot with no art is a bookcloth spine block: the book's cloth with a 5px inset spine shade and a 1px warm-light hairline at 8px. An empty list shows one outlined spine standing on a 3px ink baseline. Loaded covers fade in over 160ms.

### Year Spine Shelf
The reader's year as a shelf: twelve month columns on a 3px ink baseline, 96px tall (140px on the desktop hub), with helper-size month initials beneath (the biggest month in bold ink). Each finished book is one spine in a bookcloth colour with a stable height between 78% and 100%, a 1.5px warm-light edge and a 1px band near the top. Spines are at least 4px wide on phones and 8px on desktop; when a month has more books than fit, the extra show as a muted "+N" above the column. Spines rise from the baseline once per page load (240ms, staggered 20ms per month). The shelf is decorative; a screen-reader list carries the counts.

### Motion
Every state change gets one quiet acknowledgement between 140ms and 240ms, ease-out: button state 150ms, details disclosure 140ms, jacket and artwork fade 160ms, dialog rise 180ms, avatar crossfade 200ms, tab panel settle 160ms (switches only), spine rise 240ms. Nothing bounces. Under `prefers-reduced-motion` every animation and transition is removed.

## Do's and Don'ts

### Do:
- **Do** use the `--bv-*` tokens for every colour so light and dark follow automatically; the six bookcloth hexes are the only fixed colours.
- **Do** render every book through the 2:3 cover frame, falling back to the typographic jacket or a bookcloth spine block.
- **Do** keep one filled primary button per view and make the rest secondary, quiet or the single tertiary link.
- **Do** take type sizes from the `--bv-fs-*` tokens, Lora at page, section or card size only.
- **Do** give every interactive element at least 44px of height and the 3px rust focus ring.
- **Do** choose cloth ink by the Measured Ink Rule.
- **Do** pin sheet actions to the bottom on phones and clear the fixed nav and safe area.

### Don't:
- **Don't** show a book as a blank tile, a letter tile or "cover unavailable" text.
- **Don't** use bookcloth colours for buttons, banners or page backgrounds.
- **Don't** add a second filled primary to a view.
- **Don't** introduce one-off rem font sizes or a fourth Lora size.
- **Don't** add bounce, confetti or animation that runs under reduced motion.
- **Don't** use shadows on resting surfaces other than displayed covers, dialogs, sheets and toasts.

### Known drift (recorded, not part of the system)
- **Legacy button classes.** Older screens outside the current UI layer still use `primary-button`, `reset-button` and `icon-button` (sign-in, password recovery, preferences, search bar, header, landing). New work uses only the `bv-button` variants.
- **Pre-token type sizes.** The type-scale tokens are consumed only by the profile area so far. The base `h1` (2.75rem) and `h2` (1.8125rem), the landing hero heading (3.625rem) and many component sizes elsewhere are still one-off rem values.
- **Eyebrow labels.** An uppercase rust eyebrow style exists and is used above the landing hero heading and as an optional page-heading slot. It is a carried defect, not a pattern to reuse.
- **Literal light tints.** Spine and jacket highlights use the literal warm light `#fffdf5` and black rather than a token.
