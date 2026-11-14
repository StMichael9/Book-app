---
name: Bookvane
description: A calm, private reading home on ivory paper, framed by bookcloth at its two front doors, with book spines as the shared unit.
colors:
  paper: "#f3eee3"
  sheet: "#fdfaf3"
  raised: "#ffffff"
  ink: "#1f2a24"
  muted: "#5d665f"
  line: "#e2dccd"
  control: "#7e8c80"
  green: "#28513f"
  on-green: "#fffdf5"
  soft: "#e6e9dd"
  rust: "#9c432d"
  danger: "#9b2f32"
  band: "#28513f"
  on-band: "#f6efdf"
  band-muted: "#c9d6c4"
  paper-dark: "#16130f"
  sheet-dark: "#2f2a23"
  raised-dark: "#3b352c"
  ink-dark: "#f0e9dc"
  muted-dark: "#bdb3a3"
  line-dark: "#3f382f"
  control-dark: "#8c867d"
  green-dark: "#b9d3bf"
  on-green-dark: "#14201a"
  soft-dark: "#463f35"
  rust-dark: "#d9826c"
  danger-dark: "#f0a39e"
  band-dark: "#1d3a2d"
  on-band-dark: "#efe7d6"
  band-muted-dark: "#a9bfae"
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
  display:
    fontFamily: "Bookvane Caslon, Georgia, serif"
    fontSize: "clamp(2.25rem, 6vw, 3.5rem)"
    fontWeight: 400
    lineHeight: 1.05
  page:
    fontFamily: "Bookvane Caslon, Georgia, serif"
    fontSize: "clamp(2rem, 5vw, 2.75rem)"
    fontWeight: 400
    lineHeight: 1.08
  section:
    fontFamily: "Bookvane Caslon, Georgia, serif"
    fontSize: "clamp(1.75rem, 3.5vw, 2.125rem)"
    fontWeight: 400
    lineHeight: 1.1
  title:
    fontFamily: "Bookvane Caslon, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
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
  field: "10px"
  sheet: "16px"
  pill: "999px"
  full: "50%"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.on-green}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-quiet:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-on-band:
    backgroundColor: "{colors.on-band}"
    textColor: "{colors.band}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-green}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  link-tertiary:
    textColor: "{colors.green}"
    typography: "{typography.label}"
    height: "44px"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "11px 14px"
    height: "50px"
  sheet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "20px"
  chip:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "40px"
  chip-selected:
    backgroundColor: "{colors.green}"
    textColor: "{colors.on-green}"
  band:
    backgroundColor: "{colors.band}"
    textColor: "{colors.on-band}"
  dialog:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "28px"
  avatar:
    backgroundColor: "{colors.cloth-green}"
    textColor: "{colors.cloth-ink-light}"
    rounded: "{rounded.full}"
    size: "96px"
  book-cover:
    backgroundColor: "{colors.soft}"
    rounded: "{rounded.cover}"
---

# Design System: Bookvane

**Status:** direction E ("Cloth frames"), chosen by Michael on 14 Nov 2026 from the Phase 0 board, with Libre Caslon Display for headings and pill buttons. This file replaces the earlier "Bookcloth Shelf" system. Every visual decision below is made once; changes need Michael's approval.

## Overview

**Creative North Star: "Cloth Frames"**

Bookvane is a reading home printed on ivory paper, bound in green cloth at its two front doors. The page is quiet: warm ivory grounds, a deep green-black ink, sections that sit on soft sheets one step lighter than the page, and one green for the action that matters. The only saturated material is bookcloth. A full-width cloth band frames the top of Home and My Books, the two places a reader comes back to. Everywhere else, and behind every cover, is paper.

The shared unit is still the book. A book with artwork sits in a 2:3 frame; a book without it becomes a typographic jacket with a spine stripe, a bookcloth spine block in list artwork, or a single spine on the year shelf. A book's own colours are never competed with: no cover ever sits on cloth.

