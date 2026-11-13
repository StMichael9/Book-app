# November 12: the "more" menu on My Books

Michael approved (12 Nov). Frontend only; builds on `ui/v3-mybooks-actions`.

- A three-dot button on every catalogue book in My Books, in Covers and List views. The menu holds exactly Add to list and Pin to Up next (Unpin when pinned), using the book page's own components through new props (`menu` on `AddToList`, `menuItem` on `PinToUpNext`). A short status confirms each action.
- The button is a sibling of the cover link, never inside it. Private books and read-only mode get no button.
- Quiet on covers for a mouse (faint until hover or focus), always fully visible on touch, 44 px target, name "More actions for {title}". Enter, Space or Down opens it; arrows, Home and End move; Escape closes and returns focus.
- Not built: multi-select, "Add books" from a list page, merging the two book pages.
