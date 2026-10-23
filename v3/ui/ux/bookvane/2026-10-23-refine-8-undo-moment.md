# V3 refinement follow-up: immediate undo in the finish and stop moment

23 October 2026. Branch `ui/v3-refine-8-undo-moment`, **stacked on #43** (on #42, on #41). Michael confirmed it directly, as a separate small PR, after the Lead Developer proposed it during review of #42.

## Behaviour

Finish and Stop are single clicks with no confirmation, so the moment right after them offers an obvious undo.

**After Finish:** the existing "You finished {title}." moment now ends with **"Finished by mistake? [Mark as reading]"** (a secondary button).

**After Stop** (from Manage this book), a matching moment appears in the same place:
- **"You stopped reading {title}."**
- the recorded dates, when known
- "It stays in your Reading history, with your progress and note."
- **"Stopped by mistake? [Mark as reading]"**

The stop copy is short and factual. Review it if you'd prefer different wording.

**How the undo works:**
- It uses the same command as the quiet link: `PATCH /me/reading-attempts/{id}` `{ expected_version: entry.version, state: "reading" }`, through `command.run` and `acceptReadingAction`, with the same `blocked` guard.
- A stale version shows the existing conflict alert, and the finish stays saved.
- On success the moment disappears and focus returns to the reading status heading.

**Where it shows:**
- Only in this session's own moment, while that attempt still has the finished/stopped state.
- While the moment shows, the card's quiet "Still reading it?" link is hidden, so there is only one Mark as reading. On later visits the quiet link (from #42) covers it.
- The Next-read preview resets only for a Finish, not a Stop. The finish heading receives focus in both cases.

**Unchanged:** no change to T4's live-date call sites. `changeState` still sends only `state`; the moment is set for `dnf` as well as `finished`.

## Verification (executed)

| Check | Result |
|---|---|
| New: Finish → moment undo; Stop (from Manage) → moment undo | Passed. Focus lands on the moment heading. Exactly one Mark as reading button. After undo: the "Reading" status heading is focused, the moment is gone, the same attempt id is back to reading, the older attempt is unchanged, and the writes are exactly PATCH finished/dnf then PATCH reading on the same id. |
| New: stale undo (version bumped) | Passed. The conflict alert shows, the state stays Finished, and only one reading PATCH is sent. |
| Full mocked suite (Edge) | **292 passed, 0 failed.** A first attempt overlapped the implementer's T4 run on port 5189 and was discarded. All earlier full-run logs were checked and none overlapped. |
| Lint / build | Exit 0, 12 warnings (unchanged) / passed |

**Not run:** WebKit, physical devices, real API journeys.