Libre Caslon Display carries headings and book titles at large, generous sizes with tight leading; Source Sans carries everything a reader reads closely or acts on. Buttons and chips are pills. Light and dark share every rule; dark mode is warm ink-brown in three surface steps, with the cloth deepened to a forest green.

**Key Characteristics:**
- Ivory paper (light) and warm ink-brown (dark), green-black ink, no borders around sections.
- A bookcloth band at the top of Home and My Books only.
- Sections separate by tone: sheets one step lighter than the page, at most a soft warm shadow.
- Libre Caslon Display for headings and titles; Source Sans 3 for everything else.
- Pill buttons and chips; one filled action per view.
- Covers carry the colour; the interface stays calm around them.

## Colors

A paper-and-ink palette with one working green, a cloth band for two pages, a rust focus ring, and six bookcloth colours reserved for books and readers.

### Primary
- **Bookbinder Green** (`green`; pale sage `green-dark` in dark mode): the action colour. Filled primary buttons, the tertiary link, the selected chip and tab, progress fills, checked controls. `on-green` is the ivory label on it.
- **Soft** (`soft` / `soft-dark`): the quiet fill. Quiet buttons, unselected chips, the progress track, the search field, skeletons, empty cover frames.

### The Cloth Band
- **Band** (`band`, deepened to `band-dark` in dark mode): the full-width cloth at the top of Home and My Books. It holds the header, the greeting or page title, and on My Books the shelf tabs.
- **On band** (`on-band`): text, the wordmark, the active nav link, the filled button and the selected tab on the band.
- **Band muted** (`band-muted`): secondary text and inactive nav links on the band (5.6:1 light, 6.3:1 dark).

### Secondary
- **Rust** (`rust` / `rust-dark`): the focus ring on every interactive element (3px solid, 3px offset). A signal, never a fill. On the band the ring is `on-band`.

### Tertiary: Bookcloth
Six fixed cloths, the same in both themes: green, rust, ink blue, mustard, plum, sage. They dress avatars, year-shelf spines and coverless books by a stable hash, so a book wears the same cloth everywhere. Each cloth's ink is chosen by measured contrast in the order warm light, white, dark (the first to reach 4.5:1).

### Neutral
- **Paper** (`paper` / `paper-dark`): the page ground, the header off the band, and the phone nav.
- **Sheet** (`sheet` / `sheet-dark`): sections, the current-read card, dialogs, the get-a-copy panel. In dark mode it sits 1.30:1 above the page so it reads without an outline.
- **Raised** (`raised` / `raised-dark`): inputs, menus and anything that sits on a sheet.
- **Ink** (`ink` / `ink-dark`): text, the 3px shelf baseline, toasts as a fill.
- **Muted** (`muted` / `muted-dark`): secondary text and helper lines (5.7:1 light, 6.9:1 dark on sheet).
- **Line** (`line` / `line-dark`): dividers inside lists only.
- **Control** (`control` / `control-dark`): input strokes and the outline button (3:1 or more on sheet).
- **Danger** (`danger` / `danger-dark`): destructive actions and field errors.

### Named Rules
**The Cloth Frame Rule.** The cloth band appears at the top of Home and the top of My Books, and nowhere else. Later the welcome screen and the year recap may use it, with Michael's approval. It never fills a button, a card, a banner or a book page.

**The Paper Under Covers Rule.** A cover, jacket or spine never sits directly on the cloth band. On Home the current read lives on a paper sheet that rests on the band's lower edge; on My Books every card is below the band.

**The Bookcloth Rule.** Apart from the band, saturated colour belongs to books and readers.

**The Measured Ink Rule.** Text on any cloth uses the first ink in the order warm light, white, dark that reaches 4.5:1. Never hand-pick an ink.

## Typography

**Display Font:** Bookvane Caslon (self-hosted Libre Caslon Display, 400; fallback Georgia, serif). Open Font Licence.
**Body Font:** Bookvane Sans (self-hosted Source Sans 3, 400–700; fallback Segoe UI, sans-serif).

**Character:** a classic book-face for names and titles, set large and tight, over a plain, warm humanist sans for everything a reader acts on. Caslon speaks; the sans works.

