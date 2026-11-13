# November 12: My Books actions, genre names and a smaller filter panel

Michael's notes 1, 3 and 4 (signed-in review, 12 November). Frontend only; no backend change, no new option or wording beyond the brief.

- **Add to list and Pin to Up next** now sit on `/my-books/{id}`, right after the Want to read / I own it flags, for catalogue books only. Private books show neither. While changes are paused, Add to list is hidden (Pin to Up next hides itself). `/book/{id}` is unchanged.
- **Profile list page help line** reads "Add books from My Books or any book page."
- **Genre names:** the My Books Genre filter, its chips, Home's Can't decide? and Reading life take the genre's name from the one genre list, as written ("Art & music", "More Art & music"). A subject that isn't a genre is hidden, never shown as a key. `useGenres().labelOf` does the matching.
- **Filter panel:** Genre, Author (with its search) and Length only. Imported from, Just imported, Year finished, Has my note and the "More" group are removed. Old links carrying `source`, `year`, `note` or `imported` are ignored (not read, not sent to the API, not counted, not in chips) and drop out of the address on the next change. The "More filters" shelf menu is untouched.
- **Tests:** home, reading-library, reading-life, profile and reading-lifecycle specs updated or added (see the PR).