### Hierarchy
Tokens: `--bv-fs-display`, `--bv-fs-page`, `--bv-fs-section`, `--bv-fs-title`, `--bv-fs-body`, `--bv-fs-helper`.
- **Display** (Caslon 400, clamp 36–56px, 1.05): the Home greeting and the book page title.
- **Page** (Caslon 400, clamp 32–44px, 1.08): page titles ("My Books", "Discover", the profile name) and the current read's title.
- **Section** (Caslon 400, clamp 28–34px, 1.1): section heads ("Up next", "Your 2026").
- **Title** (Caslon 400, 17px, 1.25): book titles under covers and list titles.
- **Body** (Source Sans 400, 16–17px, 1.5): running text, held to 65–70ch.
- **Label** (Source Sans 600): buttons, links, field labels, chips, nav.
- **Helper** (Source Sans 400, 14px, 1.45): author lines, card meta, shelf months, one helper line per control.

Headings use `text-wrap: balance` and tracking of -0.01em. Book descriptions, notes and thoughts are Source Sans; a quoted thought on Home may use Caslon at 20px.

### Named Rules
**The Caslon Floor Rule.** Caslon is never smaller than 17px, and never bold: the display cut has one weight. Anything smaller or heavier is Source Sans.

**The No Eyebrow Rule.** No small or uppercase label above a heading ("Reading now", "Your last thought"). The heading carries its own weight.

**The Word-Break Rule.** Headings and buttons wrap between words; running text may break anywhere, so 200% text never overflows at 320px.

## Layout

- **Two widths:** the app column is 1120px; reading and settings columns are 680px. Side padding is 40px from 900px, 20px below it, 16px under 350px.
- **The band:** full width, its content on the app column. On Home it holds the header and greeting, and the current-read sheet overlaps its lower edge by 96px. On My Books it holds the header, the page title and the shelf tabs, ending 28px below the tabs.
- **Rhythm:** 4px steps (4, 8, 12, 16, 20, 24, 32, 40, 48). Sections sit 40px apart; more space above a heading than below it.
- **Breakpoints:** 350px, 700px (phone nav and bottom sheets), 900px (desktop header, wider grids).
- **Phones:** the fixed four-item bottom nav (Home, Discover, My Books, You) stays; the page pads for it and the safe area.
- **Book grids:** six across on Home's Up next on desktop and three on phones; five across in My Books on desktop and two on phones.

## Elevation & Depth

Surfaces separate by tone first. A sheet is one step lighter than the page (light) or 1.30:1 above it (dark). Borders around sections are not used.

### Shadow Vocabulary
- **Sheet** (light only): `0 1px 2px #3a2a1410, 0 2px 8px #3a2a140a`. None in dark mode, where lightness does the work.
- **Lift** (`0 1px 2px #3a2a1412, 0 8px 24px #3a2a1414`; dark `0 10px 30px #0000005c`): the current-read sheet on the band, dialogs, menus, toasts.
- **Cover** (`0 1px 2px #0002, 0 6px 16px #2a1a0a1f`): every cover and jacket.
- **Spine stripe:** the jacket's inset spine band, as before. It is the signature, not elevation.
- **Press:** a button darkens 8% while pressed. No inset shadows.

### Named Rules
**The Sheets Not Borders Rule.** Sections are sheets on paper with no outline. Hairlines appear only between rows inside a list.

## Shapes

Covers 4px, list-art slots 3px, shelf spines 1px at the top. Fields 10px. Sheets, dialogs and phone bottom sheets 16px. Buttons, chips, tabs and the search field are full pills. Avatars are round.

## Components

### Buttons
- **Shape:** full pill, 48px tall (44px in the header and compact rows), 600 label, 22px side padding.
- **Primary:** green fill, ivory label. One per view.
- **Quiet:** soft fill, ink label. The everyday secondary action.
- **Outline:** a 1.5px control stroke, for actions that leave the page ("Find it at a bookshop").
- **On the band:** ivory fill with a band-green label for the main action, and an ivory-at-12% fill for the rest.
- **Danger:** outlined in management views; filled only on the final confirmation.
- **Disabled:** soft fill, muted label.
- **Motion:** background and colour 150ms ease-out.

### Links
**The One Link Rule.** One tertiary link style: green, 600, underlined with a 3px offset, at least 44px tall. "See all" and "Reading life" beside section heads are the same link without the underline at rest.

### Inputs
Raised fill, 1px control stroke, 10px radius, 50px tall. The label sits above; one helper line below. Focus shows the rust ring. Errors show a danger message under the field.

### Chips and Tabs
- **Chips** (genres, filters): soft pills, 40px tall; selected is green with an ivory label.
- **Shelf tabs** (My Books, on the band): ivory-at-12% pills with on-band text and a quiet count; the selected tab is an ivory pill with band-green text. They scroll sideways on phones. A real tablist.
- **Profile tabs:** the same pill tabs on paper (soft, selected green).

### Sheets
- **Current read** (Home): a sheet with the lift shadow, cover left, title at page size, author, progress line and bar, then "Log progress" (primary) and "Finished" (quiet).
- **Sections** (Your year, Last thought, Get a copy): sheet fill, 16px radius, 20px padding (32–36px on desktop).

### Dialogs and Sheets
Native dialogs on sheet fill, 16px radius, 28px padding, lift shadow, a 6px rise over 180ms. Under 700px they become bottom sheets with actions pinned in the thumb zone.

### Navigation
- **Desktop header:** the Caslon wordmark, then Home, Discover and My Books in 600, the active one in ink (on-band on the band); the search field as a soft pill, then the avatar. On paper pages the header has no rule.
- **Phones:** the slim logo bar that hides on scroll down, and the fixed bottom nav.

### Book Cover and Typographic Jacket (signature)
Every book image sits in a 2:3 frame with a 4px radius and the cover shadow. With no artwork, the typographic jacket shows instead: a cloth tint by stable hash, a spine stripe, the title in Caslon and the author in small caps above a hairline, scaled to the cover's width. Covers never sit on the cloth band.

### Year Spine Shelf
Twelve month columns on a 3px ink baseline, each finished book a bookcloth spine. It sits on a sheet, never on the band. Beside it go two facts only, as quiet type, not tiles: "Average days to finish" and "Pages per reading day". Each has a calm line, approved by Michael, for when there isn't enough reading yet.

### Avatar, List Artwork
Unchanged from the previous system: round bookcloth discs with one line icon, and up to four covers on a strip with spine blocks for missing art.

### Motion
One quiet acknowledgement per state change, 140–240ms ease-out: buttons 150ms, disclosures 140ms, cover fade 160ms, dialog rise 180ms, spine rise 240ms once per load. Nothing bounces. Under reduced motion every animation is removed.

## Do's and Don'ts

### Do:
- **Do** take every colour from the tokens; the bookcloth hexes are the only fixed colours.
- **Do** keep the cloth band to Home and My Books.
- **Do** put every cover on paper or a sheet.
- **Do** separate sections by tone (sheets), not outlines.
- **Do** keep one primary button per view, as a pill.
- **Do** use Caslon at 17px or larger, Source Sans for everything else.
- **Do** give every control 44px or more and the rust focus ring.

### Don't:
- **Don't** put the cloth band on book pages, Discover, the reading page or Settings.
- **Don't** place a cover, jacket or spine on the cloth.
- **Don't** outline a section with a border.
- **Don't** add eyebrow labels above headings.
- **Don't** set Caslon below 17px or in bold.
- **Don't** add streaks, counts at peaks, confetti or bounce.

### Migration notes (from the previous system)
- Lora becomes Caslon for headings and titles; Lora is retired.
- `panel`, `wash` and `hero` become `sheet`, `soft` and the band; `soft-green` is retired.
- Button and chip radius moves from 6px and 24px to a full pill.
- Hairline borders on cards, panels and the header are removed in favour of sheets.
- The uppercase eyebrow style is removed.
